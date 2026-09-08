import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { type Connection, type Model } from 'mongoose';
import { Venue, VenueSchema } from '../db/schemas/org-venue.schema.js';
import {
  Assignment,
  AssignmentSchema,
  Session,
  SessionEventDoc,
  SessionEventSchema,
  SessionSchema,
} from '../db/schemas/task-session.schema.js';
import { ReaperService } from './reaper.service.js';
import { SessionsService } from './sessions.service.js';

const ORG = 'org-alfa-retail';
const OTHER_ORG = 'org-someone-else';

/** Matches .env.example, and what the service falls back to. */
const ABANDON_S = 900;
const HARD_CAP_S = 10_800;

const secondsAgo = (from: Date, s: number): Date => new Date(from.getTime() - s * 1000);

describe('lazy reaper', () => {
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let reaper: ReaperService;

  let Sessions: Model<Session>;
  let Events: Model<SessionEventDoc>;

  let now: Date;

  /**
   * A session with its clocks placed relative to `now`.
   *
   * Every timing is expressed as "how long ago", because that is how the rules read, and it
   * keeps a test from accidentally depending on the wall clock.
   */
  const makeSession = async (over: {
    state: Session['state'];
    createdSecondsAgo?: number;
    startedSecondsAgo?: number | null;
    lastSeenSecondsAgo?: number;
    org?: string;
    participantId?: string;
  }): Promise<string> => {
    const s = await Sessions.create({
      assignmentId: `a-${Math.random()}`,
      participantId: over.participantId ?? 'u-participant-1',
      clientOrgId: over.org ?? ORG,
      venueId: 'v-1',
      state: over.state,
      pingCount: 0,
      createdAtServer: secondsAgo(now, over.createdSecondsAgo ?? 60),
      startedAt:
        over.startedSecondsAgo === undefined || over.startedSecondsAgo === null
          ? null
          : secondsAgo(now, over.startedSecondsAgo),
      lastSeenAt: secondsAgo(now, over.lastSeenSecondsAgo ?? 0),
    } as never);
    return String(s._id);
  };

  const stateOf = async (id: string): Promise<string> =>
    (await Sessions.findById(id).lean<{ state: string }>())!.state;

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    conn = await mongoose.createConnection(mongod.getUri('reaper')).asPromise();

    Sessions = conn.model(Session.name, SessionSchema) as Model<Session>;
    Events = conn.model(SessionEventDoc.name, SessionEventSchema) as Model<SessionEventDoc>;
    const Venues = conn.model(Venue.name, VenueSchema) as Model<Venue>;
    const Assignments = conn.model(Assignment.name, AssignmentSchema) as Model<Assignment>;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      providers: [
        SessionsService,
        ReaperService,
        { provide: getModelToken(Session.name), useValue: Sessions },
        { provide: getModelToken(SessionEventDoc.name), useValue: Events },
        { provide: getModelToken(Venue.name), useValue: Venues },
        { provide: getModelToken(Assignment.name), useValue: Assignments },
      ],
    }).compile();

    reaper = moduleRef.get(ReaperService);
  });

  beforeEach(async () => {
    now = new Date();
    await Sessions.deleteMany({});
    // sessionEvents is NOT cleared: the schema refuses a delete, because it is append-only
    // (rule 8) and that guard is enforced at the model rather than by convention. Every
    // assertion below filters by its own sessionId, so accumulated events are harmless.
  });

  afterAll(async () => {
    await conn?.close();
    await mongod?.stop();
  });

  /* ------------------------------------------------------------ what fires */

  it('abandons an active session that has gone quiet past the window', async () => {
    const id = await makeSession({
      state: 'active',
      startedSecondsAgo: ABANDON_S + 120,
      lastSeenSecondsAgo: ABANDON_S + 60,
    });
    expect(await reaper.reapForOrg(ORG, now)).toBe(1);
    expect(await stateOf(id)).toBe('abandoned');
  });

  it('leaves an active session that is still pinging', async () => {
    const id = await makeSession({
      state: 'active',
      startedSecondsAgo: 600,
      lastSeenSecondsAgo: 30,
    });
    expect(await reaper.reapForOrg(ORG, now)).toBe(0);
    expect(await stateOf(id)).toBe('active');
  });

  it('expires an active session past the hard cap even though it is still pinging', async () => {
    // The case the { state, startedAt } index exists for: a fresh lastSeenAt keeps this
    // session out of the abandon scan entirely, so without the second branch the hard cap
    // would be decorative.
    const id = await makeSession({
      state: 'active',
      startedSecondsAgo: HARD_CAP_S + 60,
      lastSeenSecondsAgo: 5,
    });
    expect(await reaper.reapForOrg(ORG, now)).toBe(1);
    expect(await stateOf(id)).toBe('expired');
  });

  it('prefers expiry over abandonment when both timers have fired', async () => {
    // "You were tracked for the maximum time" is a truer thing to tell a participant than
    // "you went quiet", and the state machine documents that precedence.
    const id = await makeSession({
      state: 'active',
      startedSecondsAgo: HARD_CAP_S + 3600,
      lastSeenSecondsAgo: ABANDON_S + 3600,
    });
    await reaper.reapForOrg(ORG, now);
    expect(await stateOf(id)).toBe('expired');
  });

  it('abandons a pending session off its creation clock, not lastSeenAt', async () => {
    const id = await makeSession({
      state: 'pending',
      createdSecondsAgo: ABANDON_S + 60,
      lastSeenSecondsAgo: ABANDON_S + 60,
    });
    expect(await reaper.reapForOrg(ORG, now)).toBe(1);
    expect(await stateOf(id)).toBe('abandoned');
  });

  it('abandons an ended session whose report never arrived', async () => {
    const id = await makeSession({
      state: 'ended',
      startedSecondsAgo: 3600,
      lastSeenSecondsAgo: ABANDON_S + 60,
    });
    await reaper.reapForOrg(ORG, now);
    expect(await stateOf(id)).toBe('abandoned');
  });

  it('never expires an ended session, only abandons it', async () => {
    // The hard cap bounds how long we TRACK someone. Once they have ended the visit we are
    // not tracking, so `ended -> expired` is deliberately not a legal transition.
    const id = await makeSession({
      state: 'ended',
      startedSecondsAgo: HARD_CAP_S + 3600,
      lastSeenSecondsAgo: ABANDON_S + 60,
    });
    await reaper.reapForOrg(ORG, now);
    expect(await stateOf(id)).toBe('abandoned');
  });

  it('does not touch a terminal session', async () => {
    const id = await makeSession({
      state: 'submitted',
      startedSecondsAgo: HARD_CAP_S * 2,
      lastSeenSecondsAgo: HARD_CAP_S * 2,
    });
    expect(await reaper.reapForOrg(ORG, now)).toBe(0);
    expect(await stateOf(id)).toBe('submitted');
  });

  /* ------------------------------------------------------------------ scope */

  it('a business sweep does not reach another organisation', async () => {
    const mine = await makeSession({
      state: 'active',
      startedSecondsAgo: ABANDON_S + 120,
      lastSeenSecondsAgo: ABANDON_S + 60,
      org: ORG,
    });
    const theirs = await makeSession({
      state: 'active',
      startedSecondsAgo: ABANDON_S + 120,
      lastSeenSecondsAgo: ABANDON_S + 60,
      org: OTHER_ORG,
    });

    expect(await reaper.reapForOrg(ORG, now)).toBe(1);
    expect(await stateOf(mine)).toBe('abandoned');
    expect(await stateOf(theirs)).toBe('active');
  });

  it('an admin sweep (null org) reaches every organisation', async () => {
    await makeSession({
      state: 'active',
      startedSecondsAgo: ABANDON_S + 120,
      lastSeenSecondsAgo: ABANDON_S + 60,
      org: ORG,
    });
    await makeSession({
      state: 'active',
      startedSecondsAgo: ABANDON_S + 120,
      lastSeenSecondsAgo: ABANDON_S + 60,
      org: OTHER_ORG,
    });
    expect(await reaper.reapForOrg(null, now)).toBe(2);
  });

  it('a participant sweep only touches their own sessions', async () => {
    const mine = await makeSession({
      state: 'active',
      startedSecondsAgo: ABANDON_S + 120,
      lastSeenSecondsAgo: ABANDON_S + 60,
      participantId: 'u-participant-1',
    });
    const other = await makeSession({
      state: 'active',
      startedSecondsAgo: ABANDON_S + 120,
      lastSeenSecondsAgo: ABANDON_S + 60,
      participantId: 'u-participant-2',
    });

    expect(await reaper.reapForParticipant('u-participant-1', now)).toBe(1);
    expect(await stateOf(mine)).toBe('abandoned');
    expect(await stateOf(other)).toBe('active');
  });

  /* -------------------------------------------------------------- behaviour */

  it('records the transition in sessionEvents, attributed to the reaper', async () => {
    const id = await makeSession({
      state: 'active',
      startedSecondsAgo: ABANDON_S + 120,
      lastSeenSecondsAgo: ABANDON_S + 60,
    });
    await reaper.reapForOrg(ORG, now);

    const events = await Events.find({ sessionId: id }).lean<
      { from: string; event: string; to: string; actor: string }[]
    >();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      from: 'active',
      event: 'abandon',
      to: 'abandoned',
      actor: 'system:reaper',
    });
  });

  it('does not set endedAt: the participant never ended this visit', async () => {
    const id = await makeSession({
      state: 'active',
      startedSecondsAgo: ABANDON_S + 120,
      lastSeenSecondsAgo: ABANDON_S + 60,
    });
    await reaper.reapForOrg(ORG, now);
    const s = await Sessions.findById(id).lean<{ endedAt: Date | null }>();
    expect(s!.endedAt).toBeNull();
  });

  it('is idempotent: a second sweep finds nothing left to do', async () => {
    await makeSession({
      state: 'active',
      startedSecondsAgo: ABANDON_S + 120,
      lastSeenSecondsAgo: ABANDON_S + 60,
    });
    expect(await reaper.reapForOrg(ORG, now)).toBe(1);
    expect(await reaper.reapForOrg(ORG, now)).toBe(0);
  });

  it('reaps a mixed batch and reports how many it closed', async () => {
    await makeSession({
      state: 'active',
      startedSecondsAgo: ABANDON_S + 120,
      lastSeenSecondsAgo: ABANDON_S + 60,
    });
    await makeSession({ state: 'pending', createdSecondsAgo: ABANDON_S + 60 });
    await makeSession({
      state: 'active',
      startedSecondsAgo: HARD_CAP_S + 60,
      lastSeenSecondsAgo: 5,
    });
    await makeSession({ state: 'active', startedSecondsAgo: 300, lastSeenSecondsAgo: 10 });

    expect(await reaper.reapForOrg(ORG, now)).toBe(3);
    expect(await Sessions.countDocuments({ state: 'active' })).toBe(1);
  });
});
