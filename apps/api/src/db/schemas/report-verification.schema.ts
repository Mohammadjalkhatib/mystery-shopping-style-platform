import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { VERDICTS, type Verdict } from '@msp/shared';
import { HydratedDocument } from 'mongoose';

/** The participant's answers. Written once, in the same transaction as the state change. */
@Schema({ collection: 'reports', timestamps: true })
export class Report {
  @Prop({ required: true, unique: true, type: String, ref: 'Session' })
  sessionId!: string;

  @Prop({ required: true, index: true, type: String, ref: 'ClientOrg' })
  clientOrgId!: string;

  @Prop({ required: true })
  participantId!: string;

  @Prop({ required: true, trim: true, maxlength: 4000 })
  notes!: string;

  @Prop({ required: true, min: 1, max: 5 })
  rating!: number;

  /** Object storage key, if evidence was uploaded. Never a URL: the bucket can move. */
  @Prop({ type: String, default: null })
  evidenceKey!: string | null;

  /** Server clock. */
  @Prop({ required: true, type: Date })
  submittedAt!: Date;
}
export type ReportDocument = HydratedDocument<Report>;
export const ReportSchema = SchemaFactory.createForClass(Report);

/**
 * Outbox (CLAUDE.md rule 9).
 *
 * Report submission is a fast transactional write: report + session state + one outbox row.
 * The evaluator consumes rows after the fact, so verification can fail, retry, and be re-run
 * with a newer engine version without touching the submit path.
 */
@Schema({ collection: 'outbox', timestamps: { createdAt: true, updatedAt: false } })
export class OutboxEntry {
  @Prop({ required: true, index: true, type: String, ref: 'Session' })
  sessionId!: string;

  @Prop({ required: true, enum: ['verify_visit'], default: 'verify_visit' })
  kind!: 'verify_visit';

