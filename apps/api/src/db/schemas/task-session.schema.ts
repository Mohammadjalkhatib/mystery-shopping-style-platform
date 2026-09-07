import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SESSION_EVENTS, SESSION_STATES, type SessionEvent, type SessionState } from '@msp/shared';
import { HydratedDocument } from 'mongoose';

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
