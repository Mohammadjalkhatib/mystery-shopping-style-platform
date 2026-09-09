import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  SESSION_EVENTS,
  SESSION_STATES,
  VERDICTS,
  type SessionEvent,
  type SessionState,
  type Verdict,
} from '@msp/shared';
import { HydratedDocument } from 'mongoose';

/**
 * The venue geofence as it was when a session started. See `Session.venueSnapshot`.
 *
 * Deliberately a copy, not a reference: the whole point is that it does not move when the
 * venue does.
 */
@Schema({ _id: false })
export class VenueSnapshot {
  @Prop({ required: true })
  lat!: number;

  @Prop({ required: true })
  lng!: number;

  @Prop({ required: true, min: 25, max: 500 })
  radiusM!: number;

  @Prop({ required: true, min: 0, max: 500 })
  nearBufferM!: number;

  @Prop({ required: true })
  indoor!: boolean;

  /** Server clock at which this copy was taken. */
  @Prop({ required: true, type: Date })
  snapshotAt!: Date;
}
export const VenueSnapshotSchema = SchemaFactory.createForClass(VenueSnapshot);

/**
 * Hard ceiling on fixes per session (D-010).
 *
 * At the documented 30 s cadence this is ~33 hours of sampling, far past the 3-hour hard
 * cap, so it cannot bite an honest participant. It exists to stop a 100k-ping flush from
 * making the evaluator throw and the outbox retry forever.
 *
 * NOTE FOR feat/ping-ingest: `min`/`max` here do NOT run on `$inc` unless `runValidators` is
 * set, so this is a backstop against a migration, not the enforcement. The enforcement must
 * be one atomic conditional update:
 *
 *   findOneAndUpdate(
 *     { _id, state: 'active', pingCount: { $lt: MAX_PINGS_PER_SESSION } },
 *     { $inc: { pingCount: insertedCount }, $set: { lastSeenAt: now } },
 *   )
 *
 * A read-then-check in the service is a TOCTOU across two concurrent batch flushes, which is
 * precisely the offline-queue scenario rule 4 exists for. That one update also performs the
 * `state === 'active'` check and moves `lastSeenAt`, so it costs nothing extra.
 *
 * And `$inc` must use the number of documents ACTUALLY inserted (upsertedCount), never the
 * batch length: `$setOnInsert` makes a re-flush a no-op on pings, but incrementing by batch
 * length would still burn the budget, turning rule 4's safety guarantee into a slow leak.
 */
export const MAX_PINGS_PER_SESSION = 4000;

/** A piece of work an admin defines against a venue. */
@Schema({ collection: 'tasks', timestamps: true })
export class Task {
  @Prop({ required: true, index: true, type: String, ref: 'ClientOrg' })
  clientOrgId!: string;

  @Prop({ required: true, index: true, type: String, ref: 'Venue' })
  venueId!: string;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true, trim: true })
  brief!: string;

  /** Minimum time on site for the visit to be worth scoring. Feeds the engine config. */
  @Prop({ required: true, min: 60, max: 7200, default: 300 })
  expectedDwellSeconds!: number;

  @Prop({ required: true, default: true })
  active!: boolean;
}
export type TaskDocument = HydratedDocument<Task>;
export const TaskSchema = SchemaFactory.createForClass(Task);

// Unique because this is the seed's upsert key. Without it two seeds racing -- two api
// replicas, or a retried compose -- both miss and both insert. D-012.
TaskSchema.index({ clientOrgId: 1, venueId: 1, title: 1 }, { unique: true });

/** A task handed to one participant. One assignment can produce at most one session. */
@Schema({ collection: 'assignments', timestamps: true })
export class Assignment {
  // Prefix of the unique { taskId, participantId }.
  @Prop({ required: true, type: String, ref: 'Task' })
  taskId!: string;

  @Prop({ required: true, index: true })
  participantId!: string;

  @Prop({ required: true, index: true, type: String, ref: 'ClientOrg' })
  clientOrgId!: string;

  /** Server clock. Never client-supplied (rule 2). */
  @Prop({ type: Date, default: null })
  consentedAt!: Date | null;

  /** Which consent text they agreed to. Versioned so a later change is auditable. */
  @Prop({ type: String, default: null })
  consentVersion!: string | null;
}
export type AssignmentDocument = HydratedDocument<Assignment>;
export const AssignmentSchema = SchemaFactory.createForClass(Assignment);

