import { jest } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection, type Model } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module.js';
import { Venue, VenueSchema } from '../db/schemas/org-venue.schema.js';
import { Ping, PingSchema } from '../db/schemas/ping.schema.js';
import {
  OutboxEntry,
  OutboxSchema,
  Report,
  ReportSchema,
  VerificationResultDoc,
  VerificationResultSchema,
} from '../db/schemas/report-verification.schema.js';
import {
  Session,
  SessionEventDoc,
  SessionEventSchema,
  SessionSchema,
} from '../db/schemas/task-session.schema.js';
import { PingsController } from '../pings/pings.controller.js';
import { PingsService } from '../pings/pings.service.js';
import { SessionsController } from '../session/sessions.controller.js';
import { SessionsService } from '../session/sessions.service.js';
import { EvaluatorService, LEASE_SECONDS } from '../verification/evaluator.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/**
 * The whole visit, end to end, against a real replica set.
 *
 * Until this branch nothing called `evaluate()` -- the system stored evidence and produced no
 * verdicts. These tests are the proof that the spine actually connects.
 */
describe('visit lifecycle', () => {
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let app: INestApplication;
  let evaluator: EvaluatorService;

  let Sessions: Model<Session>;
  let Venues: Model<Venue>;
  let Pings: Model<Ping>;
  let Outbox: Model<OutboxEntry>;
  let Results: Model<VerificationResultDoc>;
  let Reports: Model<Report>;
  let Events: Model<SessionEventDoc>;

  let venueId: string;
  let token: string;

  const VENUE = { lat: 29.3759, lng: 47.9774 };

  const login = async (username: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'demo1234' })
      .expect(200);
    return (res.body as { token: string }).token;
  };

  const auth = (tok = token) => ({ Authorization: `Bearer ${tok}` });

  const makeSession = async (participantId = 'u-participant-1'): Promise<string> => {
    const now = new Date();
    const s = await Sessions.create({
      assignmentId: `a-${Math.random()}`,
      participantId,
      clientOrgId: 'org-alfa-retail',
      venueId,
      state: 'pending',
      createdAtServer: now,
      lastSeenAt: now,
      pingCount: 0,
    } as never);
    return String(s._id);
  };

  /** An honest trace: approach, dwell inside, departure. */
  const honestFixes = (n = 8) =>
    Array.from({ length: n }, (_, i) => ({
      clientPingId: `fix-${Math.random().toString(36).slice(2)}`,
      capturedAt: new Date().toISOString(),
      lat: i === 0 || i === n - 1 ? VENUE.lat + 0.004 : VENUE.lat + 0.0002 + i * 0.00001,
      lng: VENUE.lng + 0.0001 + i * 0.00001,
      accuracyM: 8 + (i % 5) * 1.7,
    }));

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    conn = await mongoose.createConnection(mongod.getUri('lifecycle')).asPromise();

    Sessions = conn.model(Session.name, SessionSchema) as Model<Session>;
    Venues = conn.model(Venue.name, VenueSchema) as Model<Venue>;
    Pings = conn.model(Ping.name, PingSchema) as Model<Ping>;
    Outbox = conn.model(OutboxEntry.name, OutboxSchema) as Model<OutboxEntry>;
    Results = conn.model(
      VerificationResultDoc.name,
      VerificationResultSchema,
    ) as Model<VerificationResultDoc>;
    Reports = conn.model(Report.name, ReportSchema) as Model<Report>;
    Events = conn.model(SessionEventDoc.name, SessionEventSchema) as Model<SessionEventDoc>;
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
      controllers: [SessionsController, ReportsController, PingsController],
      providers: [
        SessionsService,
        ReportsService,
        PingsService,
        EvaluatorService,
        { provide: getConnectionToken(), useValue: conn },
        { provide: getModelToken(Session.name), useValue: Sessions },
        { provide: getModelToken(SessionEventDoc.name), useValue: Events },
        { provide: getModelToken(Venue.name), useValue: Venues },
        { provide: getModelToken(Ping.name), useValue: Pings },
        { provide: getModelToken(Report.name), useValue: Reports },
        { provide: getModelToken(OutboxEntry.name), useValue: Outbox },
        { provide: getModelToken(VerificationResultDoc.name), useValue: Results },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    evaluator = moduleRef.get(EvaluatorService);
    token = await login('user1');
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  describe('the whole loop', () => {
    it('start, ping, end, submit, evaluate produces a verdict with reasons', async () => {
      const id = await makeSession();
      const srv = app.getHttpServer();

      await request(srv).post(`/sessions/${id}/start`).set(auth()).expect(200);
      await request(srv)
        .post(`/sessions/${id}/pings`)
        .set(auth())
        .send({ fixes: honestFixes() })
        .expect(200);
      await request(srv).post(`/sessions/${id}/end`).set(auth()).expect(200);

      const submitted = await request(srv)
        .post(`/sessions/${id}/report`)
        .set(auth())
        .send({ notes: 'Greeted within a minute, store clean, one till open.', rating: 4 })
        .expect(201);
      expect(submitted.body).toMatchObject({ queuedForVerification: true });

      // Before the evaluator runs there is no verdict, and the response never pretended
      // otherwise (rule 9: submit and verification are decoupled).
      expect(await Results.countDocuments({ sessionId: id })).toBe(0);
      expect(await Outbox.countDocuments({ sessionId: id, status: 'pending' })).toBe(1);

      expect(await evaluator.drain()).toBe(1);

      const result = await Results.findOne({ sessionId: id }).lean<{
        verdict: string;
        score: number;
        engineVersion: string;
        signals: { code: string; reason: string }[];
        rollups: { fixCount: number };
      }>();
      expect(result).toBeTruthy();
      expect(result!.score).toBeGreaterThanOrEqual(0);
      expect(result!.engineVersion).toBeTruthy();
      expect(result!.signals.length).toBeGreaterThan(0);
      for (const s of result!.signals) expect(s.reason.length).toBeGreaterThan(20);
      expect(result!.rollups.fixCount).toBe(8);

      expect(await Outbox.countDocuments({ sessionId: id, status: 'done' })).toBe(1);
    });

    it('records an append-only event for every transition', async () => {
      const id = await makeSession();
      const srv = app.getHttpServer();
      await request(srv).post(`/sessions/${id}/start`).set(auth()).expect(200);
      await request(srv).post(`/sessions/${id}/end`).set(auth()).expect(200);
      await request(srv)
        .post(`/sessions/${id}/report`)
        .set(auth())
        .send({ notes: 'A perfectly ordinary visit report.', rating: 3 })
        .expect(201);

      const events = await Events.find({ sessionId: id }).sort({ at: 1 }).lean<
        { from: string; event: string; to: string; actor: string }[]
      >();
      expect(events.map((e) => `${e.from}-${e.event}->${e.to}`)).toEqual([
        'pending-start->active',
        'active-end->ended',
        'ended-submit->submitted',
      ]);
      expect(events.every((e) => e.actor === 'u-participant-1')).toBe(true);
    });

    it('denormalises the verdict onto the session so the console needs no join', async () => {
      const id = await makeSession();
      const srv = app.getHttpServer();
      await request(srv).post(`/sessions/${id}/start`).set(auth()).expect(200);
      await request(srv)
        .post(`/sessions/${id}/pings`)
        .set(auth())
        .send({ fixes: honestFixes() })
        .expect(200);
      await request(srv).post(`/sessions/${id}/end`).set(auth()).expect(200);
      await request(srv)
        .post(`/sessions/${id}/report`)
        .set(auth())
        .send({ notes: 'Another ordinary visit report here.', rating: 5 })
        .expect(201);
      await evaluator.drain();

      const s = await Sessions.findById(id).lean<{
        latestVerdict: string | null;
        latestScore: number | null;
        latestResultId: string | null;
      }>();
      expect(s!.latestVerdict).toBeTruthy();
      expect(s!.latestScore).toBeGreaterThanOrEqual(0);
      const result = await Results.findById(s!.latestResultId).lean<{ verdict: string }>();
      expect(result!.verdict).toBe(s!.latestVerdict);
    });
  });

  describe('rule 5: illegal transitions are 409, never silent no-ops', () => {
    it('refuses to start a session twice', async () => {
      const id = await makeSession();
      const srv = app.getHttpServer();
      await request(srv).post(`/sessions/${id}/start`).set(auth()).expect(200);
      const res = await request(srv).post(`/sessions/${id}/start`).set(auth()).expect(409);
      expect(res.body).toMatchObject({ code: 'ILLEGAL_TRANSITION', state: 'active' });
      expect(res.body.allowed).toEqual(expect.arrayContaining(['end']));
    });

    it('refuses to end a session that never started', async () => {
      const id = await makeSession();
      const res = await request(app.getHttpServer())
        .post(`/sessions/${id}/end`)
        .set(auth())
        .expect(409);
      expect(res.body).toMatchObject({ state: 'pending' });
    });

    it('refuses to submit twice, and keeps exactly one report', async () => {
      const id = await makeSession();
      const srv = app.getHttpServer();
      const body = { notes: 'Submitted once, attempted twice over.', rating: 4 };
      await request(srv).post(`/sessions/${id}/start`).set(auth()).expect(200);
      await request(srv).post(`/sessions/${id}/end`).set(auth()).expect(200);
      await request(srv).post(`/sessions/${id}/report`).set(auth()).send(body).expect(201);
      await request(srv).post(`/sessions/${id}/report`).set(auth()).send(body).expect(409);

      expect(await Reports.countDocuments({ sessionId: id })).toBe(1);
      expect(await Outbox.countDocuments({ sessionId: id })).toBe(1);
    });
  });

  describe('rule 9: submit is one transaction', () => {
    it('rolls back the report and the state when the outbox write fails', async () => {
      const id = await makeSession();
      const srv = app.getHttpServer();
      await request(srv).post(`/sessions/${id}/start`).set(auth()).expect(200);
      await request(srv).post(`/sessions/${id}/end`).set(auth()).expect(200);

      const spy = jest
        .spyOn(Outbox, 'create')
        .mockRejectedValueOnce(new Error('outbox unavailable'));

      await request(srv)
        .post(`/sessions/${id}/report`)
        .set(auth())
        .send({ notes: 'This submission should not survive.', rating: 2 })
        .expect(500);
      spy.mockRestore();

      // No half-submitted visit: no report, no outbox row, and the state did not move.
      expect(await Reports.countDocuments({ sessionId: id })).toBe(0);
      expect(await Outbox.countDocuments({ sessionId: id })).toBe(0);
      const s = await Sessions.findById(id).lean<{ state: string }>();
      expect(s!.state).toBe('ended');
    });
  });

  describe('the venue snapshot (D-012)', () => {
    it('judges a visit against the geofence in force when it started', async () => {
      const id = await makeSession();
      const srv = app.getHttpServer();
      await request(srv).post(`/sessions/${id}/start`).set(auth()).expect(200);

      const snapped = await Sessions.findById(id).lean<{
        venueSnapshot: { radiusM: number } | null;
      }>();
      expect(snapped!.venueSnapshot!.radiusM).toBe(75);

      // An admin widens the venue AFTER the visit started.
      await Venues.updateOne({ _id: venueId }, { $set: { radiusM: 500 } });

      await request(srv)
        .post(`/sessions/${id}/pings`)
        .set(auth())
        .send({ fixes: honestFixes() })
        .expect(200);
      await request(srv).post(`/sessions/${id}/end`).set(auth()).expect(200);
      await request(srv)
        .post(`/sessions/${id}/report`)
        .set(auth())
        .send({ notes: 'Visit conducted under the original radius.', rating: 4 })
        .expect(201);
      await evaluator.drain();

      // The evaluator used the snapshot, not the live 500 m radius.
      const result = await Results.findOne({ sessionId: id })
        .sort({ createdAt: -1 })
        .lean<{ signals: { code: string; reason: string }[] }>();
      const proximity = result!.signals.find((s) => s.code === 'proximity');
      expect(proximity?.reason).toContain('75 m');
      expect(proximity?.reason).not.toContain('500 m');

      await Venues.updateOne({ _id: venueId }, { $set: { radiusM: 75 } });
    });
  });

  describe('the outbox lease (D-012)', () => {
    it('reclaims a row whose worker died mid-flight', async () => {
      // Without this the row sits in `processing` forever: that visit is never verified and
      // never retried, silently. Rule 9 promised retry for a FAILED attempt, not a LOST one.
      const id = await makeSession();
      await Outbox.create({
        sessionId: id,
        kind: 'verify_visit',
        status: 'processing',
        attempts: 1,
        lastAttemptAt: new Date(Date.now() - (LEASE_SECONDS + 60) * 1000),
        runAfter: new Date(),
      } as never);

      expect(await evaluator.reclaimStale()).toBe(1);
      const row = await Outbox.findOne({ sessionId: id }).lean<{ status: string }>();
      expect(row!.status).toBe('pending');
    });

    it('does not steal a row from a worker that is still within its lease', async () => {
      const id = await makeSession();
      await Outbox.create({
        sessionId: id,
        kind: 'verify_visit',
        status: 'processing',
        attempts: 1,
        lastAttemptAt: new Date(),
        runAfter: new Date(),
      } as never);

      expect(await evaluator.reclaimStale()).toBe(0);
      const row = await Outbox.findOne({ sessionId: id }).lean<{ status: string }>();
      expect(row!.status).toBe('processing');
    });

    it('claims a row atomically, so two workers cannot both take it', async () => {
      // Clear the queue first: drain() claims ANY due row, so leftovers from earlier tests
      // would make this assert nothing.
      await Outbox.deleteMany({});
      const id = await makeSession();
      await Outbox.create({
        sessionId: id,
        kind: 'verify_visit',
        status: 'pending',
        runAfter: new Date(Date.now() - 1000),
      } as never);

      const [a, b] = await Promise.all([evaluator.drain(1), evaluator.drain(1)]);
      // Exactly one worker got it; the other found nothing and moved on.
      expect(a + b).toBe(1);
      expect(await Outbox.countDocuments({ sessionId: id })).toBe(1);
    });
  });

  describe('re-running the evaluator (rule 8)', () => {
    it('writes a new result and leaves the old verdict intact', async () => {
      const id = await makeSession();
      const srv = app.getHttpServer();
      await request(srv).post(`/sessions/${id}/start`).set(auth()).expect(200);
      await request(srv)
        .post(`/sessions/${id}/pings`)
        .set(auth())
        .send({ fixes: honestFixes() })
        .expect(200);
      await request(srv).post(`/sessions/${id}/end`).set(auth()).expect(200);
      await request(srv)
        .post(`/sessions/${id}/report`)
        .set(auth())
        .send({ notes: 'A visit that will be evaluated twice.', rating: 4 })
        .expect(201);

      await evaluator.drain();
      await evaluator.evaluateSession(id); // a re-run, as a newer engine would do

      const all = await Results.find({ sessionId: id }).sort({ createdAt: 1 }).lean();
      expect(all).toHaveLength(2);
    });
  });

  describe('authorization boundaries', () => {
    it('rejects an unauthenticated start', async () => {
      const id = await makeSession();
      await request(app.getHttpServer()).post(`/sessions/${id}/start`).expect(401);
    });

    it("forbids starting another participant's session", async () => {
      const id = await makeSession('u-participant-2');
      await request(app.getHttpServer())
        .post(`/sessions/${id}/start`)
        .set(auth())
        .expect(403);
    });

    it('forbids an admin from submitting a report', async () => {
      const id = await makeSession();
      const adminToken = await login('admin');
      await request(app.getHttpServer())
        .post(`/sessions/${id}/report`)
        .set(auth(adminToken))
        .send({ notes: 'An admin should not be able to do this.', rating: 5 })
        .expect(403);
    });
  });

  describe('the client is untrusted (rule 2)', () => {
    it.each(['submittedAt', 'verdict', 'score', 'sessionId', 'participantId'])(
      'rejects a report carrying %s',
      async (field) => {
        const id = await makeSession();
        const res = await request(app.getHttpServer())
          .post(`/sessions/${id}/report`)
          .set(auth())
          .send({ notes: 'Trying to set a server-owned field.', rating: 4, [field]: 1 })
          .expect(400);
        expect(JSON.stringify(res.body)).toContain(field);
      },
    );

    it('rejects a rating outside 1..5', async () => {
      const id = await makeSession();
      await request(app.getHttpServer())
        .post(`/sessions/${id}/report`)
        .set(auth())
        .send({ notes: 'Rating out of the allowed range.', rating: 9 })
        .expect(400);
    });
  });
});
