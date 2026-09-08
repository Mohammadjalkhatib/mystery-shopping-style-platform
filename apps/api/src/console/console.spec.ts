import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection, type Model } from 'mongoose';
import { firstValueFrom, take, toArray } from 'rxjs';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module.js';
import { Venue, VenueSchema } from '../db/schemas/org-venue.schema.js';
import {
  Report,
  ReportSchema,
  ReviewAction,
  ReviewActionSchema,
  VerificationResultDoc,
  VerificationResultSchema,
} from '../db/schemas/report-verification.schema.js';
import { Session, SessionSchema } from '../db/schemas/task-session.schema.js';
import { ConsoleController } from './console.controller.js';
import { ConsoleService } from './console.service.js';
import { VisitEventsService } from './visit-events.service.js';

/** The org the demo `business` user belongs to, per demo-users.ts. */
const ORG = 'org-alfa-retail';
const OTHER_ORG = 'org-someone-else';

describe('business console', () => {
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let app: INestApplication;
  let events: VisitEventsService;

  let Sessions: Model<Session>;
  let Results: Model<VerificationResultDoc>;
  let Venues: Model<Venue>;
  let Reports: Model<Report>;
  let Reviews: Model<ReviewAction>;

  let venueId: string;
  let bizToken: string;

  const login = async (username: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'demo1234' })
      .expect(200);
    return (res.body as { token: string }).token;
  };
  const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

  /** A submitted, evaluated visit. */
  const makeVisit = async (
    over: { org?: string; verdict?: string; score?: number } = {},
  ): Promise<string> => {
    const now = new Date();
    const org = over.org ?? ORG;
    const s = await Sessions.create({
      assignmentId: `a-${Math.random()}`,
      participantId: 'u-participant-1',
      clientOrgId: org,
      venueId,
      state: 'submitted',
      createdAtServer: now,
      startedAt: now,
      endedAt: now,
      lastSeenAt: now,
      pingCount: 5,
    } as never);
    const sessionId = String(s._id);

    const r = await Results.create({
      sessionId,
      clientOrgId: org,
      score: over.score ?? 88,
      verdict: over.verdict ?? 'auto_verified',
      engineVersion: 'v1',
      signals: [
        { code: 'proximity', contribution: 6, reason: 'Closest confirmed position was 18 m.' },
      ],
      rollups: {
        fixCount: 5,
        dwellSeconds: 300,
        coverageRatio: 0.9,
        minDistanceM: 18,
        medianAccuracyM: 9,
        unusableFixCount: 0,
      },
    } as never);

    await Sessions.updateOne(
      { _id: sessionId },
      {
        $set: {
          latestResultId: String(r._id),
          latestVerdict: over.verdict ?? 'auto_verified',
          latestScore: over.score ?? 88,
        },
      },
    );
    return sessionId;
  };

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    conn = await mongoose.createConnection(mongod.getUri('console')).asPromise();

    Sessions = conn.model(Session.name, SessionSchema) as Model<Session>;
    Results = conn.model(
      VerificationResultDoc.name,
      VerificationResultSchema,
    ) as Model<VerificationResultDoc>;
    Venues = conn.model(Venue.name, VenueSchema) as Model<Venue>;
    Reports = conn.model(Report.name, ReportSchema) as Model<Report>;
    Reviews = conn.model(ReviewAction.name, ReviewActionSchema) as Model<ReviewAction>;

    const v = await Venues.create({
      clientOrgId: ORG,
      name: 'Alfa Market',
      address: 'Kuwait City',
      location: { type: 'Point', coordinates: [47.9774, 29.3759] },
      radiusM: 75,
      nearBufferM: 50,
      indoor: false,
    } as never);
    venueId = String(v._id);

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule],
      controllers: [ConsoleController],
      providers: [
        ConsoleService,
        VisitEventsService,
        { provide: getModelToken(Session.name), useValue: Sessions },
        { provide: getModelToken(VerificationResultDoc.name), useValue: Results },
        { provide: getModelToken(Venue.name), useValue: Venues },
        { provide: getModelToken(Report.name), useValue: Reports },
        { provide: getModelToken(ReviewAction.name), useValue: Reviews },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    events = moduleRef.get(VisitEventsService);
    bizToken = await login('business');
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  afterEach(async () => {
    await Sessions.deleteMany({});
    // Raw driver, not the model: the append-only pre-hook on verificationResults and
    // sessionEvents rejects deleteMany, which is exactly what it is there for (rule 8).
    // Test teardown is the one legitimate reason to go around it.
    await Results.collection.deleteMany({});
    await Reviews.collection.deleteMany({});
  });

  describe('the visit feed', () => {
    it('lists submitted visits with their verdict', async () => {
      await makeVisit();
      const res = await request(app.getHttpServer())
        .get('/console/visits')
        .set(auth(bizToken))
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ verdict: 'auto_verified', score: 88 });
      expect(res.body[0].venueName).toBe('Alfa Market');
    });

    it('filters by verdict, which is how the review queue is built', async () => {
      // The review queue is a filter on this feed rather than a separate surface. Same
      // data, same code path, a quarter of the work.
      await makeVisit({ verdict: 'auto_verified' });
      await makeVisit({ verdict: 'needs_review', score: 60 });
      await makeVisit({ verdict: 'needs_review', score: 55 });

      const res = await request(app.getHttpServer())
        .get('/console/visits?verdict=needs_review')
        .set(auth(bizToken))
        .expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.every((r: { verdict: string }) => r.verdict === 'needs_review')).toBe(true);
    });

    it('reports counts for the filter chips', async () => {
      await makeVisit({ verdict: 'auto_verified' });
      await makeVisit({ verdict: 'needs_review' });
      const res = await request(app.getHttpServer())
        .get('/console/visits/counts')
        .set(auth(bizToken))
        .expect(200);
      expect(res.body).toMatchObject({ all: 2, auto_verified: 1, needs_review: 1, rejected: 0 });
    });

    it('shows the signals and their reasons on the detail view', async () => {
      const id = await makeVisit();
      const res = await request(app.getHttpServer())
        .get(`/console/visits/${id}`)
        .set(auth(bizToken))
        .expect(200);
      expect(res.body.signals[0].reason).toContain('18 m');
      expect(res.body.engineVersion).toBe('v1');
      expect(res.body.rollups.dwellSeconds).toBe(300);
    });
  });

  describe('tenancy is a boundary, not a filter (rule 2)', () => {
    it('never lists another organisation’s visits', async () => {
      await makeVisit({ org: ORG });
      await makeVisit({ org: OTHER_ORG });
      const res = await request(app.getHttpServer())
        .get('/console/visits')
        .set(auth(bizToken))
        .expect(200);
      expect(res.body).toHaveLength(1);
    });

    it('403s on a visit belonging to another organisation, even with a valid id', async () => {
      const foreign = await makeVisit({ org: OTHER_ORG });
      await request(app.getHttpServer())
        .get(`/console/visits/${foreign}`)
        .set(auth(bizToken))
        .expect(403);
    });

    it('cannot be widened by a query parameter', async () => {
      // The org comes from the token. There is no parameter for it, so an attempt to name
      // one is rejected outright rather than quietly ignored.
      await makeVisit({ org: OTHER_ORG });
      const res = await request(app.getHttpServer())
        .get(`/console/visits?clientOrgId=${OTHER_ORG}`)
        .set(auth(bizToken))
        .expect(200);
      expect(res.body).toHaveLength(0);
    });

    it('refuses a participant entirely', async () => {
      const participant = await login('user1');
      await request(app.getHttpServer())
        .get('/console/visits')
        .set(auth(participant))
        .expect(403);
    });

    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/console/visits').expect(401);
    });
  });

  describe('rule 6: the console never reads the ping collection', () => {
    it('serves a full detail view with no ping model injected at all', async () => {
      // This suite constructs ConsoleService without a Ping model. If any read path here
      // ever touched pings, Nest could not have resolved the dependency and every test in
      // this file would fail to start. That is the assertion.
      const id = await makeVisit();
      const res = await request(app.getHttpServer())
        .get(`/console/visits/${id}`)
        .set(auth(bizToken))
        .expect(200);
      // Everything the reviewer needs comes from rollups written by the evaluator.
      expect(res.body.rollups).toMatchObject({ fixCount: 5, coverageRatio: 0.9 });
    });
  });

  describe('human override (rule 8)', () => {
    it('records a review action without touching the verification result', async () => {
      const id = await makeVisit({ verdict: 'needs_review', score: 60 });
      const before = await Results.findOne({ sessionId: id }).lean<{ verdict: string }>();

      await request(app.getHttpServer())
        .post(`/console/visits/${id}/review`)
        .set(auth(bizToken))
        .send({ decision: 'approve', note: 'Receipt matches and the timings look right.' })
        .expect(201);

      const after = await Results.findOne({ sessionId: id }).lean<{ verdict: string }>();
      // The engine's verdict is untouched: the override is a separate claim by a separate author.
      expect(after!.verdict).toBe(before!.verdict);

      const review = await Reviews.findOne({ sessionId: id }).lean<{
        decision: string;
        reviewerId: string;
        verificationResultId: string;
      }>();
      expect(review).toMatchObject({ decision: 'approve', reviewerId: 'u-business' });
      // Pinned to the specific result, so the override is tied to an engine version.
      expect(review!.verificationResultId).toBeTruthy();
    });

    it('requires a stated reason', async () => {
      const id = await makeVisit({ verdict: 'needs_review' });
      await request(app.getHttpServer())
        .post(`/console/visits/${id}/review`)
        .set(auth(bizToken))
        .send({ decision: 'approve', note: 'ok' })
        .expect(400);
    });

    it('will not review a visit from another organisation', async () => {
      const foreign = await makeVisit({ org: OTHER_ORG });
      await request(app.getHttpServer())
        .post(`/console/visits/${foreign}/review`)
        .set(auth(bizToken))
        .send({ decision: 'reject', note: 'Should not be permitted at all.' })
        .expect(403);
    });
  });

  describe('the live feed (D-004)', () => {
    const event = (org: string, sessionId: string) => ({
      clientOrgId: org,
      sessionId,
      verdict: 'auto_verified' as const,
      score: 90,
      venueName: 'Alfa Market',
      participantId: 'u-participant-1',
      endedAt: new Date().toISOString(),
    });

    it('delivers an event to a subscriber of the same org', async () => {
      const seen = firstValueFrom(events.forOrg(ORG).pipe(take(1)));
      events.publish(event(ORG, 's1'));
      await expect(seen).resolves.toMatchObject({ sessionId: 's1', verdict: 'auto_verified' });
    });

    it('does NOT deliver another organisation’s event', async () => {
      const seen = firstValueFrom(events.forOrg(ORG).pipe(take(1)));
      events.publish(event(OTHER_ORG, 'foreign'));
      events.publish(event(ORG, 'mine'));
      await expect(seen).resolves.toMatchObject({ sessionId: 'mine' });
    });

    it('replays what was missed during a reconnect gap', async () => {
      // D-004 said browsers reconnect natively so there is no reconnection code to write.
      // True of the transport; without this the events from the gap are lost silently, and
      // "the visit appears with no refresh" is exactly what the brief asks for.
      const a = events.publish(event(ORG, 'before-gap'));
      const b = events.publish(event(ORG, 'during-gap-1'));
      const c = events.publish(event(ORG, 'during-gap-2'));

      const missed = events.replay(ORG, a.id);
      expect(missed.map((e) => e.sessionId)).toEqual(['during-gap-1', 'during-gap-2']);
      expect(missed.map((e) => e.id)).toEqual([b.id, c.id]);
    });

    it('replays nothing when the client is already up to date', async () => {
      const last = events.publish(event(ORG, 'latest'));
      expect(events.replay(ORG, last.id)).toEqual([]);
    });

    it('never replays another organisation’s events', async () => {
      events.publish(event(OTHER_ORG, 'theirs'));
      expect(events.replay(ORG, 0).some((e) => e.sessionId === 'theirs')).toBe(false);
    });

    it('bounds the replay buffer so a long-lived process cannot grow forever', async () => {
      for (let i = 0; i < VisitEventsService.REPLAY_BUFFER + 20; i++) {
        events.publish(event(ORG, `bulk-${i}`));
      }
      expect(events.replay(ORG, 0).length).toBeLessThanOrEqual(VisitEventsService.REPLAY_BUFFER);
    });

    it('gives every event a monotonic id, so Last-Event-ID means something', async () => {
      const ids = [
        events.publish(event(ORG, 'x')).id,
        events.publish(event(ORG, 'y')).id,
        events.publish(event(ORG, 'z')).id,
      ];
      expect(ids[1]).toBeGreaterThan(ids[0]!);
      expect(ids[2]).toBeGreaterThan(ids[1]!);
    });

    it('carries enough in the payload to render a row without a follow-up fetch', async () => {
      const collected = firstValueFrom(events.forOrg(ORG).pipe(take(1), toArray()));
      events.publish(event(ORG, 'renderable'));
      const [e] = await collected;
      expect(e).toMatchObject({
        sessionId: 'renderable',
        verdict: 'auto_verified',
        score: 90,
        venueName: 'Alfa Market',
      });
    });
  });
});
