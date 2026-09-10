import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { type Connection, type Model } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module.js';
import { Venue, VenueSchema } from '../db/schemas/org-venue.schema.js';
import {
  Report,
  ReportSchema,
  ReviewAction,
  ReviewActionSchema,
} from '../db/schemas/report-verification.schema.js';
import {
  Assignment,
  AssignmentSchema,
  Session,
  SessionEventDoc,
  SessionEventSchema,
  SessionSchema,
  Task,
  TaskSchema,
} from '../db/schemas/task-session.schema.js';
import { ReaperService } from '../session/reaper.service.js';
import { SessionsService } from '../session/sessions.service.js';
import { ParticipantController } from './participant.controller.js';
import { ParticipantEventsService } from './participant-events.service.js';
import { ParticipantService } from './participant.service.js';
import type { ParticipantDashboard } from './participant.controller.js';
import type { ParticipantNotification } from './participant.service.js';
import { seedDemoUsers } from '../../test/seed-users.js';
import { testDbModule } from '../../test/nest-db.js';

const ORG = 'org-alfa-retail';
const ME = 'u-participant-1';
const SOMEONE_ELSE = 'u-participant-2';
const TASK_TITLE = 'Coffee counter greeting';

/**
 * The participant's own record.
 *
 * Two things are tested here and nothing else: the AUTHORIZATION boundary (one test per
 * boundary, CLAUDE.md section 5) and the release rule as it behaves through real HTTP against
 * a real database. The release rule's own table lives in `outcome.spec.ts`; what this file
 * adds is that the wiring feeds it correctly -- which is where the schema-reviewer pass found
 * the `undefined !== null` bug that no pure test could have seen.
 *
 * A single mongod, not a replica set: nothing here opens a transaction.
 */
