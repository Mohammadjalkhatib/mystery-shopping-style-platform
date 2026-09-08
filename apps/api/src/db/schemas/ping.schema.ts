import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PRESENCES, type Presence } from '@msp/shared';
import { HydratedDocument } from 'mongoose';

/**
 * A raw location fix. The most sensitive collection in the system and the highest-write one,
 * so it carries as little as possible.
 *
 * Read by the verification evaluator and by nothing else. The business console never touches
 * it (CLAUDE.md rule 6) -- it reads sessions and verification results, which carry rollups.
 */
@Schema({
  collection: 'pings',
  /**
   * NO timestamps at all, deliberately.
   *
   * `updatedAt` would be wrong: a ping is written once and never modified (idempotent
   * re-flush is first-write-wins via $setOnInsert, D-010), so an update is a bug.
   *
   * `createdAt` would be worse. It is `receivedAt` to within a millisecond, so it duplicates
   * a field on the highest-volume document in the system, and it puts a THIRD clock into a
   * design whose entire premise is exactly two (rule 3). The next person to write an
   * aggregation reaches for `createdAt` out of habit and nothing looks wrong.
   * `receivedAt` IS the created-at.
   */
  timestamps: false,
})
export class Ping {
  // No standalone index: sessionId is the prefix of both compound indexes below, and Mongo
  // serves prefix queries from those. A redundant index on the hottest collection in the
  // system is a write cost with no read benefit.
  @Prop({ required: true, type: String, ref: 'Session' })
  sessionId!: string;

  /**
   * Client-generated UUID. The idempotency key (CLAUDE.md rule 4).
   *
   * This is the one field the client is *supposed* to control. It carries no meaning beyond
   * identity, so a malicious value costs the attacker nothing and gains them nothing -- the
   * worst they can do is collide with their own earlier ping and lose it.
   */
  @Prop({ required: true })
  clientPingId!: string;

  /**
   * Device clock. UNTRUSTED (rule 3).
   *
   * Kept, not discarded: the delta against receivedAt is a verification signal. Ingest must
   * bound it against the session window so a fix cannot claim to precede the session.
   */
  @Prop({ required: true, type: Date })
  capturedAt!: Date;

  /**
   * Server clock, stamped on arrival. Trusted.
   *
   * D-010, and this is the single most important line in ping ingest: this must be stamped
   * PER FIX inside the loop, never once per batch. A batch-level stamp makes every
   * intra-batch interval zero, which collapses coverage, zeroes dwell, and silently disables
   * the teleport check for the whole batch. `batchFlushedHonestVisit` is the fixture that
   * catches it.
   */
  // No `index: true` here on purpose. It would create a plain `receivedAt_1` index that
  // collides with the named TTL index on the same key, and Mongo rejects the second with
  // "An equivalent index already exists with a different name and options". The TTL index
  // below already covers this field.
  @Prop({ required: true, type: Date })
  receivedAt!: Date;

  @Prop({ required: true, min: -90, max: 90 })
  lat!: number;

  @Prop({ required: true, min: -180, max: 180 })
  lng!: number;

  /**
   * Browser-reported accuracy in metres. Untrusted but load-bearing: it sets geofence
   * tolerance, decides usable vs unknown, and feeds accuracyRealism.
   *
   * `min: 0.1` because a non-positive accuracy is physically impossible and, left unchecked,
   * an accuracy of 0 sails through the presence rule (D-010). Ingest must NOT round this --
   * Android reports quantised repeats and rounding would trip the `distinct === 1` spoof
   * branch on honest traces.
   */
  @Prop({ required: true, min: 0.1 })
  accuracyM!: number;

  /** Server-computed haversine to the venue centre. Rejected if a client sends it. */
  @Prop({ required: true, min: 0 })
  distanceM!: number;

  /** Server-computed. Never an "I am at the venue" assertion from the client. */
  @Prop({ required: true, enum: PRESENCES })
  presence!: Presence;
}
export type PingDocument = HydratedDocument<Ping>;
export const PingSchema = SchemaFactory.createForClass(Ping);

/**
 * Idempotency (rule 4). An offline queue may flush the same batch twice; this makes the
 * second flush a no-op rather than a duplicate.
 *
 * Paired with `$setOnInsert` at the call site so a re-flush cannot REWRITE an existing fix.
 * With `$set` a client could resend a stored clientPingId carrying different coordinates and
 * quietly move a fix after the fact (D-010).
 */
PingSchema.index({ sessionId: 1, clientPingId: 1 }, { unique: true });

/** The evaluator reads one session's trace in time order. This is that query. */
PingSchema.index({ sessionId: 1, receivedAt: 1 });

/**
 * TTL. This is a PRIVACY CONTROL, not a performance tweak (CLAUDE.md rule 10).
 *
 * The index is DELIBERATELY NOT DECLARED HERE. Only the name lives in this file;
 * `syncPingTtlIndex()` in ../indexes.ts creates and owns it.
 *
 * Why, because the obvious thing was wrong: declaring it here with an `expireAfterSeconds`
 * literal gave the retention window two owners. Mongoose's `autoIndex` would issue its own
 * `createIndex` at 30 days when the model compiled, concurrently with the boot-time
 * reconcile using PING_RETENTION_DAYS. Whichever landed second either conflicted (surfaced
 * on the model's `index` event, which nobody listens to, so swallowed) or silently won. The
 * effective retention window depended on a race, while the log line claimed the configured
 * value either way -- the exact failure ../indexes.ts exists to prevent, restated one layer
 * up. Caught by the schema-reviewer pass, see D-012.
 *
 * A hardcoded 30-day literal was also a second source of truth for a privacy control, which
 * should not exist at all.
 *
 * Do not re-add an index declaration here. Do not raise the window without asking.
 */
export const PING_TTL_INDEX_NAME = 'ping_ttl_receivedAt';
