import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection } from 'mongoose';
import { MAX_PING_RETENTION_DAYS, syncPingTtlIndex } from './indexes.js';
import { VenueSchema } from './schemas/org-venue.schema.js';
import { PING_TTL_INDEX_NAME } from './schemas/ping.schema.js';
import { SessionEventSchema, SessionSchema } from './schemas/task-session.schema.js';
import { VerificationResultSchema } from './schemas/report-verification.schema.js';
import { seed } from './seed.js';

/**
 * Regressions for everything the schema-reviewer pass turned up (D-012).
 *
 * Kept in its own file rather than folded into schemas.spec.ts, because each of these exists
 * to pin one specific finding and a future reader should be able to see which.
 */
describe('schema-reviewer findings (D-012)', () => {
  let mongod: MongoMemoryReplSet;
  let conn: Connection;

  const goodRollups = {
    fixCount: 3,
    dwellSeconds: 90,
    coverageRatio: 1,
    minDistanceM: 12,
    medianAccuracyM: 10,
    unusableFixCount: 0,
  };
  const baseResult = {
    sessionId: 's',
    clientOrgId: 'o',
    score: 50,
    verdict: 'needs_review' as const,
    engineVersion: 'v1',
    signals: [],
    rollups: goodRollups,
  };

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    conn = await mongoose.createConnection(mongod.getUri('review-findings')).asPromise();
  });

  afterAll(async () => {
    await conn?.close();
    await mongod?.stop();
  });

  describe('rollups are a real sub-schema, not Mixed', () => {
    it('rejects a rollups object with fields missing', async () => {
      // As `type: Object` this stored silently, and because results are append-only the
      // console would have rendered blanks forever with no repair path.
      const VR = conn.model('VRE', VerificationResultSchema, 'vrE');
      const doc = new VR({ ...baseResult, rollups: { fixCount: 1 } });
      await expect(doc.validate()).rejects.toThrow();
    });

    it('rejects a coverageRatio outside 0..1', async () => {
      const VR = conn.model('VRF', VerificationResultSchema, 'vrF');
      await expect(
        VR.create({ ...baseResult, rollups: { ...goodRollups, coverageRatio: -4 } }),
      ).rejects.toThrow();
    });

    it('accepts null for the two genuinely nullable fields', async () => {
      // "No usable fix" is a real outcome and must stay distinguishable from "not written".
      const VR = conn.model('VRJ', VerificationResultSchema, 'vrJ');
      const doc = await VR.create({
        ...baseResult,
        rollups: { ...goodRollups, minDistanceM: null, medianAccuracyM: null },
      });
      expect(doc.rollups.minDistanceM).toBeNull();
    });
  });

  describe('score validation', () => {
    it('rejects NaN, which satisfies both min and max', async () => {
      // Both `NaN < 0` and `NaN > 100` are false. coverageRatio divides by
      // (endedAt - startedAt) and endedAt is nullable, so this path is reachable.
      const VR = conn.model('VRG', VerificationResultSchema, 'vrG');
      await expect(VR.create({ ...baseResult, score: Number.NaN })).rejects.toThrow();
    });
  });

  describe('rule 1: a signal without a reason is not a signal', () => {
    it('rejects a signal missing its reason', async () => {
      const VR = conn.model('VRH', VerificationResultSchema, 'vrH');
      await expect(
        VR.create({
          ...baseResult,
          signals: [{ code: 'proximity' } as unknown as (typeof baseResult.signals)[number]],
        }),
      ).rejects.toThrow();
    });
  });

  describe('rule 8: append-only is enforced, not just documented', () => {
    it('makes an in-place update of a verification result impossible', async () => {
      const VR = conn.model('VRI', VerificationResultSchema, 'vrI');
      await VR.create({ ...baseResult, sessionId: 's-immutable' });

      await expect(
        VR.updateOne({ sessionId: 's-immutable' }, { $set: { verdict: 'auto_verified' } }),
      ).rejects.toThrow(/append-only/);
      await expect(VR.deleteOne({ sessionId: 's-immutable' })).rejects.toThrow(/append-only/);

      const still = await VR.findOne({ sessionId: 's-immutable' }).lean<{ verdict: string }>();
      expect(still!.verdict).toBe('needs_review');
    });

    it('makes a session event immutable too', async () => {
      const SE = conn.model('SEA', SessionEventSchema, 'seA');
      await SE.create({
        sessionId: 's-ev',
        from: 'pending',
        event: 'start',
        to: 'active',
        at: new Date(),
        actor: 'p1',
      });
      await expect(
        SE.updateOne({ sessionId: 's-ev' }, { $set: { to: 'submitted' } }),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('venue coordinates: the validator we owe for declining the 2dsphere index', () => {
    it('rejects a latitude outside -90..90, which is how most axis swaps present', async () => {
      // Kuwait is lng ~48, lat ~29. Swapping gives [29.3759, 47.9774] -- BOTH still in range,
      // so a range check cannot see it (see the test below). But any venue with a longitude
      // above 90 -- most of Asia and the Pacific -- produces an out-of-range latitude when
      // swapped, and this catches those.
      const V = conn.model('VenueB', VenueSchema, 'venuesB');
      const base = { clientOrgId: 'o1', name: 'v2', address: 'a', radiusM: 75, nearBufferM: 50 };
      await expect(
        V.create({
          ...base,
          location: { type: 'Point' as const, coordinates: [35.6762, 139.6503] }, // Tokyo, swapped
        }),
      ).rejects.toThrow();
    });

    it('DOCUMENTS THE GAP: a swap where both values are in range is not detectable here', async () => {
      // [29.3759, 47.9774] is the Kuwait pair swapped. It is a perfectly valid point in
      // Ukraine, ~2,900 km away, and no range check can tell it from an intentional venue.
      // The schema-reviewer pass suggested a validator would catch this; it does not, and
      // pretending otherwise would be worse than the gap. What WOULD catch it is a bounds
      // check against the operating region, which is a product decision rather than a schema
      // one -- recorded in D-012 rather than guessed at here.
      const V = conn.model('VenueD', VenueSchema, 'venuesD');
      const base = { clientOrgId: 'o1', name: 'v4', address: 'a', radiusM: 75, nearBufferM: 50 };
      await expect(
        V.create({
          ...base,
          location: { type: 'Point' as const, coordinates: [29.3759, 47.9774] },
        }),
      ).resolves.toBeDefined();
    });

    it('rejects a coordinate pair of the wrong length', async () => {
      const V = conn.model('VenueC', VenueSchema, 'venuesC');
      const base = { clientOrgId: 'o1', name: 'v3', address: 'a', radiusM: 75, nearBufferM: 50 };
      await expect(
        V.create({ ...base, location: { type: 'Point' as const, coordinates: [47.9774] } }),
      ).rejects.toThrow();
    });
  });

  describe('the TTL index has exactly one owner', () => {
    it('is not declared on PingSchema, so autoIndex cannot race the reconcile', async () => {
      // Declaring it in both places made the effective retention window depend on which
      // async call landed first, while the log claimed the configured value either way.
      const { PingSchema } = await import('./schemas/ping.schema.js');
      const declared = PingSchema.indexes().map(([spec]) => JSON.stringify(spec));
      expect(declared).not.toContain(JSON.stringify({ receivedAt: 1 }));
      // The compound index that legitimately leads with sessionId is still there.
      expect(declared).toContain(JSON.stringify({ sessionId: 1, receivedAt: 1 }));
    });

    it('refuses a retention window above the ceiling as well as below the floor', async () => {
      await expect(syncPingTtlIndex(conn, 36_500)).rejects.toThrow(/ceiling/);
      await expect(syncPingTtlIndex(conn, 0)).rejects.toThrow(/positive number/);
      await expect(syncPingTtlIndex(conn, MAX_PING_RETENTION_DAYS)).resolves.toBeDefined();
    });

    it('still creates and moves the index once it owns it outright', async () => {
      await syncPingTtlIndex(conn, 30);
      const idx = (await conn.collection('pings').indexes()).find(
        (i) => i.name === PING_TTL_INDEX_NAME,
      );
      expect(idx?.expireAfterSeconds).toBe(30 * 86_400);
    });
  });

  describe('the seeded demo does not reap itself', () => {
    it('re-seeding revives sessions the reaper abandoned', async () => {
      // With $setOnInsert on the clocks, every demo session went terminal 15 minutes after
      // the first boot and re-running the seed could not bring it back. The only recovery
      // was `docker compose down -v`.
      const uri = mongod.getUri('seed-revive');
      await seed(uri);

      const c = await mongoose.createConnection(uri).asPromise();
      await c
        .model('Session', SessionSchema)
        .updateMany({}, { $set: { state: 'abandoned', lastSeenAt: new Date(0) } });
      await c.close();

      await seed(uri);

      const c2 = await mongoose.createConnection(uri).asPromise();
      const revived = await c2
        .model('Session', SessionSchema)
        .find()
        .lean<{ state: string; lastSeenAt: Date }[]>();
      expect(revived).toHaveLength(10);
      for (const s of revived) {
        expect(s.state).toBe('pending');
        expect(Date.now() - new Date(s.lastSeenAt).getTime()).toBeLessThan(120_000);
      }
      await c2.close();
    });
  });
});