// One participant is not given the same task twice.
AssignmentSchema.index({ taskId: 1, participantId: 1 }, { unique: true });

/**
 * A visit session. The state field is owned entirely by the state machine.
 *
 * Every timestamp here is a SERVER clock reading. There is deliberately no client-supplied
 * `startedAt` or `endedAt` anywhere in this schema, and the DTOs must reject those fields
 * rather than ignore them (CLAUDE.md rule 2).
 */
@Schema({ collection: 'sessions', timestamps: true })
export class Session {
  @Prop({ required: true, unique: true, type: String, ref: 'Assignment' })
  assignmentId!: string;

  /**
   * KEPT although `{ participantId: 1, createdAtServer: -1 }` below is a superset of it.
   *
   * Not an oversight. Mongoose creates indexes and never drops them, so deleting `index: true`
   * would stop new databases building it and leave `participantId_1` in place on the deployed
   * one for ever -- the reconciliation would have to be explicit, in the style of
   * `db/indexes.ts`. That is a deliberate migration, not a side effect of a dashboard branch.
   * Both keys are immutable after insert, so the cost of keeping it is one insert-time write.
   * Recorded as open in docs/MEMORY.md rather than left silent.
   */
  @Prop({ required: true, index: true })
  participantId!: string;

  // Prefix of { clientOrgId, state, endedAt } used by the console.
  @Prop({ required: true, type: String, ref: 'ClientOrg' })
  clientOrgId!: string;

  @Prop({ required: true, type: String, ref: 'Venue' })
  venueId!: string;

  // Prefix of { state, lastSeenAt } used by the reaper.
  @Prop({ required: true, enum: SESSION_STATES, default: 'pending' })
  state!: SessionState;

  /** Server clock, set when the session entered `pending`. */
  @Prop({ required: true, type: Date })
  createdAtServer!: Date;

  /** Server clock, set on `start`. Null while pending. */
  @Prop({ type: Date, default: null })
  startedAt!: Date | null;

  /** Server clock, set on `end`. */
  @Prop({ type: Date, default: null })
  endedAt!: Date | null;

  /**
   * Server clock of the last thing heard from this session -- a ping, or the end call.
   * Drives the abandon timer. Never a device timestamp (rule 3).
   */
  @Prop({ required: true, type: Date })
  lastSeenAt!: Date;

  /**
   * Running count, maintained by ping ingest.
   *
   * D-010 requires a cap on fixes per session: unbounded, a flush of 100k pings would make
   * the evaluator throw and the outbox retry forever. Keeping the counter here means ingest
   * can reject cheaply without a count() on the hot collection.
   */
  @Prop({ required: true, default: 0, min: 0, max: MAX_PINGS_PER_SESSION })
  pingCount!: number;

  /**
   * The venue's geofence configuration AS IT WAS when this session started.
   *
   * Closes a D-012 finding. `distanceM` and `presence` are already pinned per ping at ingest
   * time, but the evaluator previously read the venue LIVE, so an admin editing `radiusM`
   * between the visit and its evaluation -- or before a re-run under a newer engineVersion --
   * mixed two vintages of venue config into one verdict. That can make `proximity` contradict
   * `presence` again in exactly the way D-010 item 5 fixed.
   *
   * One copy per visit on a cold document, not per ping. Null only for sessions created
   * before this field existed, and for `pending` sessions that never started.
   */
  @Prop({ type: VenueSnapshotSchema, default: null })
  venueSnapshot!: VenueSnapshot | null;

  /**
   * Denormalised pointer to the newest verification result, written by the evaluator.
   *
   * Does NOT violate rule 8: the result stays append-only, the session merely carries a
   * pointer to the latest one. Without this the console list needs a second query per row
   * (D-012), and it is also exactly what the SSE payload wants to send.
   */
  @Prop({ type: String, default: null })
  latestResultId!: string | null;

  @Prop({ type: String, enum: [...VERDICTS, null], default: null })
  latestVerdict!: Verdict | null;

  @Prop({ type: Number, default: null, min: 0, max: 100 })
  latestScore!: number | null;

  /**
   * When the newest verification result was written. Server clock.
   *
   * Exists so an `auto_verified` release has a TIMESTAMP. Without one, "has the participant
   * read the current decision" is unanswerable for every visit no human reviewed -- the only
   * available marker would be "have they ever looked", and a re-run under a newer
   * `engineVersion` (which rule 9 explicitly designs for) would then flip the outcome with the
   * participant never told. Written by the same `updateOne` that already sets the three fields
   * above, so it costs no extra write. D-035.
   */
  @Prop({ type: Date, default: null })
  latestResultAt!: Date | null;

