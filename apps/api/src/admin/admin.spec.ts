import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection, type Model } from 'mongoose';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module.js';
import {
  ClientOrg,
  ClientOrgSchema,
  Venue,
  VenueSchema,
} from '../db/schemas/org-venue.schema.js';
import {
  Assignment,
  AssignmentSchema,
  Session,
  SessionSchema,
  Task,
  TaskSchema,
} from '../db/schemas/task-session.schema.js';
import { ParticipantService } from '../participant/participant.service.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { seedDemoUsers } from '../../test/seed-users.js';
import { testDbModule } from '../../test/nest-db.js';
import { User, UserSchema } from '../db/schemas/user.schema.js';

/** The org the demo `business` user belongs to, per demo-users.ts. */
const ORG = 'org-alfa-retail';
const OTHER_ORG = 'org-someone-else';

describe('admin surface', () => {
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let app: INestApplication;

  let Orgs: Model<ClientOrg>;
  let Venues: Model<Venue>;
  let Tasks: Model<Task>;
  let Assignments: Model<Assignment>;
  let Sessions: Model<Session>;

  /**
   * Recorded, not stubbed away.
   *
   * Creating an assignment now announces it to the participant, and that announcement is
   * fire-and-forget OUTSIDE the transaction -- so the one thing worth asserting here is that
   * it fires for a successful assignment and does not fire for a refused one. What it is
   * allowed to say is the release rule's business, tested in participant/outcome.spec.ts.
   */
  const announced: string[] = [];

  let adminToken: string;
  let bizToken: string;
  let participantToken: string;

  const login = async (username: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'demo1234' })
      .expect(200);
    return (res.body as { token: string }).token;
  };
  const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

  const venueBody = (over: Record<string, unknown> = {}) => ({
    name: `Venue ${Math.random()}`,
    address: 'Mecca Street, Amman',
    lat: 31.957,
    lng: 35.9137,
    radiusM: 120,
    indoor: true,
    ...over,
  });

  /** A venue belonging to `org`, created directly so tenancy tests have something to aim at. */
  const seedVenue = async (org: string): Promise<string> => {
    const v = await Venues.create({
      clientOrgId: org,
      name: `Seeded ${Math.random()}`,
      address: 'somewhere',
      location: { type: 'Point', coordinates: [35.9137, 31.957] },
      radiusM: 100,
      nearBufferM: 50,
      indoor: false,
    } as never);
    return String(v._id);
  };

  const seedTask = async (org: string, venueId: string): Promise<string> => {
    const t = await Tasks.create({
      clientOrgId: org,
      venueId,
      title: `Task ${Math.random()}`,
      brief: 'Visit as an ordinary customer and note the greeting time.',
      expectedDwellSeconds: 300,
      active: true,
    } as never);
    return String(t._id);
  };

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    conn = await mongoose.createConnection(mongod.getUri('admin')).asPromise();
    // Real accounts now back /auth/login (D-037), so the roster has to exist.
    await seedDemoUsers(conn);
    const Users = conn.model(User.name, UserSchema);

    Orgs = conn.model(ClientOrg.name, ClientOrgSchema) as Model<ClientOrg>;
    Venues = conn.model(Venue.name, VenueSchema) as Model<Venue>;
    Tasks = conn.model(Task.name, TaskSchema) as Model<Task>;
    Assignments = conn.model(Assignment.name, AssignmentSchema) as Model<Assignment>;
    Sessions = conn.model(Session.name, SessionSchema) as Model<Session>;

    // The unique indexes are what several of these tests assert against, and Mongoose only
    // builds them on demand against a fresh database.
    await Promise.all([
      Venues.createIndexes(),
      Tasks.createIndexes(),
      Assignments.createIndexes(),
      Sessions.createIndexes(),
    ]);

    await Orgs.create([
      { _id: ORG, name: 'Alfa Retail', slug: 'alfa-retail' },
      { _id: OTHER_ORG, name: 'Someone Else', slug: 'someone-else' },
    ] as never);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        testDbModule(conn),
        AuthModule,
      ],
      controllers: [AdminController],
      providers: [
        AdminService,
        {
          provide: ParticipantService,
          useValue: {
            announceAssignment: async (sessionId: string): Promise<void> => {
              announced.push(sessionId);
            },
            announceOutcome: async (): Promise<void> => undefined,
          },
        },
        { provide: getConnectionToken(), useValue: conn },
        { provide: getModelToken(ClientOrg.name), useValue: Orgs },
        { provide: getModelToken(Venue.name), useValue: Venues },
        { provide: getModelToken(Task.name), useValue: Tasks },
        { provide: getModelToken(Assignment.name), useValue: Assignments },
        { provide: getModelToken(Session.name), useValue: Sessions },
        { provide: getModelToken(User.name), useValue: Users },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    adminToken = await login('admin');
    bizToken = await login('business');
    participantToken = await login('user1');
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  /* ------------------------------------------------ authorization boundaries */

  describe('authorization boundaries', () => {
    const writes: [string, string, object][] = [
      ['POST', '/venues', venueBody()],
      ['POST', '/tasks', { venueId: '65b0000000000000000000aa', title: 'x', brief: 'y'.repeat(20) }],
      ['POST', '/assignments', { taskId: '65b0000000000000000000aa', participantId: 'u-participant-1' }],
    ];

    it.each(writes)('%s %s is 401 without a token', async (_m, path, body) => {
      await request(app.getHttpServer()).post(path).send(body).expect(401);
    });

    it.each(writes)('%s %s is 403 for a participant', async (_m, path, body) => {
      await request(app.getHttpServer())
        .post(path)
        .set(auth(participantToken))
        .send(body)
        .expect(403);
    });

    it.each([['/venues'], ['/tasks'], ['/participants']])(
      'GET %s is 403 for a participant',
      async (path) => {
        await request(app.getHttpServer()).get(path).set(auth(participantToken)).expect(403);
      },
    );

    it('a business user cannot create a venue in another organisation', async () => {
      await request(app.getHttpServer())
        .post('/venues')
        .set(auth(bizToken))
        .send(venueBody({ clientOrgId: OTHER_ORG }))
        .expect(403);
    });

    it('a business user cannot create a task against another org venue', async () => {
      const foreign = await seedVenue(OTHER_ORG);
      await request(app.getHttpServer())
        .post('/tasks')
        .set(auth(bizToken))
        .send({ venueId: foreign, title: 'Peek', brief: 'Look at their store please.' })
        .expect(403);
    });

    it('a business user cannot assign another org task', async () => {
      const foreignVenue = await seedVenue(OTHER_ORG);
      const foreignTask = await seedTask(OTHER_ORG, foreignVenue);
      await request(app.getHttpServer())
        .post('/assignments')
        .set(auth(bizToken))
        .send({ taskId: foreignTask, participantId: 'u-participant-1' })
        .expect(403);
    });

    it('a business user only lists their own org venues and tasks', async () => {
      await seedTask(OTHER_ORG, await seedVenue(OTHER_ORG));
      const mineVenue = await seedVenue(ORG);
      await seedTask(ORG, mineVenue);

      const venues = await request(app.getHttpServer())
        .get('/venues')
        .set(auth(bizToken))
        .expect(200);
      const tasks = await request(app.getHttpServer())
        .get('/tasks')
        .set(auth(bizToken))
        .expect(200);

      expect((venues.body as { id: string }[]).length).toBeGreaterThan(0);
      const foreignVenues = await Venues.countDocuments({ clientOrgId: OTHER_ORG });
      expect(foreignVenues).toBeGreaterThan(0);
      // Everything returned belongs to ORG, and the foreign rows exist but are not in it.
      const venueIds = (venues.body as { id: string }[]).map((v) => v.id);
      const owned = await Venues.countDocuments({ _id: { $in: venueIds }, clientOrgId: ORG });
      expect(owned).toBe(venueIds.length);
      const taskIds = (tasks.body as { id: string }[]).map((t) => t.id);
      const ownedTasks = await Tasks.countDocuments({ _id: { $in: taskIds }, clientOrgId: ORG });
      expect(ownedTasks).toBe(taskIds.length);
    });

    it('an admin must name an organisation, and it must exist', async () => {
      await request(app.getHttpServer())
        .post('/venues')
        .set(auth(adminToken))
        .send(venueBody())
        .expect(400);

      await request(app.getHttpServer())
        .post('/venues')
        .set(auth(adminToken))
        .send(venueBody({ clientOrgId: 'org-does-not-exist' }))
        .expect(404);
    });
  });

  /* ------------------------------------------------------------- validation */

  describe('input validation', () => {
    it('rejects a geofence radius outside the schema bounds', async () => {
      // D-010: an unbounded radius auto-verifies a city and reads as a typo.
      await request(app.getHttpServer())
        .post('/venues')
        .set(auth(bizToken))
        .send(venueBody({ radiusM: 5000 }))
        .expect(400);
      await request(app.getHttpServer())
        .post('/venues')
        .set(auth(bizToken))
        .send(venueBody({ radiusM: 5 }))
        .expect(400);
    });

    it('rejects an unknown field rather than silently dropping it (rule 2)', async () => {
      await request(app.getHttpServer())
        .post('/venues')
        .set(auth(bizToken))
        .send(venueBody({ createdAtServer: '2020-01-01T00:00:00.000Z' }))
        .expect(400);
    });

    it('rejects a coordinate too coarse for the geofence it defines (D-020)', async () => {
      // The exact input that produced a venue 4.8 km from where the participant stood.
      const res = await request(app.getHttpServer())
        .post('/venues')
        .set(auth(bizToken))
        .send(venueBody({ lat: 31.98, lng: 35.83, radiusM: 25 }))
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(/decimal places/);
    });

    it('accepts the same coordinate when the fence is wide enough to tolerate it', async () => {
      // The rule scales with the radius rather than demanding a fixed digit count. Three
      // decimals is ~56 m: useless at 25 m, fine at 500 m.
      await request(app.getHttpServer())
        .post('/venues')
        .set(auth(bizToken))
        .send(venueBody({ name: `Coarse ${Math.random()}`, lat: 31.939, lng: 35.848, radiusM: 500 }))
        .expect(201);
    });

    it('rejects an out-of-range coordinate', async () => {
      await request(app.getHttpServer())
        .post('/venues')
        .set(auth(bizToken))
        .send(venueBody({ lat: 931.957 }))
        .expect(400);
    });

    it('refuses to assign to someone who is not a participant', async () => {
      const taskId = await seedTask(ORG, await seedVenue(ORG));
      await request(app.getHttpServer())
        .post('/assignments')
        .set(auth(bizToken))
        .send({ taskId, participantId: 'u-admin' })
        .expect(400);
    });
  });

  /* ---------------------------------------------------------------- writing */

  describe('authoring', () => {
    it('stores a venue as [lng, lat] and reads it back the way it went in', async () => {
      // The axis order is the bug the GeoPoint schema exists to prevent. A round trip through
      // the API is the only place both halves of that conversion are exercised together.
      const res = await request(app.getHttpServer())
        .post('/venues')
        .set(auth(bizToken))
        .send(venueBody({ name: 'Axis Check', lat: 31.957, lng: 35.9137 }))
        .expect(201);

      const body = res.body as { id: string; lat: number; lng: number };
      expect(body.lat).toBeCloseTo(31.957, 6);
      expect(body.lng).toBeCloseTo(35.9137, 6);

      const stored = await Venues.findById(body.id).lean<{
        location: { coordinates: [number, number] };
      } | null>();
      expect(stored!.location.coordinates).toEqual([35.9137, 31.957]);
    });

    it('a business user creating a venue gets their own org, not one they named', async () => {
      const res = await request(app.getHttpServer())
        .post('/venues')
        .set(auth(bizToken))
        .send(venueBody({ name: 'Own Org Check' }))
        .expect(201);
      const stored = await Venues.findById((res.body as { id: string }).id).lean<{
        clientOrgId: string;
      } | null>();
      expect(stored!.clientOrgId).toBe(ORG);
    });

    it('creating an assignment opens a pending session for it (D-018)', async () => {
      const taskId = await seedTask(ORG, await seedVenue(ORG));
      const res = await request(app.getHttpServer())
        .post('/assignments')
        .set(auth(bizToken))
        .send({ taskId, participantId: 'u-participant-3' })
        .expect(201);

      const { assignmentId, sessionId } = res.body as {
        assignmentId: string;
        sessionId: string;
      };
      const session = await Sessions.findById(sessionId).lean<{
        assignmentId: string;
        state: string;
        participantId: string;
        startedAt: Date | null;
        pingCount: number;
        createdAtServer: Date;
      } | null>();

      expect(session).not.toBeNull();
      expect(session!.assignmentId).toBe(assignmentId);
      expect(session!.state).toBe('pending');
      expect(session!.participantId).toBe('u-participant-3');
      // Server-owned, and nothing in the request could have proposed them (rule 2).
      expect(session!.startedAt).toBeNull();
      expect(session!.pingCount).toBe(0);
      expect(session!.createdAtServer).toBeInstanceOf(Date);
    });

    /**
     * The participant is TOLD. Assigning work that never reaches the person who has to do it
     * is the gap this closes, and it is easy to break silently: the call is deliberately
     * fire-and-forget outside the transaction, so nothing in the response would change if it
     * stopped happening.
     */
    it('creating an assignment announces it to the participant', async () => {
      announced.length = 0;
      const taskId = await seedTask(ORG, await seedVenue(ORG));
      const res = await request(app.getHttpServer())
        .post('/assignments')
        .set(auth(bizToken))
        .send({ taskId, participantId: 'u-participant-7' })
        .expect(201);

      const { sessionId } = res.body as { sessionId: string };
      expect(announced).toEqual([sessionId]);
    });

    it('a REFUSED assignment announces nothing', async () => {
      const taskId = await seedTask(ORG, await seedVenue(ORG));
      const body = { taskId, participantId: 'u-participant-8' };
      await request(app.getHttpServer()).post('/assignments').set(auth(bizToken)).send(body).expect(201);

      announced.length = 0;
      // The duplicate is rejected by the unique index inside the transaction, so no session
      // exists to announce -- and announcing one anyway would push a notification to a visit
      // the participant can never open.
      await request(app.getHttpServer()).post('/assignments').set(auth(bizToken)).send(body).expect(409);
      expect(announced).toEqual([]);
    });

    it('assigning the same task to the same participant twice is a 409, not a second session', async () => {
      const taskId = await seedTask(ORG, await seedVenue(ORG));
      const body = { taskId, participantId: 'u-participant-4' };

      await request(app.getHttpServer())
        .post('/assignments')
        .set(auth(bizToken))
        .send(body)
        .expect(201);
      await request(app.getHttpServer())
        .post('/assignments')
        .set(auth(bizToken))
        .send(body)
        .expect(409);

      expect(await Assignments.countDocuments({ taskId, participantId: 'u-participant-4' })).toBe(1);
      expect(await Sessions.countDocuments({ participantId: 'u-participant-4', venueId: { $exists: true } })).toBeGreaterThan(0);
    });

    it('corrects a venue, which is the whole point of the edit path (D-021)', async () => {
      // The real case, as close as the create guard now allows: a coarse-but-legal venue at a
      // wide radius, then corrected to a precise coordinate and a tight fence. The original
      // 2-decimal coordinate can no longer be created at all, which is D-020 working.
      const created = await request(app.getHttpServer())
        .post('/venues')
        .set(auth(bizToken))
        .send(venueBody({ name: `Fixable ${Math.random()}`, lat: 31.939, lng: 35.848, radiusM: 500 }))
        .expect(201);
      const id = (created.body as { id: string }).id;

      const patched = await request(app.getHttpServer())
        .patch(`/venues/${id}`)
        .set(auth(bizToken))
        .send({ lat: 31.9399307, lng: 35.8486227, radiusM: 25 })
        .expect(200);

      const body = patched.body as { lat: number; lng: number; radiusM: number };
      expect(body.lat).toBeCloseTo(31.9399307, 6);
      expect(body.radiusM).toBe(25);
      const stored = await Venues.findById(id).lean<{
        location: { coordinates: [number, number] };
      } | null>();
      expect(stored!.location.coordinates).toEqual([35.8486227, 31.9399307]);
    });

    it('re-checks precision against the RESULTING pair, not just what was sent', async () => {
      // 3 decimals is fine at 500 m and useless at 25 m, so tightening the radius alone has
      // to be able to fail even though the coordinate did not change.
      const created = await request(app.getHttpServer())
        .post('/venues')
        .set(auth(bizToken))
        .send(venueBody({ name: `Tighten ${Math.random()}`, lat: 31.939, lng: 35.848, radiusM: 500 }))
        .expect(201);
      const id = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/venues/${id}`)
        .set(auth(bizToken))
        .send({ radiusM: 25 })
        .expect(400);
    });

    it('refuses half a coordinate', async () => {
      const id = await seedVenue(ORG);
      await request(app.getHttpServer())
        .patch(`/venues/${id}`)
        .set(auth(bizToken))
        .send({ lat: 31.9399307 })
        .expect(400);
    });

    it('will not edit another organisation venue, and a participant cannot edit at all', async () => {
      const foreign = await seedVenue(OTHER_ORG);
      await request(app.getHttpServer())
        .patch(`/venues/${foreign}`)
        .set(auth(bizToken))
        .send({ name: 'Mine now' })
        .expect(403);

      const mine = await seedVenue(ORG);
      await request(app.getHttpServer())
        .patch(`/venues/${mine}`)
        .set(auth(participantToken))
        .send({ name: 'Mine now' })
        .expect(403);
      await request(app.getHttpServer()).patch(`/venues/${mine}`).send({ name: 'x' }).expect(401);
    });

    it('cannot move a venue between organisations', async () => {
      const mine = await seedVenue(ORG);
      // clientOrgId is not on the DTO at all, so forbidNonWhitelisted rejects it outright
      // rather than ignoring it (rule 2).
      await request(app.getHttpServer())
        .patch(`/venues/${mine}`)
        .set(auth(bizToken))
        .send({ clientOrgId: OTHER_ORG })
        .expect(400);
      const stored = await Venues.findById(mine).lean<{ clientOrgId: string } | null>();
      expect(stored!.clientOrgId).toBe(ORG);
    });

    it('a task inherits its org from the venue, and counts its assignments', async () => {
      const venueId = await seedVenue(ORG);
      const created = await request(app.getHttpServer())
        .post('/tasks')
        .set(auth(bizToken))
        .send({
          venueId,
          title: 'Counted task',
          brief: 'Visit as an ordinary customer and note the queue length.',
        })
        .expect(201);

      const taskId = (created.body as { id: string }).id;
      const stored = await Tasks.findById(taskId).lean<{ clientOrgId: string } | null>();
      expect(stored!.clientOrgId).toBe(ORG);

      await request(app.getHttpServer())
        .post('/assignments')
        .set(auth(bizToken))
        .send({ taskId, participantId: 'u-participant-5' })
        .expect(201);

      const list = await request(app.getHttpServer()).get('/tasks').set(auth(bizToken)).expect(200);
      const row = (list.body as { id: string; assignmentCount: number }[]).find(
        (t) => t.id === taskId,
      );
      expect(row?.assignmentCount).toBe(1);
    });
  });

  /**
   * The tenancy hole that D-037 opens, and closes in the same branch.
   *
   * `createAssignment` checked that the assignee was a participant and never that they were in
   * the task's organisation. That was unreachable while every account shared one org, so no
   * test existed -- the boundary did not. The moment a business creates its own participants,
   * the same code lets business A hand a task to business B's participant, who then reads the
   * venue name, its address and the task brief out of their own dashboard.
   */
  describe('assignment stays inside one organisation (D-037)', () => {
    let foreignParticipant: string;

    beforeAll(async () => {
      const Users = conn.model('User');
      await Users.create({
        _id: 'u-outsider',
        username: 'outsider',
        displayName: 'Outsider',
        passwordHash: 'scrypt$16384$8$1$AAAA$BBBB',
        role: 'participant',
        clientOrgId: OTHER_ORG,
        active: true,
      });
      await Users.create({
        _id: 'u-benched',
        username: 'benched',
        displayName: 'Benched',
        passwordHash: 'scrypt$16384$8$1$AAAA$BBBB',
        role: 'participant',
        clientOrgId: ORG,
        active: false,
      });
      foreignParticipant = 'u-outsider';
    });

    const taskInOwnOrg = async (): Promise<string> => {
      const venueId = await seedVenue(ORG);
      return seedTask(ORG, venueId);
    };

    it("refuses a participant from another organisation", async () => {
      const taskId = await taskInOwnOrg();
      await request(app.getHttpServer())
        .post('/assignments')
        .set(auth(bizToken))
        .send({ taskId, participantId: foreignParticipant })
        .expect(400);

      expect(await Assignments.countDocuments({ participantId: foreignParticipant })).toBe(0);
    });

    /**
     * Same message as "no such participant". Whether an id exists in somebody else's
     * organisation is not a fact to hand to a caller outside it.
     */
    it('does not reveal that the foreign participant exists', async () => {
      const taskId = await taskInOwnOrg();
      const foreign = await request(app.getHttpServer())
        .post('/assignments')
        .set(auth(bizToken))
        .send({ taskId, participantId: foreignParticipant })
        .expect(400);
      const missing = await request(app.getHttpServer())
        .post('/assignments')
        .set(auth(bizToken))
        .send({ taskId, participantId: 'u-no-such-person' })
        .expect(400);

      expect(JSON.stringify(foreign.body)).toBe(
        JSON.stringify(missing.body).replace('u-no-such-person', foreignParticipant),
      );
    });

    /** A deactivated account cannot start a visit, so the assignment would sit stuck. */
    it('refuses a deactivated participant', async () => {
      const taskId = await taskInOwnOrg();
      await request(app.getHttpServer())
        .post('/assignments')
        .set(auth(bizToken))
        .send({ taskId, participantId: 'u-benched' })
        .expect(400);
    });

    it('still allows a participant in the same organisation', async () => {
      const taskId = await taskInOwnOrg();
      await request(app.getHttpServer())
        .post('/assignments')
        .set(auth(bizToken))
        .send({ taskId, participantId: 'u-participant-6' })
        .expect(201);
    });
  });

  describe('the participant roster is scoped (D-037)', () => {
    it("gives a business its own organisation's active participants only", async () => {
      const res = await request(app.getHttpServer())
        .get('/participants')
        .set(auth(bizToken))
        .expect(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id);

      expect(ids).toContain('u-participant-1');
      // Another organisation's staff are other people's names.
      expect(ids).not.toContain('u-outsider');
      // A deactivated account would produce an assignment that can never be started.
      expect(ids).not.toContain('u-benched');
    });

    it('refuses a business asking for another organisation', async () => {
      await request(app.getHttpServer())
        .get('/participants')
        .query({ clientOrgId: OTHER_ORG })
        .set(auth(bizToken))
        .expect(403);
    });

    it('makes an admin say which organisation, rather than guessing', async () => {
      await request(app.getHttpServer()).get('/participants').set(auth(adminToken)).expect(400);

      const res = await request(app.getHttpServer())
        .get('/participants')
        .query({ clientOrgId: OTHER_ORG })
        .set(auth(adminToken))
        .expect(200);
      expect((res.body as { id: string }[]).map((r) => r.id)).toEqual(['u-outsider']);
    });
  });
});
