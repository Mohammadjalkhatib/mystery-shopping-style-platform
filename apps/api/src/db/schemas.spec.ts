import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection } from 'mongoose';
import { syncPingTtlIndex } from './indexes.js';
import { ClientOrgSchema, VenueSchema } from './schemas/org-venue.schema.js';
import { PING_TTL_INDEX_NAME, PingSchema } from './schemas/ping.schema.js';
import { AssignmentSchema, SessionSchema, TaskSchema } from './schemas/task-session.schema.js';
import {
  OutboxSchema,
  ReportSchema,
  VerificationResultSchema,
} from './schemas/report-verification.schema.js';
import { seed, SEED_ORG_SLUG } from './seed.js';

/**
 * These run against a real MongoDB (mongodb-memory-server), because the things worth testing
 * here are things Mongo enforces, not things TypeScript does: unique indexes, TTL semantics,
 * schema bounds, and whether a transaction actually commits.
 *
 * A REPLICA SET, not a standalone: design rule 9 requires a transactional submit, and Mongo
 * refuses transactions outside a replica set. That is also the bug waiting in
 * docker-compose.yml, where `mongo` is standalone -- see the open item in docs/MEMORY.md.
 */
describe('data model', () => {
  let mongod: MongoMemoryReplSet;
  let conn: Connection;

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    conn = await mongoose.createConnection(mongod.getUri('mystery-shopping')).asPromise();
  });

  afterAll(async () => {
    await conn?.close();
    await mongod?.stop();
  });

  describe('ping idempotency (rule 4)', () => {
    it('rejects a duplicate (sessionId, clientPingId)', async () => {
      const Ping = conn.model('PingA', PingSchema, 'pingsA');
      await Ping.syncIndexes();
      const doc = {
        sessionId: 's1',
        clientPingId: 'uuid-1',
        capturedAt: new Date(),
        receivedAt: new Date(),
        lat: 29.3759,
        lng: 47.9774,
        accuracyM: 10,
        distanceM: 12,
        presence: 'inside' as const,
      };
      await Ping.create(doc);
      await expect(Ping.create(doc)).rejects.toThrow(/E11000|duplicate key/i);
    });

    it('allows the same clientPingId under a different session', async () => {
      const Ping = conn.model('PingB', PingSchema, 'pingsB');
      await Ping.syncIndexes();
      const base = {
        clientPingId: 'shared-uuid',
        capturedAt: new Date(),
        receivedAt: new Date(),
        lat: 29.3,
        lng: 47.9,
        accuracyM: 10,
        distanceM: 5,
        presence: 'inside' as const,
      };
      await Ping.create({ ...base, sessionId: 'sA' });
      await expect(Ping.create({ ...base, sessionId: 'sB' })).resolves.toBeDefined();
    });

    it('a re-flush with $setOnInsert does not rewrite a stored fix (D-010)', async () => {
      // With $set instead, a client could resend a known clientPingId carrying different
      // coordinates and quietly move a fix after the fact.
      const Ping = conn.model('PingC', PingSchema, 'pingsC');
      await Ping.syncIndexes();
      const key = { sessionId: 's9', clientPingId: 'uuid-9' };
      const first = {
        ...key,
        capturedAt: new Date(),
        receivedAt: new Date(),
        lat: 29.3759,
        lng: 47.9774,
        accuracyM: 10,
        distanceM: 12,
        presence: 'inside' as const,
      };
      await Ping.findOneAndUpdate(key, { $setOnInsert: first }, { upsert: true, returnDocument: 'after' });
      await Ping.findOneAndUpdate(
        key,
        { $setOnInsert: { ...first, lat: 0, lng: 0, distanceM: 999_999 } },
        { upsert: true, returnDocument: 'after' },
      );
      const stored = await Ping.findOne(key).lean<{ lat: number; distanceM: number }>();
      expect(stored!.lat).toBeCloseTo(29.3759, 4);
      expect(stored!.distanceM).toBe(12);
      expect(await Ping.countDocuments(key)).toBe(1);
    });
  });

  describe('ping TTL is a privacy control (rule 10)', () => {
    it('creates the TTL index when it is missing', async () => {
      const c = conn.collection('pings');
      const r = await syncPingTtlIndex(conn, 30);
      expect(r.action).toBe('created');
      const idx = (await c.indexes()).find((i) => i.name === PING_TTL_INDEX_NAME);
      expect(idx?.expireAfterSeconds).toBe(30 * 86_400);
    });

    it('is idempotent when the retention window has not moved', async () => {
      expect((await syncPingTtlIndex(conn, 30)).action).toBe('unchanged');
    });

    it('MOVES an existing index via collMod when PING_RETENTION_DAYS changes', async () => {
      // This is the whole point of the function. Re-declaring the index in Mongoose does
      // NOT change expireAfterSeconds and does not error -- it silently no-ops, which would
      // make PING_RETENTION_DAYS decorative on every deployment after the first.
      const r = await syncPingTtlIndex(conn, 7);
      expect(r.action).toBe('updated');
      expect(r.previousSeconds).toBe(30 * 86_400);
      const idx = (await conn.collection('pings').indexes()).find(
        (i) => i.name === PING_TTL_INDEX_NAME,
      );
      expect(idx?.expireAfterSeconds).toBe(7 * 86_400);
      await syncPingTtlIndex(conn, 30); // restore
    });

    it('refuses to start rather than defaulting to keeping traces forever', async () => {
      await expect(syncPingTtlIndex(conn, 0)).rejects.toThrow(/positive number/);
      await expect(syncPingTtlIndex(conn, -1)).rejects.toThrow(/positive number/);
    });
  });

  describe('schema bounds are enforced by the database, not just the DTO', () => {
    it('rejects a venue radius that would auto-verify the city (D-010)', async () => {
      const Venue = conn.model('VenueA', VenueSchema, 'venuesA');
      const base = {
        clientOrgId: 'o1',
        name: 'v',
        address: 'a',
        location: { type: 'Point' as const, coordinates: [47.9774, 29.3759] },
        nearBufferM: 50,
        indoor: false,
      };
      await expect(Venue.create({ ...base, radiusM: 5000 })).rejects.toThrow();
      await expect(Venue.create({ ...base, radiusM: 10 })).rejects.toThrow();
      await expect(Venue.create({ ...base, radiusM: 75 })).resolves.toBeDefined();
    });

    it('rejects a non-positive accuracy, which would sail through the presence rule', async () => {
      const Ping = conn.model('PingD', PingSchema, 'pingsD');
      const base = {
        sessionId: 's',
        clientPingId: 'p',
        capturedAt: new Date(),
        receivedAt: new Date(),
        lat: 29,
        lng: 47,
        distanceM: 1,
        presence: 'inside' as const,
      };
      await expect(Ping.create({ ...base, accuracyM: 0 })).rejects.toThrow();
      await expect(Ping.create({ ...base, accuracyM: -5 })).rejects.toThrow();
    });

    it('rejects out-of-range coordinates', async () => {
      const Ping = conn.model('PingE', PingSchema, 'pingsE');
      const base = {
        sessionId: 's',
        clientPingId: 'p',
        capturedAt: new Date(),
        receivedAt: new Date(),
        accuracyM: 10,
        distanceM: 1,
        presence: 'inside' as const,
      };
      await expect(Ping.create({ ...base, lat: 91, lng: 47 })).rejects.toThrow();
      await expect(Ping.create({ ...base, lat: 29, lng: 181 })).rejects.toThrow();
    });

    it('rejects a score outside 0..100 and an unknown verdict (rule 1)', async () => {
      const VR = conn.model('VRA', VerificationResultSchema, 'vrA');
      const base = {
        sessionId: 's',
        clientOrgId: 'o',
        signals: [],
        engineVersion: 'v1',
        rollups: { fixCount: 3, dwellSeconds: 90, coverageRatio: 1, minDistanceM: 12, medianAccuracyM: 10, unusableFixCount: 0 },
      };
      await expect(VR.create({ ...base, score: 101, verdict: 'auto_verified' })).rejects.toThrow();
      // Cast on purpose: TypeScript already refuses 'verified', and this asserts the DATABASE
      // refuses it too. Rule 1 has to hold for anything written outside the type system --
      // a migration, a mongosh session, an older engine version.
      await expect(
        VR.create({ ...base, score: 50, verdict: 'verified' as 'needs_review' }),
      ).rejects.toThrow();
      await expect(VR.create({ ...base, score: 50, verdict: 'needs_review' })).resolves.toBeDefined();
    });
  });

  describe('uniqueness constraints', () => {
    it('will not assign the same task to one participant twice', async () => {
      const A = conn.model('AssignA', AssignmentSchema, 'assignA');
      await A.syncIndexes();
      const doc = { taskId: 't1', participantId: 'p1', clientOrgId: 'o1' };
      await A.create(doc);
      await expect(A.create(doc)).rejects.toThrow(/E11000|duplicate key/i);
    });

    it('will not create two sessions for one assignment', async () => {
      const S = conn.model('SessA', SessionSchema, 'sessA');
      await S.syncIndexes();
      const now = new Date();
      const doc = {
        assignmentId: 'a1',
        participantId: 'p1',
        clientOrgId: 'o1',
        venueId: 'v1',
        createdAtServer: now,
        lastSeenAt: now,
      };
      await S.create(doc);
      await expect(S.create(doc)).rejects.toThrow(/E11000|duplicate key/i);
    });

    it('will not accept two reports for one session', async () => {
      const R = conn.model('RepA', ReportSchema, 'repA');
      await R.syncIndexes();
      const doc = {
        sessionId: 's1',
        clientOrgId: 'o1',
        participantId: 'p1',
        notes: 'n',
        rating: 4,
        submittedAt: new Date(),
      };
      await R.create(doc);
      await expect(R.create(doc)).rejects.toThrow(/E11000|duplicate key/i);
    });
  });

  describe('verification results are append-only (rule 8)', () => {
    it('a re-run writes a new document and leaves the old verdict intact', async () => {
      const VR = conn.model('VRB', VerificationResultSchema, 'vrB');
      const base = {
        sessionId: 's-append',
        clientOrgId: 'o1',
        signals: [{ code: 'proximity', contribution: 6, reason: 'inside the geofence' }],
        rollups: { fixCount: 3, dwellSeconds: 90, coverageRatio: 1, minDistanceM: 12, medianAccuracyM: 10, unusableFixCount: 0 },
      };
      await VR.create({ ...base, score: 40, verdict: 'needs_review', engineVersion: 'v1' });
      await VR.create({ ...base, score: 80, verdict: 'auto_verified', engineVersion: 'v2' });

      const all = await VR.find({ sessionId: 's-append' }).sort({ createdAt: 1 }).lean();
      expect(all).toHaveLength(2);
      expect(all.map((r) => (r as { engineVersion: string }).engineVersion)).toEqual(['v1', 'v2']);
      // The old verdict survives, which is what makes "why was I rejected" answerable.
      expect((all[0] as { verdict: string }).verdict).toBe('needs_review');
    });

    it('stores a reason string with every signal (rule 1)', async () => {
      const VR = conn.model('VRC', VerificationResultSchema, 'vrC');
      const doc = await VR.create({
        sessionId: 's-reason',
        clientOrgId: 'o1',
        score: 60,
        verdict: 'needs_review',
        engineVersion: 'v1',
        signals: [{ code: 'coverage', contribution: -18, reason: 'Only 32% was observed.' }],
        rollups: { fixCount: 5, dwellSeconds: 180, coverageRatio: 0.32, minDistanceM: 24, medianAccuracyM: 11, unusableFixCount: 0 },
      });
      expect(doc.signals[0]!.reason).toContain('32%');
    });

    it('has no boolean verified field anywhere in a stored document (rule 1)', async () => {
      const VR = conn.model('VRD', VerificationResultSchema, 'vrD');
      const doc = await VR.create({
        sessionId: 's-nobool',
        clientOrgId: 'o1',
        score: 90,
        verdict: 'auto_verified',
        engineVersion: 'v1',
        signals: [],
        rollups: { fixCount: 1, dwellSeconds: 0, coverageRatio: 1, minDistanceM: 5, medianAccuracyM: 9, unusableFixCount: 0 },
      });
      expect(JSON.stringify(doc.toObject())).not.toMatch(/"(verified|isVerified)"\s*:/);
    });
  });

  describe('transactional submit (rule 9)', () => {
    it('commits report, session state and outbox together', async () => {
      const R = conn.model('RepB', ReportSchema, 'repB');
      const S = conn.model('SessB', SessionSchema, 'sessB');
      const O = conn.model('OutB', OutboxSchema, 'outB');
      const now = new Date();
      const session = await S.create({
        assignmentId: 'a-tx',
        participantId: 'p1',
        clientOrgId: 'o1',
        venueId: 'v1',
        state: 'ended',
        createdAtServer: now,
        lastSeenAt: now,
      });

      const s = await conn.startSession();
      await s.withTransaction(async () => {
        await R.create(
          [
            {
              sessionId: String(session._id),
              clientOrgId: 'o1',
              participantId: 'p1',
              notes: 'ok',
              rating: 5,
              submittedAt: new Date(),
            },
          ],
          { session: s },
        );
        await S.updateOne({ _id: session._id }, { $set: { state: 'submitted' } }, { session: s });
        await O.create(
          [{ sessionId: String(session._id), runAfter: new Date() }],
          { session: s },
        );
      });
      await s.endSession();

      expect(await R.countDocuments({ sessionId: String(session._id) })).toBe(1);
      expect(await O.countDocuments({ sessionId: String(session._id) })).toBe(1);
      expect((await S.findById(session._id).lean<{ state: string }>())!.state).toBe('submitted');
    });

    it('rolls all three back when any one of them fails', async () => {
      const R = conn.model('RepC', ReportSchema, 'repC');
      const S = conn.model('SessC', SessionSchema, 'sessC');
      const O = conn.model('OutC', OutboxSchema, 'outC');
      const now = new Date();
      const session = await S.create({
        assignmentId: 'a-rb',
        participantId: 'p1',
        clientOrgId: 'o1',
        venueId: 'v1',
        state: 'ended',
        createdAtServer: now,
        lastSeenAt: now,
      });

      const s = await conn.startSession();
      await expect(
        s.withTransaction(async () => {
          await R.create(
            [
              {
                sessionId: String(session._id),
                clientOrgId: 'o1',
                participantId: 'p1',
                notes: 'ok',
                rating: 5,
                submittedAt: new Date(),
              },
            ],
            { session: s },
          );
          await S.updateOne({ _id: session._id }, { $set: { state: 'submitted' } }, { session: s });
          throw new Error('evaluator enqueue failed');
        }),
      ).rejects.toThrow('evaluator enqueue failed');
      await s.endSession();

      // No half-submitted visit: no report, no outbox row, and the state did not move.
      expect(await R.countDocuments({ sessionId: String(session._id) })).toBe(0);
      expect(await O.countDocuments({ sessionId: String(session._id) })).toBe(0);
      expect((await S.findById(session._id).lean<{ state: string }>())!.state).toBe('ended');
    });
  });

  describe('seed', () => {
    it('is idempotent, so docker compose up can run it every time', async () => {
      const uri = mongod.getUri('seed-test');
      await seed(uri);
      const after1 = await countSeed(uri);
      await seed(uri);
      const after2 = await countSeed(uri);
      expect(after2).toEqual(after1);
      expect(after1.venues).toBe(2);
      expect(after1.orgs).toBe(1);
      expect(after1.assignments).toBe(10);
    });

    it('seeds one indoor and one outdoor venue with real Kuwait coordinates', async () => {
      const uri = mongod.getUri('seed-test');
      const c = await mongoose.createConnection(uri).asPromise();
      const V = c.model('Venue', VenueSchema);
      const venues = await V.find().lean<
        { indoor: boolean; location: { coordinates: [number, number] }; radiusM: number }[]
      >();
      expect(venues.filter((v) => v.indoor)).toHaveLength(1);
      expect(venues.filter((v) => !v.indoor)).toHaveLength(1);
      for (const v of venues) {
        const [lng, lat] = v.location.coordinates;
        // Kuwait, and stored [lng, lat] not [lat, lng] -- the classic GeoJSON bug.
        expect(lng).toBeGreaterThan(46);
        expect(lng).toBeLessThan(49);
        expect(lat).toBeGreaterThan(28);
        expect(lat).toBeLessThan(31);
        expect(v.radiusM).toBeGreaterThanOrEqual(25);
        expect(v.radiusM).toBeLessThanOrEqual(500);
      }
      // The indoor venue gets the wider fence, because the fix degrades indoors.
      const indoor = venues.find((v) => v.indoor)!;
      const outdoor = venues.find((v) => !v.indoor)!;
      expect(indoor.radiusM).toBeGreaterThan(outdoor.radiusM);
      await c.close();
    });

    async function countSeed(uri: string) {
      const c = await mongoose.createConnection(uri).asPromise();
      const out = {
        orgs: await c.model('ClientOrg', ClientOrgSchema).countDocuments({ slug: SEED_ORG_SLUG }),
        venues: await c.model('Venue', VenueSchema).countDocuments(),
        tasks: await c.model('Task', TaskSchema).countDocuments(),
        assignments: await c.model('Assignment', AssignmentSchema).countDocuments(),
        sessions: await c.model('Session', SessionSchema).countDocuments(),
      };
      await c.close();
      return out;
    }
  });
});