  /**
   * When the participant first OPENED this assignment. Server clock, set once.
   *
   * This is the entire persisted state behind the "new assignment" notification. The
   * notification itself is derived from the session (D-035), so what has to be stored is the
   * one fact that cannot be derived: whether the person has looked. Set once and never
   * cleared, because a notification that can come back is a nag, not an inbox.
   */
  @Prop({ type: Date, default: null })
  assignmentSeenAt!: Date | null;

  /**
   * When the participant LAST read a released decision on this visit. Server clock.
   *
   * Separate from `assignmentSeenAt` because they mark different events at different ends of
   * the visit, and a participant who opened the task on Monday has not thereby read the
   * decision that arrived on Thursday.
   *
   * Unlike `assignmentSeenAt` this one MOVES, and that difference is the whole point. An
   * assignment happens once; a decision can be superseded -- a reviewer files a second
   * `reviewAction` reversing the first, or a re-run under a newer engine changes the verdict.
   * A set-once marker answers "have they looked at all" when the question is "have they looked
   * since the CURRENT decision", so a reversed approval would be released and never announced.
   * Compared against the release time rather than read as a boolean. D-035.
   */
  @Prop({ type: Date, default: null })
  outcomeSeenAt!: Date | null;
}
export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);

// The reaper's abandon scan: non-terminal sessions that have gone quiet.
SessionSchema.index({ state: 1, lastSeenAt: 1 });
/**
 * The reaper's EXPIRE scan. A separate index, because `dueEvent()` checks the hard cap
 * against `startedAt` while the abandon scan filters on `lastSeenAt` -- and a session that is
 * still pinging happily has a FRESH `lastSeenAt`, so it never appears in that scan even
 * though its 3-hour cap has already fired. Without this index the hard cap is either
 * decorative or a collection scan. D-012.
 */
SessionSchema.index({ state: 1, startedAt: 1 });
// The business console lists completed visits for one org, newest first (rule 6).
SessionSchema.index({ clientOrgId: 1, state: 1, endedAt: -1 });
/**
 * The participant's own history, newest first.
 *
 * `{ participantId: 1 }` alone served the old `/sessions/mine`, which read a handful of live
 * sessions. The history screen sorts the participant's WHOLE record by recency, and a single
 * field index makes that an in-memory sort over every session they have ever run. The sort
 * key is `createdAtServer` -- when the work was handed to them -- rather than `endedAt`,
 * because a pending assignment has no `endedAt` and must still appear in the list.
 */
SessionSchema.index({ participantId: 1, createdAtServer: -1 });

/**
 * Append-only audit of every state transition. This is exactly what `TransitionResult`
 * carries on success, which is why the state machine was built before this schema.
 *
 * Never updated, never deleted. If a transition was wrong, a later event records the
 * correction; the original stays.
 */
@Schema({ collection: 'sessionEvents', timestamps: { createdAt: true, updatedAt: false } })
export class SessionEventDoc {
  // Prefix of { sessionId, at }.
  @Prop({ required: true, type: String, ref: 'Session' })
  sessionId!: string;

  @Prop({ required: true, enum: SESSION_STATES })
  from!: SessionState;

  @Prop({ required: true, enum: SESSION_EVENTS })
  event!: SessionEvent;

  @Prop({ required: true, enum: SESSION_STATES })
  to!: SessionState;

  /** Server clock. */
  @Prop({ required: true, type: Date })
  at!: Date;

  /** Who or what caused it: a participant id, or `system` for the reaper. */
  @Prop({ required: true })
  actor!: string;
}
export type SessionEventDocument = HydratedDocument<SessionEventDoc>;
export const SessionEventSchema = SchemaFactory.createForClass(SessionEventDoc);

SessionEventSchema.index({ sessionId: 1, at: 1 });

/**
 * Append-only, ENFORCED (rule 8). The comment above said so; nothing stopped an updateOne.
 * A transition audit that can be rewritten is not an audit. D-012.
 */
SessionEventSchema.pre(
  /^(updateOne|updateMany|findOneAndUpdate|findOneAndReplace|replaceOne|deleteOne|deleteMany|findOneAndDelete)$/,
  function () {
    throw new Error(
      'sessionEvents is append-only (CLAUDE.md rule 8). Record a new event instead of ' +
        'rewriting or deleting an existing one.',
    );
  },
);
