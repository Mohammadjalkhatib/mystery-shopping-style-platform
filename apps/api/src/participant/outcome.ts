import type { SessionState, Verdict, VisitOutcome } from '@msp/shared';

/**
 * The release rule: what a participant is allowed to be told about their own visit.
 *
 * Pure, and separated from the service for the same reason `state-machine.ts` is: getting this
 * wrong is silent. There is no error, no failing request and no log line when a participant is
 * shown a decision that was never released -- there is just a person reading a verdict nobody
 * meant to send them. That is the failure class CLAUDE.md section 5 says to test.
 *
 * Three things this deliberately does NOT do (D-034):
 *
 * 1. **It never returns a score or a signal.** The signals ARE the anti-spoof rules. Telling a
 *    participant "your coverage ratio was 0.43" is a tutorial for beating the engine, and
 *    every attack the spoof-adversary agent has found so far gets cheaper with that number in
 *    hand. The business console keeps full detail; the participant gets an outcome.
 * 2. **It never maps `rejected` to `not_approved` on its own.** A `rejected` verdict with no
 *    human decision is the engine's opinion, not the organisation's, and it stays `in_review`
 *    until someone signs their name to it. Rule 1 says there is no boolean `verified`; the
 *    corollary is that there is no automatic accusation either.
 * 3. **It never maps `needs_review` to anything but `in_review`.** That verdict is a queue
 *    position, not a judgement.
 *
 * `auto_verified` IS released without a human, because the alternative is that a clean visit
 * sits at "in review" forever and the honest majority get the worst experience in the system.
 */
export interface OutcomeInput {
  state: SessionState;
  /** The newest verification result's verdict, denormalised on the session. */
  latestVerdict: Verdict | null;
  /** When that result was written. The release time when no human reviewed the visit. */
  latestResultAt: Date | null;
  /** The newest human decision on this visit, or null if nobody has reviewed it. */
  review: { decision: 'approve' | 'reject'; feedbackToParticipant: string | null; at: Date } | null;
}

export interface ReleasedOutcome {
  outcome: VisitOutcome;
  /** The reviewer's words, or null. Only ever populated for a released human decision. */
  feedback: string | null;
  /**
   * When the decision currently on offer was released, or null if none has been.
   *
   * Set for an engine release as well as a human one, and that is what makes "have they read
   * the CURRENT decision" answerable: a marker compared against this survives the decision
   * being superseded, where a boolean "have they ever looked" does not.
   */
  decidedAt: Date | null;
  /**
   * True when a human signed this. Distinguishes "approved by the engine" from "approved by
   * a person", which is the difference between "nobody needed to look" and "somebody looked".
   */
  decidedByHuman: boolean;
}

export function releaseOutcome(input: OutcomeInput): ReleasedOutcome {
  const none = { feedback: null, decidedAt: null, decidedByHuman: false };

  switch (input.state) {
    case 'pending':
      return { outcome: 'not_started', ...none };
    case 'active':
      return { outcome: 'in_progress', ...none };
    case 'ended':
      return { outcome: 'awaiting_report', ...none };
    case 'abandoned':
    case 'expired':
      // `terminalReasonCode` already says which timer fired, and the participant screen says
      // it in their language. Nothing to add here.
      return { outcome: 'closed', ...none };
    case 'submitted':
      break;
  }

  // A human decision wins over the engine, always and in both directions -- including a
  // reviewer rejecting something the engine auto-verified.
  if (input.review) {
    return {
      outcome: input.review.decision === 'approve' ? 'approved' : 'not_approved',
      feedback: input.review.feedbackToParticipant?.trim() || null,
      decidedAt: input.review.at,
      decidedByHuman: true,
    };
  }

  if (input.latestVerdict === 'auto_verified') {
    // Released, with no feedback, because there is no author to have written any. It still
    // carries a release time, taken from the result that produced it.
    return {
      outcome: 'approved',
      feedback: null,
      decidedAt: input.latestResultAt,
      decidedByHuman: false,
    };
  }

  // Includes `latestVerdict === null`, which is the window between submit and the evaluator
  // running. "In review" is true of that window as well.
  return { outcome: 'in_review', ...none };
}

/** Whether an outcome is a released decision the participant is entitled to be told about. */
export function isReleased(outcome: VisitOutcome): boolean {
  return outcome === 'approved' || outcome === 'not_approved';
}

/**
 * Has the participant read the decision that is on offer RIGHT NOW?
 *
 * Deliberately a comparison and not a boolean field. A set-once "they looked" marker answers
 * the wrong question: a reviewer who files a second `reviewAction` reversing an approval, or a
 * re-run under a newer `engineVersion` that changes the verdict, both produce a NEW decision
 * that the old marker already covers -- so the reversal is released and silently never
 * announced. Read strictly: an unread decision is the safe default, so an absent marker, an
 * absent release time and a marker older than the release all count as unread.
 *
 * `>=` rather than `>`: the ack is written after the read, so equal timestamps mean read.
 */
export function hasReadDecision(
  outcomeSeenAt: Date | null | undefined,
  decidedAt: Date | null,
): boolean {
  if (!outcomeSeenAt || !decidedAt) return false;
  return outcomeSeenAt.getTime() >= decidedAt.getTime();
}