  @Prop({ required: true, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' })
  status!: 'pending' | 'processing' | 'done' | 'failed';

  @Prop({ required: true, default: 0, min: 0 })
  attempts!: number;

  @Prop({ type: Date, default: null })
  lastAttemptAt!: Date | null;

  // Capped. A Mongo error with a stack attached is not small, and every other string in
  // this file is bounded.
  @Prop({ type: String, default: null, maxlength: 2000 })
  lastError!: string | null;

  /** Not before this time. Backoff on retry. */
  @Prop({ required: true, type: Date })
  runAfter!: Date;
}
export type OutboxDocument = HydratedDocument<OutboxEntry>;
export const OutboxSchema = SchemaFactory.createForClass(OutboxEntry);

/**
 * The claim query: oldest pending row that is due.
 *
 * `status` is mutated in place, which is the one exception to "outbox is append-only" and is
 * worth being explicit about: the row's PAYLOAD never changes, only its delivery bookkeeping.
 * The verification RESULT it produces is the append-only artefact.
 */
OutboxSchema.index({ status: 1, runAfter: 1 });

/**
 * The RECLAIM query, and the reason it exists.
 *
 * `status: 'processing'` is set when a worker claims a row, and nothing moved it back. A
 * worker that died mid-row left that visit unverified and un-retried, forever and silently
 * -- the failure class CLAUDE.md section 5 says to care about. Rule 9 promises a retry for a
 * FAILED attempt; it said nothing about a LOST one. Found by the schema-reviewer pass (D-012)
 * and closed by the lease in evaluator.service.ts.
 *
 * `{status, lastAttemptAt}` serves `{status: 'processing', lastAttemptAt: {$lt: cutoff}}`;
 * the `{status, runAfter}` index above cannot, because it has no lastAttemptAt component.
 */
OutboxSchema.index({ status: 1, lastAttemptAt: 1 });

/**
 * Denormalised rollups. Mirrors `VisitRollups` in ../../verification/types.ts.
 *
 * Every field is required and bounded, because this is the console's ONLY substitute for the
 * ping collection (rule 6) and it is permanent (rule 8). The two nullable fields are
 * explicitly `default: null` rather than optional: "no usable fix" is a real outcome that has
 * to be distinguishable from "the evaluator forgot to write this".
 */
@Schema({ _id: false })
export class VisitRollupsDoc {
  @Prop({ required: true, min: 0 })
  fixCount!: number;

  @Prop({ required: true, min: 0 })
  dwellSeconds!: number;

  @Prop({ required: true, min: 0, max: 1 })
  coverageRatio!: number;

  @Prop({ type: Number, required: false, default: null, min: 0 })
  minDistanceM!: number | null;

  @Prop({ type: Number, required: false, default: null, min: 0 })
  medianAccuracyM!: number | null;

  @Prop({ required: true, min: 0 })
  unusableFixCount!: number;
}
export const VisitRollupsSchema = SchemaFactory.createForClass(VisitRollupsDoc);

/**
 * An append-only verification result (CLAUDE.md rule 8).
 *
 * Never updated in place. Re-running the evaluator with a newer engine writes a NEW document;
 * the old verdict remains, which is what makes "why was I rejected in March" answerable. The
 * console reads the newest by (sessionId, createdAt).
 *
 * There is no boolean `verified` field here and there must never be one (rule 1, D-001).
 */
@Schema({ collection: 'verificationResults', timestamps: { createdAt: true, updatedAt: false } })
export class VerificationResultDoc {
  // Both are prefixes of compound indexes declared below.
  @Prop({ required: true, type: String, ref: 'Session' })
  sessionId!: string;

  @Prop({ required: true, type: String, ref: 'ClientOrg' })
  clientOrgId!: string;

  @Prop({
    required: true,
    min: 0,
    max: 100,
    // NaN satisfies min and max -- both `NaN < 0` and `NaN > 100` are false -- so without
    // this a NaN score validates and stores. coverageRatio divides by (endedAt - startedAt)
    // and endedAt is nullable, so this is a reachable path, not a hypothetical. D-012.
    validate: { validator: Number.isFinite, message: 'score must be a finite number' },
  })
  score!: number;

  @Prop({ required: true, enum: VERDICTS })
  verdict!: Verdict;

  /**
   * Signals with their human-readable reasons, denormalised.
   *
   * Bounded: there are nine signal functions and each returns at most one signal, so this
   * array cannot grow unbounded inside the document. If the signal set ever grows past a
   * couple of dozen, this becomes a separate collection.
   */
  @Prop({
    required: true,
    // All three required: rule 1 says every signal carries a human-readable reason, and the
    // schema previously accepted { code: 'x' } with neither reason nor contribution.
    // `code` is deliberately NOT enum-constrained -- engineVersion pins the vocabulary, and
    // an old result must keep a retired code rather than fail to load. D-012.
    type: [
      {
        code: { type: String, required: true },
        contribution: { type: Number, required: true },
        reason: { type: String, required: true },
        _id: false,
      },
    ],
  })
  signals!: { code: string; contribution: number; reason: string }[];

  /** Which engine produced this. Non-negotiable for an append-only result (rule 8). */
  @Prop({ required: true })
  engineVersion!: string;

  /**
   * Rollups, so the console never reads the ping collection (rule 6).
   * Written here by the evaluator rather than computed on read.
   *
   * A real sub-schema, not `type: Object`. As Mixed, a missing `minDistanceM`, a typo'd
   * `dwellSecs` or a `coverageRatio` of -4 all wrote silently, and because results are
   * append-only (rule 8) the console would render blanks forever with no repair path short
   * of a re-run. The shape had already drifted inside this branch -- a test wrote
   * `rollups: {}` and passed. Caught by the schema-reviewer pass, see D-012.
   */
  @Prop({ required: true, type: VisitRollupsSchema })
  rollups!: VisitRollupsDoc;
}
export type VerificationResultDocument = HydratedDocument<VerificationResultDoc>;
export const VerificationResultSchema = SchemaFactory.createForClass(VerificationResultDoc);

// Newest result per session. The console's read path.
VerificationResultSchema.index({ sessionId: 1, createdAt: -1 });
// The review queue: one org's ambiguous band, oldest first so nothing starves.
VerificationResultSchema.index({ clientOrgId: 1, verdict: 1, createdAt: 1 });

/**
 * A human overriding the engine.
 *
 * Separate collection on purpose (rule 8): the engine's verdict and a reviewer's decision are
 * different claims by different authors, and collapsing them would destroy the ability to ask
 * "how often do reviewers disagree with the engine" -- which is the labelled data D-009 needs
 * to make the weights principled.
 */
@Schema({ collection: 'reviewActions', timestamps: { createdAt: true, updatedAt: false } })
export class ReviewAction {
  @Prop({ required: true, index: true, type: String, ref: 'Session' })
  sessionId!: string;

  /** The specific result being overridden, so the override is pinned to an engine version. */
  @Prop({ required: true, type: String, ref: 'VerificationResultDoc' })
  verificationResultId!: string;

  @Prop({ required: true, index: true, type: String, ref: 'ClientOrg' })
  clientOrgId!: string;

  @Prop({ required: true })
  reviewerId!: string;

  @Prop({ required: true, enum: ['approve', 'reject'] })
  decision!: 'approve' | 'reject';

  @Prop({ required: true, trim: true, maxlength: 1000 })
  note!: string;

  @Prop({ required: true, type: Date })
  at!: Date;
}
export type ReviewActionDocument = HydratedDocument<ReviewAction>;
export const ReviewActionSchema = SchemaFactory.createForClass(ReviewAction);

/**
 * Append-only, ENFORCED (rule 8).
 *
 * Both collections carried the rule in a comment and `updatedAt: false`, which stops nothing:
 * `updateOne` still worked. The existing test asserts a re-run WRITES A NEW DOCUMENT; it did
 * not assert that an in-place update is impossible. Rule 8 is non-negotiable and was resting
 * entirely on everyone remembering it. D-012.
 *
 * Deletes are blocked too: a verdict that can be erased is not an audit trail. The TTL on
 * pings is the only sanctioned deletion in this system, and it is on a different collection.
 */
const APPEND_ONLY = /^(updateOne|updateMany|findOneAndUpdate|findOneAndReplace|replaceOne|deleteOne|deleteMany|findOneAndDelete)$/;

function enforceAppendOnly(schema: typeof VerificationResultSchema, label: string): void {
  schema.pre(APPEND_ONLY, function () {
    throw new Error(
      `${label} is append-only (CLAUDE.md rule 8). Write a new document instead of updating ` +
        'or deleting an existing one. A human override belongs in reviewActions.',
    );
  });
}

enforceAppendOnly(VerificationResultSchema, 'verificationResults');