describe('participant dashboard', () => {
  let mongod: MongoMemoryServer;
  let conn: Connection;
  let app: INestApplication;

  let Venues: Model<Venue>;
  let Tasks: Model<Task>;
  let Assignments: Model<Assignment>;
  let Sessions: Model<Session>;
  let Reports: Model<Report>;
  let Reviews: Model<ReviewAction>;

  let myToken: string;
  let otherToken: string;
  let bizToken: string;

  let venueId: string;
  /** Bumped per fixture, because `{ clientOrgId, venueId, title }` on tasks is unique. */
  let taskSeq = 0;

  const login = async (username: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'demo1234' })
      .expect(200);
    return (res.body as { token: string }).token;
  };
  const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

  /** A task, with a title that is unique per call: `{ clientOrgId, venueId, title }` is. */
  const seedTask = async (title = TASK_TITLE): Promise<string> => {
    const t = await Tasks.create({
      clientOrgId: ORG,
      venueId,
      title: `${title} ${(taskSeq += 1)}`,
      brief: 'Order at the counter and note how long the greeting takes.',
      expectedDwellSeconds: 300,
      active: true,
    } as never);
    return String(t._id);
  };

  /**
   * A session in whatever shape the case needs. Fields are set explicitly, never defaulted.
   *
   * A NEW task and assignment each time, because `{ taskId, participantId }` is unique -- one
   * participant is not given the same task twice -- so a fixture that reused one could not
   * build a history longer than a single visit, which is exactly what these tests need.
   */
  const seedSession = async (
    over: Record<string, unknown> = {},
    participantId: string = ME,
  ): Promise<string> => {
    const now = new Date();
    const a = await Assignments.create({
      taskId: await seedTask(),
      participantId,
      clientOrgId: ORG,
      consentedAt: null,
      consentVersion: null,
    } as never);
    const s = await Sessions.create({
      assignmentId: String(a._id),
      participantId,
      clientOrgId: ORG,
      venueId,
      state: 'pending',
      createdAtServer: now,
      lastSeenAt: now,
      pingCount: 0,
      ...over,
    } as never);
    return String(s._id);
  };

  const dashboard = async (tok = myToken): Promise<ParticipantDashboard> => {
    const res = await request(app.getHttpServer())
      .get('/me/dashboard')
      .set(auth(tok))
      .expect(200);
    return res.body as ParticipantDashboard;
  };

  const notifications = async (tok = myToken): Promise<ParticipantNotification[]> => {
    const res = await request(app.getHttpServer())
      .get('/me/notifications')
      .set(auth(tok))
      .expect(200);
    return res.body as ParticipantNotification[];
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    conn = await mongoose.createConnection(mongod.getUri('participant')).asPromise();
    // Real accounts now back /auth/login (D-037), so the roster has to exist.
    await seedDemoUsers(conn);

    Venues = conn.model(Venue.name, VenueSchema) as Model<Venue>;
    Tasks = conn.model(Task.name, TaskSchema) as Model<Task>;
    Assignments = conn.model(Assignment.name, AssignmentSchema) as Model<Assignment>;
    Sessions = conn.model(Session.name, SessionSchema) as Model<Session>;
    Reports = conn.model(Report.name, ReportSchema) as Model<Report>;
    Reviews = conn.model(ReviewAction.name, ReviewActionSchema) as Model<ReviewAction>;
    const Events = conn.model(SessionEventDoc.name, SessionEventSchema);

    const v = await Venues.create({
      clientOrgId: ORG,
      name: 'Alfa Sweifieh',
      address: 'Mecca Street, Amman',
      location: { type: 'Point', coordinates: [35.9137, 31.957] },
      radiusM: 120,
      nearBufferM: 50,
      indoor: true,
    } as never);
    venueId = String(v._id);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        testDbModule(conn),
        AuthModule,
      ],
      controllers: [ParticipantController],
      providers: [
        ParticipantService,
        ParticipantEventsService,
        SessionsService,
        ReaperService,
        { provide: getModelToken(Venue.name), useValue: Venues },
        { provide: getModelToken(Task.name), useValue: Tasks },
        { provide: getModelToken(Assignment.name), useValue: Assignments },
        { provide: getModelToken(Session.name), useValue: Sessions },
        { provide: getModelToken(SessionEventDoc.name), useValue: Events },
        { provide: getModelToken(Report.name), useValue: Reports },
        { provide: getModelToken(ReviewAction.name), useValue: Reviews },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    myToken = await login('user1');
    otherToken = await login('user2');
    bizToken = await login('business');
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Sessions.deleteMany({}),
      Assignments.deleteMany({}),
      // Tasks too: `seedSession` creates one per visit and they carry a unique
      // { clientOrgId, venueId, title }.
      Tasks.deleteMany({}),
      Reports.deleteMany({}),
      Reviews.deleteMany({}),
    ]);
  });

  /* ------------------------------------------------ authorization boundaries */

  describe('authorization boundaries', () => {
    const reads = ['/me/dashboard', '/me/notifications'];

    it.each(reads)('GET %s is 401 without a token', async (path) => {
      await request(app.getHttpServer()).get(path).expect(401);
    });

    it.each(reads)('GET %s is 403 for a business user', async (path) => {
      await request(app.getHttpServer()).get(path).set(auth(bizToken)).expect(403);
    });

    it('POST /me/notifications/:id/seen is 403 for a business user', async () => {
      const id = await seedSession();
      await request(app.getHttpServer())
        .post(`/me/notifications/${id}/seen`)
        .set(auth(bizToken))
        .send({ kind: 'assignment' })
        .expect(403);
    });

    /**
     * The boundary that matters most on this surface. Every read is scoped to the token's
     * subject and no path carries an id, so the only thing left to prove is that a
     * participant cannot ACK -- and therefore cannot touch -- another person's visit.
     */
    it('a participant cannot acknowledge another participant\'s visit', async () => {
      const id = await seedSession();
      await request(app.getHttpServer())
        .post(`/me/notifications/${id}/seen`)
        .set(auth(otherToken))
        .send({ kind: 'assignment' })
        .expect(403);
      const after = await Sessions.findById(id).lean<{ assignmentSeenAt: Date | null }>();
      expect(after?.assignmentSeenAt ?? null).toBeNull();
    });

    it('another participant sees none of my visits in their own dashboard', async () => {
      await seedSession();
      expect((await dashboard(otherToken)).visits).toHaveLength(0);
    });

    it('a visit belonging to someone else never appears in mine', async () => {
      const now = new Date();
      await seedSession(
        {
          state: 'submitted',
          endedAt: now,
          pingCount: 3,
          latestVerdict: 'auto_verified',
          latestResultAt: now,
        },
        SOMEONE_ELSE,
      );

      expect((await dashboard()).visits).toHaveLength(0);
    });

    it('an unknown notification kind is rejected by the DTO', async () => {
      const id = await seedSession();
      await request(app.getHttpServer())
        .post(`/me/notifications/${id}/seen`)
        .set(auth(myToken))
        .send({ kind: 'everything' })
        .expect(400);
    });

    /** Rule 2. The read timestamp is the server's, and a client may not name it. */
    it('a client-supplied seenAt is refused, not ignored', async () => {
      const id = await seedSession();
      await request(app.getHttpServer())
        .post(`/me/notifications/${id}/seen`)
        .set(auth(myToken))
        .send({ kind: 'assignment', seenAt: '2020-01-01T00:00:00.000Z' })
        .expect(400);
    });
  });

  /* -------------------------------------------------------- what is released */

  describe('what a participant is told', () => {
    const submitted = (over: Record<string, unknown> = {}): Record<string, unknown> => {
      const now = new Date();
      return {
        state: 'submitted',
        startedAt: new Date(now.getTime() - 20 * 60_000),
        endedAt: new Date(now.getTime() - 5 * 60_000),
        lastSeenAt: now,
        pingCount: 12,
        ...over,
      };
    };

    it('an auto_verified visit reads as approved, with no score and no signals', async () => {
      await seedSession(submitted({ latestVerdict: 'auto_verified', latestScore: 88, latestResultAt: new Date() }));
      const [row] = (await dashboard()).visits;

      expect(row?.outcome).toBe('approved');
      expect(row?.decidedByHuman).toBe(false);
      expect(row?.feedback).toBeNull();

      /**
       * The whole contract, asserted as an exact key set rather than as a search for values
       * that should be absent.
       *
       * This started as `expect(JSON.stringify(row)).not.toContain('88')` against a score of
       * 88, and it FLAKED: the row is full of ISO timestamps and one ending `.588Z` contains
       * the string. A leak check whose result depends on the wall clock is worse than no leak
       * check, because it teaches whoever hits it that the suite is noisy.
       *
       * An allowlist is also the stronger assertion. A future field added to
       * `ParticipantVisitRow` fails here until someone deliberately adds it to this list, which
       * is exactly the review D-034 wants before anything new reaches a participant's screen.
       */
      expect(Object.keys(row!).sort()).toEqual([
        'assignedAt',
        'consentedAt',
        'decidedAt',
        'decidedByHuman',
        'endedAt',
        'feedback',
        'outcome',
        'report',
        'seen',
        'sessionId',
        'startedAt',
        'state',
        'submittedAt',
        'taskBrief',
        'taskTitle',
        'terminalReasonCode',
        'venueAddress',
        'venueName',
      ]);
    });

    it('a rejected verdict with no human decision reads as in_review, not as a rejection', async () => {
      await seedSession(submitted({ latestVerdict: 'rejected', latestScore: 12, latestResultAt: new Date() }));
      const [row] = (await dashboard()).visits;

      expect(row?.outcome).toBe('in_review');
      expect(row?.feedback).toBeNull();
    });

    it('a reviewer\'s participant-facing feedback is shown; the internal note is NOT', async () => {
      const id = await seedSession(submitted({ latestVerdict: 'needs_review', latestResultAt: new Date() }));
      await Reviews.create({
        sessionId: id,
        verificationResultId: '65b0000000000000000000aa',
        clientOrgId: ORG,
        reviewerId: 'u-business',
        decision: 'approve',
        note: 'Coverage was thin but the photo matches the counter layout.',
        feedbackToParticipant: 'Thanks, this was useful. Try to keep the screen on next time.',
        at: new Date(),
      } as never);

      const [row] = (await dashboard()).visits;
      expect(row?.outcome).toBe('approved');
      expect(row?.decidedByHuman).toBe(true);
      expect(row?.feedback).toBe('Thanks, this was useful. Try to keep the screen on next time.');
      // The candid internal note must not travel with it. This is the projection guard.
      expect(JSON.stringify(row)).not.toContain('Coverage was thin');
      expect(JSON.stringify(row)).not.toContain('u-business');
    });

    it('a reviewer who wrote no feedback releases the outcome with none', async () => {
      const id = await seedSession(submitted({ latestVerdict: 'needs_review', latestResultAt: new Date() }));
      await Reviews.create({
        sessionId: id,
        verificationResultId: '65b0000000000000000000aa',
        clientOrgId: ORG,
        reviewerId: 'u-business',
        decision: 'reject',
        note: 'Photo is of a different branch entirely.',
        at: new Date(),
      } as never);

      const [row] = (await dashboard()).visits;
      expect(row?.outcome).toBe('not_approved');
      expect(row?.feedback).toBeNull();
    });

    it('their own report is echoed back to them', async () => {
      const id = await seedSession(submitted({ latestVerdict: 'auto_verified', latestResultAt: new Date() }));
      await Reports.create({
        sessionId: id,
        clientOrgId: ORG,
        participantId: ME,
        notes: 'Greeted within ten seconds.',
        rating: 5,
        submittedAt: new Date(),
      } as never);

      const [row] = (await dashboard()).visits;
      expect(row?.report).toEqual({ notes: 'Greeted within ten seconds.', rating: 5 });
    });

    it('history carries every state, not just the live ones', async () => {
      await seedSession({ state: 'pending' });
      await seedSession(submitted({ latestVerdict: 'auto_verified', latestResultAt: new Date() }));
      await seedSession({ state: 'abandoned', startedAt: null, endedAt: null });

      const { visits, summary } = await dashboard();
      expect(visits).toHaveLength(3);
      expect(summary.assigned).toBe(3);
      expect(summary.countedOver).toBe(3);
      // The terminal reason still says WHICH timer fired (D-019), on the history screen too.
      expect(visits.find((v) => v.outcome === 'closed')?.terminalReasonCode).toBe('never_started');
    });
  });

  /* ------------------------------------------------------------ notifications */

  describe('notifications', () => {
    it('a new assignment is an unseen notification', async () => {
      await seedSession();
      const list = await notifications();
      expect(list).toHaveLength(1);
      expect(list[0]?.kind).toBe('assignment');
      expect(list[0]?.taskTitle).toContain(TASK_TITLE);
      expect(list[0]?.venueName).toBe('Alfa Sweifieh');
    });

    /**
     * The bug the schema-reviewer pass caught. A session written before this branch has no
     * `assignmentSeenAt` FIELD, not a null one, and `undefined !== null` is true -- so every
     * visit already in the deployed database reported itself as read and the list came back
     * empty. `$unset` reproduces exactly that document shape.
     */
    it('a session predating the seen markers is unseen, not silently seen', async () => {
      const id = await seedSession();
      await Sessions.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(id) },
        { $unset: { assignmentSeenAt: '', outcomeSeenAt: '' } },
      );

      const list = await notifications();
      expect(list.map((n) => n.kind)).toEqual(['assignment']);
    });

    it('acknowledging an assignment clears it, and is idempotent', async () => {
      const id = await seedSession();
      const ack = () =>
        request(app.getHttpServer())
          .post(`/me/notifications/${id}/seen`)
          .set(auth(myToken))
          .send({ kind: 'assignment' })
          .expect(200);

      await ack();
      expect(await notifications()).toHaveLength(0);

      const first = await Sessions.findById(id).lean<{ assignmentSeenAt: Date }>();
      await ack();
      const second = await Sessions.findById(id).lean<{ assignmentSeenAt: Date }>();
      // Set once: a screen that re-acks on every render must not keep moving it to "just now".
      expect(second?.assignmentSeenAt).toEqual(first?.assignmentSeenAt);
    });

    it('an in_review visit produces no outcome notification', async () => {
      await seedSession({
        state: 'submitted',
        endedAt: new Date(),
        latestVerdict: 'needs_review',
        latestResultAt: new Date(),
      });
      expect(await notifications()).toHaveLength(0);
    });

    it('acknowledging an outcome that was never released is refused', async () => {
      const id = await seedSession({
        state: 'submitted',
        endedAt: new Date(),
        latestVerdict: 'rejected',
        latestResultAt: new Date(),
      });
      await request(app.getHttpServer())
        .post(`/me/notifications/${id}/seen`)
        .set(auth(myToken))
        .send({ kind: 'outcome' })
        .expect(409);
    });

    /**
     * The second schema-reviewer find. A set-once outcome marker means a reviewer reversing an
     * approval releases a new decision the participant is never told about.
     */
    it('a superseded decision becomes unseen again', async () => {
      const id = await seedSession({
        state: 'submitted',
        endedAt: new Date(),
        latestVerdict: 'auto_verified',
        latestResultAt: new Date(Date.now() - 60_000),
      });

      await request(app.getHttpServer())
        .post(`/me/notifications/${id}/seen`)
        .set(auth(myToken))
        .send({ kind: 'outcome' })
        .expect(200);
      expect(await notifications()).toHaveLength(0);

      // A reviewer now reverses it. The decision is new; the old marker predates it.
      await Reviews.create({
        sessionId: id,
        verificationResultId: '65b0000000000000000000aa',
        clientOrgId: ORG,
        reviewerId: 'u-business',
        decision: 'reject',
        note: 'On a second look the photo is from the wrong branch.',
        feedbackToParticipant: 'This one was at a different branch, so it could not be counted.',
        at: new Date(Date.now() + 60_000),
      } as never);

      const list = await notifications();
      expect(list).toHaveLength(1);
      expect(list[0]?.kind).toBe('outcome');
      expect(list[0]?.outcome).toBe('not_approved');
    });
  });
});
