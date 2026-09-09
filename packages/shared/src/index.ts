/**
 * Shared DTO types. Types and const objects only, no logic, no I/O, no dependencies.
 * See CLAUDE.md section 4.
 *
 * Emitted as CommonJS so the Nest API can require it. Vite consumes CJS without complaint;
 * the reverse is not true, which is why this package is not ESM.
 */

/* ------------------------------------------------------------------ verdicts */

/**
 * There is no boolean `verified` anywhere in this system. See CLAUDE.md rule 1 and D-001.
 * The score that accompanies a verdict is ordinal, not a calibrated probability.
 */
export const VERDICTS = ['auto_verified', 'needs_review', 'rejected'] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * A single piece of evidence contributing to a verdict. `reason` is human readable and is
 * shown to the business user and, on dispute, to the participant. It is not optional and it
 * is not derivable after the fact, so signals carry it from the moment they are produced.
 */
export interface Signal {
  /** Stable identifier, e.g. `coverageRatio`. Used for weighting and for test assertions. */
  code: string;
  /** Contribution to the score. Positive raises confidence, negative lowers it. */
  contribution: number;
  /** Why this fired, in plain language. */
  reason: string;
}

export interface VerificationResult {
  /** 0 to 100, ordinal. */
  score: number;
  verdict: Verdict;
  signals: Signal[];
  /** Results are append-only and carry the version that produced them. CLAUDE.md rule 8. */
  engineVersion: string;
}

/* ---------------------------------------------------------------------- auth */

/**
 * Three roles, three surfaces. `admin` authors venues and tasks, `business` reads the console
 * for its own client org only, `participant` runs visits.
 *
 * Authentication itself is DEMO ONLY. See D-008 — it is deliberately not a real identity
 * system, but the authorization boundaries it enforces are real and are tested.
 */
export const ROLES = ['admin', 'business', 'participant'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  /** Which client organisation this user can see. `null` for admin, who sees all. */
  clientOrgId: string | null;
}

/* ------------------------------------------------------------------ presence */

/**
 * `unknown` is a first-class outcome, not an error. A fix with accuracy worse than the cap
 * is evidence of neither presence nor absence. See the geo-fixtures skill.
 */
export const PRESENCES = ['inside', 'near', 'outside', 'unknown'] as const;
export type Presence = (typeof PRESENCES)[number];

/* ------------------------------------------------------------- session state */

export const SESSION_STATES = [
  'pending',
  'active',
  'ended',
  'submitted',
  'abandoned',
  'expired',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const SESSION_EVENTS = [
  'start',
  'end',
  'submit',
  'abandon',
  'expire',
] as const;
export type SessionEvent = (typeof SESSION_EVENTS)[number];

/* ----------------------------------------------------------- visit outcome */

/**
 * What a PARTICIPANT is told about their own visit.
 *
 * Deliberately a different vocabulary from `Verdict`. A verdict is the engine's claim to the
 * business (`auto_verified | needs_review | rejected`); an outcome is what the person who did
 * the work is entitled to know. The two are not the same statement and must not be conflated:
 * `needs_review` is a queue position, not a judgement, and telling a participant they were
 * "rejected" when a human has not looked yet would be both wrong and unappealable.
 *
 * See D-034 for the release rule and for why score and signals are NOT part of this.
 */
export const VISIT_OUTCOMES = [
  /** Assigned, consented or not, never started. */
  'not_started',
  /** On site, capturing. */
  'in_progress',
  /** Ended, report not filed yet. */
  'awaiting_report',
  /** Report filed. No decision has been released to the participant yet. */
  'in_review',
  /** Released: a human approved it, or the engine auto-verified it and no human was needed. */
  'approved',
  /** Released: a human rejected it. The engine alone never produces this. */
  'not_approved',
  /** Abandoned or expired. `terminalReasonCode` says which timer fired. */
  'closed',
] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];

/**
 * A thing the participant has not seen yet. Derived from session state, never stored as a
 * message: a notification is a VIEW of the work, so it cannot drift from it. Only the
 * "have they seen it" marker is persisted. D-035.
 */
export const NOTIFICATION_KINDS = [
  /** A task was assigned and has not been opened. */
  'assignment',
  /** A decision on a submitted visit was released. */
  'outcome',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
