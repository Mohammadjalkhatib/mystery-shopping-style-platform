import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection, type Model } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module.js';
import { VenueSchema } from '../db/schemas/org-venue.schema.js';
import { Ping, PingSchema } from '../db/schemas/ping.schema.js';
import {
  MAX_PINGS_PER_SESSION,
  Session,
  SessionSchema,
} from '../db/schemas/task-session.schema.js';
import { Venue } from '../db/schemas/org-venue.schema.js';
import { PingsController } from './pings.controller.js';
import { PingsService } from './pings.service.js';

/**
 * Ping ingest, tested against a real MongoDB.
 *
 * Every describe block below corresponds to one constraint handed forward by the
 * spoof-adversary pass (D-010) or the schema-reviewer pass (D-012). If a test here fails,
 * a specific documented attack has been reopened.
 */
describe('ping ingest', () => {
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let app: INestApplication;
  let Pings: Model<Ping>;
  let Sessions: Model<Session>;
  let Venues: Model<Venue>;
  let venueId: string;
  let token: string;

  // KUWAIT_CITY_CENTRE, radius 75 m. Matches the outdoor reference venue.
  const VENUE = { lat: 29.3759, lng: 47.9774 };

  const login = async (username: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'demo1234' })
      .expect(200);
    return (res.body as { token: string }).token;
  };

  const makeSession = async (
    over: Partial<{ state: string; participantId: string; pingCount: number }> = {},
  ): Promise<string> => {
    const now = new Date();
    const s = await Sessions.create({
      assignmentId: `a-${Math.random()}`,
      participantId: 'u-participant-1',
      clientOrgId: 'org-alfa-retail',
      venueId,
      state: 'active',
      createdAtServer: now,
      startedAt: now,
      lastSeenAt: now,
      pingCount: 0,
      ...over,
    } as never);
    return String(s._id);
  };

  const fix = (over: Partial<Record<string, unknown>> = {}) => ({
    clientPingId: `uuid-${Math.random().toString(36).slice(2)}`,
    capturedAt: new Date().toISOString(),
    lat: VENUE.lat + 0.0002,
    lng: VENUE.lng + 0.0001,
    accuracyM: 9.4,
    ...over,
  });

  const post = (sessionId: string, body: object, tok = token) =>
    request(app.getHttpServer())
      .post(`/sessions/${sessionId}/pings`)
      .set('Authorization', `Bearer ${tok}`)
      .send(body);

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = mongod.getUri('ping-ingest');
    conn = await mongoose.createConnection(uri).asPromise();

    Pings = conn.model(Ping.name, PingSchema) as Model<Ping>;
    Sessions = conn.model(Session.name, SessionSchema) as Model<Session>;
    Venues = conn.model(Venue.name, VenueSchema) as Model<Venue>;
    await Pings.syncIndexes();

    const v = await Venues.create({
      clientOrgId: 'org-alfa-retail',
      name: 'Alfa Market',
      address: 'Kuwait City',
      location: { type: 'Point', coordinates: [VENUE.lng, VENUE.lat] },
      radiusM: 75,
      nearBufferM: 50,
      indoor: false,
    } as never);
    venueId = String(v._id);

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule],
      controllers: [PingsController],
      providers: [
        PingsService,
        { provide: getModelToken(Ping.name), useValue: Pings },
        { provide: getModelToken(Session.name), useValue: Sessions },
        { provide: getModelToken(Venue.name), useValue: Venues },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    token = await login('user1');
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  describe('idempotency (rule 4)', () => {
    it('a duplicate flush produces one document, not two', async () => {
      const sessionId = await makeSession();
      const batch = { fixes: [fix(), fix(), fix()] };

      const first = await post(sessionId, batch).expect(200);
      expect(first.body).toMatchObject({ accepted: 3, duplicates: 0 });

      const second = await post(sessionId, batch).expect(200);
      expect(second.body).toMatchObject({ accepted: 0, duplicates: 3 });

      expect(await Pings.countDocuments({ sessionId })).toBe(3);
    });

    it('a re-flush cannot rewrite the coordinates of a stored fix', async () => {
      // $setOnInsert, never $set. Otherwise a client resends a known clientPingId with new
      // coordinates and quietly moves a fix after the fact (D-010).
      const sessionId = await makeSession();
      const f = fix();
      await post(sessionId, { fixes: [f] }).expect(200);
      await post(sessionId, { fixes: [{ ...f, lat: 0.0, lng: 0.0 }] }).expect(200);

      const stored = await Pings.findOne({ sessionId, clientPingId: f.clientPingId }).lean<{
        lat: number;
        distanceM: number;
      }>();
      expect(stored!.lat).toBeCloseTo(VENUE.lat + 0.0002, 5);
      expect(stored!.distanceM).toBeLessThan(100);
    });

    it('does not burn the session budget on a duplicate flush', async () => {
      // $inc must use documents actually inserted, not batch length -- otherwise rule 4's
      // safety guarantee becomes a slow leak (D-012).
      const sessionId = await makeSession();
      const batch = { fixes: [fix(), fix()] };
      await post(sessionId, batch).expect(200);
      const second = await post(sessionId, batch).expect(200);
      expect((second.body as { pingCount: number }).pingCount).toBe(2);
    });
  });

  describe('the client is untrusted (rule 2)', () => {
    it.each(['distanceM', 'presence', 'receivedAt', 'sessionId', 'participantId'])(
      'REJECTS a client-supplied %s with 400 naming the field, rather than ignoring it',
      async (field) => {
        const sessionId = await makeSession();
        const res = await post(sessionId, { fixes: [{ ...fix(), [field]: 1 }] }).expect(400);
        expect(JSON.stringify(res.body)).toContain(field);
      },
    );

    it('rejects an unknown top-level property', async () => {
      const sessionId = await makeSession();
      await post(sessionId, { fixes: [fix()], trustMe: true }).expect(400);
    });

    it('computes distance and presence on the server', async () => {
      const sessionId = await makeSession();
      await post(sessionId, { fixes: [fix()] }).expect(200);
      const stored = await Pings.findOne({ sessionId }).lean<{
        distanceM: number;
        presence: string;
        receivedAt: Date;
      }>();
      expect(stored!.distanceM).toBeGreaterThan(0);
      expect(stored!.presence).toBe('inside');
      expect(stored!.receivedAt).toBeInstanceOf(Date);
    });

    it('rejects a non-positive accuracy, which would grant a free geofence', async () => {
      const sessionId = await makeSession();
      await post(sessionId, { fixes: [fix({ accuracyM: 0 })] }).expect(400);
      await post(sessionId, { fixes: [fix({ accuracyM: -5 })] }).expect(400);
    });

    it('accepts the messy floats real GPS actually produces', async () => {
      // 8.6 + 2 * 1.4 = 11.399999999999999. A maxDecimalPlaces cap rejected honest fixes with
      // a 400 while an attacker picking round numbers sailed through. Found by a live probe,
      // not by these tests, because every fixture used tidy values.
      const sessionId = await makeSession();
      const messy = 8.6 + 2 * 1.4;
      expect(String(messy)).toContain('999');
      await post(sessionId, { fixes: [fix({ accuracyM: messy })] }).expect(200);
      const stored = await Pings.findOne({ sessionId }).lean<{ accuracyM: number }>();
      expect(stored!.accuracyM).toBe(messy);
    });

    it('does not round accuracyM', async () => {
      // Rounding would trip the engine's `distinct === 1` spoof branch on honest Android
      // traces, which report a quantised repeating accuracy (D-010).
      const sessionId = await makeSession();
      await post(sessionId, { fixes: [fix({ accuracyM: 9.437 })] }).expect(200);
      const stored = await Pings.findOne({ sessionId }).lean<{ accuracyM: number }>();
      expect(stored!.accuracyM).toBe(9.437);
    });

    it('rejects out-of-range coordinates', async () => {
      const sessionId = await makeSession();
      await post(sessionId, { fixes: [fix({ lat: 91 })] }).expect(400);
      await post(sessionId, { fixes: [fix({ lng: 181 })] }).expect(400);
    });

    it('caps a batch at 20 fixes', async () => {
      const sessionId = await makeSession();
      await post(sessionId, { fixes: Array.from({ length: 21 }, () => fix()) }).expect(400);
    });
  });

  describe('receivedAt is stamped per fix, never per batch (D-010)', () => {
    it('gives fixes in one batch distinct, increasing server timestamps', async () => {
      // A batch-level stamp makes every intra-batch interval zero, which collapses coverage,
      // zeroes dwell, and silently disables the engine's teleport check for the whole batch.
      const sessionId = await makeSession();
      await post(sessionId, { fixes: [fix(), fix(), fix(), fix(), fix()] }).expect(200);

      const stored = await Pings.find({ sessionId })
        .sort({ receivedAt: 1 })
        .lean<{ receivedAt: Date }[]>();
      expect(stored).toHaveLength(5);

      const times = stored.map((p) => new Date(p.receivedAt).getTime());
      // Monotonic, and not all identical -- which is what a per-batch stamp would produce.
      for (let i = 1; i < times.length; i++) {
        expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
      }
      expect(new Set(times).size).toBeGreaterThan(1);
    });
  });

  describe('the device clock is bounded (D-010)', () => {
    it('drops a fix claiming to predate the session, without failing the batch', async () => {
      const sessionId = await makeSession();
      const res = await post(sessionId, {
        fixes: [fix(), fix({ capturedAt: new Date(2020, 0, 1).toISOString() })],
      }).expect(200);
      expect(res.body).toMatchObject({ accepted: 1, rejectedOutOfWindow: 1 });
      expect(await Pings.countDocuments({ sessionId })).toBe(1);
    });

    it('drops a fix from the future', async () => {
      const sessionId = await makeSession();
      const tomorrow = new Date(Date.now() + 48 * 3600_000).toISOString();
      const res = await post(sessionId, { fixes: [fix({ capturedAt: tomorrow })] }).expect(200);
      expect(res.body).toMatchObject({ accepted: 0, rejectedOutOfWindow: 1 });
    });

    it('keeps a late offline flush, because queue latency is normal', async () => {
      // Rule 4 exists to make offline flushing safe; the window must not punish it.
      const sessionId = await makeSession();
      const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
      const res = await post(sessionId, { fixes: [fix({ capturedAt: tenMinutesAgo })] }).expect(
        200,
      );
      expect(res.body).toMatchObject({ accepted: 1, rejectedOutOfWindow: 0 });
    });
  });

  describe('session state (rule 5, D-010)', () => {
    it.each(['pending', 'ended', 'submitted', 'abandoned', 'expired'])(
      'refuses fixes for a session in state %s with 409 carrying the state',
      async (state) => {
        const sessionId = await makeSession({ state });
        const res = await post(sessionId, { fixes: [fix()] }).expect(409);
        expect(res.body).toMatchObject({ code: 'SESSION_NOT_ACTIVE', state });
      },
    );

    it('closes the flush-after-end hole', async () => {
      // The state machine allows `ended -> submit`, so without this a participant could end
      // the visit and then flush a forged queue before submitting.
      const sessionId = await makeSession({ state: 'ended' });
      await post(sessionId, { fixes: [fix()] }).expect(409);
      expect(await Pings.countDocuments({ sessionId })).toBe(0);
    });

    it('moves lastSeenAt on a successful batch, so the reaper sees a live session', async () => {
      const sessionId = await makeSession();
      const before = await Sessions.findById(sessionId).lean<{ lastSeenAt: Date }>();
      await new Promise((r) => setTimeout(r, 20));
      await post(sessionId, { fixes: [fix()] }).expect(200);
      const after = await Sessions.findById(sessionId).lean<{ lastSeenAt: Date }>();
      expect(new Date(after!.lastSeenAt).getTime()).toBeGreaterThan(
        new Date(before!.lastSeenAt).getTime(),
      );
    });
  });

  describe('the fixes-per-session budget (D-010)', () => {
    it('refuses to exceed the cap', async () => {
      const sessionId = await makeSession({ pingCount: MAX_PINGS_PER_SESSION - 1 });
      const res = await post(sessionId, { fixes: [fix(), fix(), fix()] }).expect(409);
      expect(res.body).toMatchObject({ code: 'PING_BUDGET_EXHAUSTED' });
    });

    it('accepts a batch that exactly fills the remaining budget', async () => {
      const sessionId = await makeSession({ pingCount: MAX_PINGS_PER_SESSION - 2 });
      const res = await post(sessionId, { fixes: [fix(), fix()] }).expect(200);
      expect(res.body).toMatchObject({ remainingBudget: 0 });
    });
  });

  describe('authorization boundaries (CLAUDE.md section 5)', () => {
    it('rejects an unauthenticated request', async () => {
      const sessionId = await makeSession();
      await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/pings`)
        .send({ fixes: [fix()] })
        .expect(401);
    });

    it("forbids posting fixes to another participant's session", async () => {
      const sessionId = await makeSession({ participantId: 'u-participant-2' });
      await post(sessionId, { fixes: [fix()] }).expect(403);
      expect(await Pings.countDocuments({ sessionId })).toBe(0);
    });

    it('forbids an admin from posting fixes at all', async () => {
      // There is no legitimate reason for an admin to author location evidence.
      const sessionId = await makeSession();
      const adminToken = await login('admin');
      await post(sessionId, { fixes: [fix()] }, adminToken).expect(403);
    });

    it('404s an unknown session rather than leaking whether it exists', async () => {
      await post('64b7f0a1c2d3e4f5a6b7c8d9', { fixes: [fix()] }).expect(404);
    });
  });

  describe('the trace it produces is what the engine expects', () => {
    it('stores presence the engine can consume, including unknown for coarse fixes', async () => {
      const sessionId = await makeSession();
      await post(sessionId, {
        fixes: [
          fix({ accuracyM: 9 }), // inside
          fix({ lat: VENUE.lat + 0.01, accuracyM: 9 }), // ~1.1 km away -> outside
          fix({ accuracyM: 400 }), // above the cap -> unknown
        ],
      }).expect(200);

      const stored = await Pings.find({ sessionId }).lean<{ presence: string }[]>();
      const presences = stored.map((p) => p.presence).sort();
      expect(presences).toEqual(['inside', 'outside', 'unknown']);
    });
  });

  describe('the geofence is the SNAPSHOT, not the live venue (D-021)', () => {
    /**
     * D-012 pinned `venueSnapshot` at `start` so an admin editing a geofence could not change
     * a verdict after the fact, and switched the evaluator over. Ingest was left reading the
     * venue live, so every fix carried a `distanceM` and `presence` measured against whatever
     * the venue looked like at that moment -- and the evaluator then consumed those per-fix
     * values alongside a snapshot venue. One edit mid-visit put two vintages of geofence in a
     * single trace. This is that half of the fix.
     */
    it('measures against the snapshot when the live venue is somewhere else entirely', async () => {
      // ~5.5 km north of the live venue.
      const SNAP = { lat: VENUE.lat + 0.05, lng: VENUE.lng };
      const sessionId = await makeSession({
        venueSnapshot: {
          lat: SNAP.lat,
          lng: SNAP.lng,
          radiusM: 75,
          nearBufferM: 50,
          indoor: false,
          snapshotAt: new Date(),
        },
      } as never);

      await post(sessionId, {
        fixes: [fix({ lat: SNAP.lat, lng: SNAP.lng, accuracyM: 8 })],
      }).expect(200);

      const stored = await Pings.findOne({ sessionId }).lean<{
        distanceM: number;
        presence: string;
      }>();
      // Against the snapshot this is metres away and inside. Against the live venue it would
      // be ~5.5 km and outside, which is exactly the regression this guards.
      expect(stored!.distanceM).toBeLessThan(75);
      expect(stored!.presence).toBe('inside');
    });

    it('falls back to the live venue for a session with no snapshot', async () => {
      // Sessions that began before the field existed. Still measured, not rejected.
      const sessionId = await makeSession();
      await post(sessionId, { fixes: [fix({ accuracyM: 8 })] }).expect(200);

      const stored = await Pings.findOne({ sessionId }).lean<{ presence: string }>();
      expect(stored!.presence).toBe('inside');
    });
  });
});
