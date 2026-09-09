import type { SessionState, Verdict, VisitOutcome } from '@msp/shared';
import { hasReadDecision, isReleased, releaseOutcome, type OutcomeInput } from './outcome.js';

/**
 * The release rule, table-driven.
 *
 * This is the one piece of the participant dashboard that fails SILENTLY when it is wrong.
 * A broken list is loud; a release rule that leaks one verdict early produces a perfectly
 * working screen showing something nobody meant to send. CLAUDE.md section 5, exactly.
 *
 * The table is written as claims about what a participant is TOLD, not as branch coverage.
 */

const AT = new Date('2026-09-09T10:00:00.000Z');
const RESULT_AT = new Date('2026-09-09T09:00:00.000Z');

const input = (over: Partial<OutcomeInput> = {}): OutcomeInput => ({
  state: 'submitted',
  latestVerdict: null,
  latestResultAt: null,
  review: null,
  ...over,
});

const review = (
  decision: 'approve' | 'reject',
  feedbackToParticipant: string | null = null,
): OutcomeInput['review'] => ({ decision, feedbackToParticipant, at: AT });

describe('releaseOutcome', () => {
  describe('a visit that is not finished says where it is, and nothing else', () => {
    const cases: [SessionState, VisitOutcome][] = [
      ['pending', 'not_started'],
      ['active', 'in_progress'],
      ['ended', 'awaiting_report'],
      ['abandoned', 'closed'],
      ['expired', 'closed'],
    ];

    it.each(cases)('%s -> %s', (state, expected) => {
      const r = releaseOutcome(input({ state }));
      expect(r.outcome).toBe(expected);
      expect(r.feedback).toBeNull();
      expect(r.decidedAt).toBeNull();
      expect(r.decidedByHuman).toBe(false);
    });

    it('a verdict on an unfinished visit is still not released', () => {
      // Reachable: the evaluator can only run after submit, but a re-run plus a reaper race
      // is not worth relying on being impossible for a disclosure rule.
      const r = releaseOutcome(
        input({ state: 'active', latestVerdict: 'auto_verified', latestResultAt: RESULT_AT }),
      );
      expect(r.outcome).toBe('in_progress');
      expect(isReleased(r.outcome)).toBe(false);
    });
  });

  describe('the engine alone', () => {
    it('auto_verified is released as approved, with no feedback and no human', () => {
      const r = releaseOutcome(
        input({ latestVerdict: 'auto_verified', latestResultAt: RESULT_AT }),
      );
      expect(r.outcome).toBe('approved');
      expect(r.feedback).toBeNull();
      expect(r.decidedByHuman).toBe(false);
      // It still carries a release TIME, which is what makes a superseded decision detectable.
      expect(r.decidedAt).toEqual(RESULT_AT);
    });

    /**
     * The claim this file exists to defend. `rejected` is the engine's opinion; until a person
     * signs it, the organisation has not said anything, and telling a participant they were
     * rejected would be an unappealable accusation nobody made.
     */
    it.each<[Verdict]>([['needs_review'], ['rejected']])(
      '%s is NOT released and shows as in_review',
      (verdict) => {
        const r = releaseOutcome(input({ latestVerdict: verdict, latestResultAt: RESULT_AT }));
        expect(r.outcome).toBe('in_review');
        expect(isReleased(r.outcome)).toBe(false);
        expect(r.decidedAt).toBeNull();
      },
    );

    it('the window between submit and the evaluator running is in_review', () => {
      expect(releaseOutcome(input({ latestVerdict: null })).outcome).toBe('in_review');
    });
  });

  describe('a human decision', () => {
    it('approve releases as approved and carries the feedback', () => {
      const r = releaseOutcome(input({ review: review('approve', 'Clear photo, thank you.') }));
      expect(r.outcome).toBe('approved');
      expect(r.feedback).toBe('Clear photo, thank you.');
      expect(r.decidedByHuman).toBe(true);
      expect(r.decidedAt).toEqual(AT);
    });

    it('reject releases as not_approved', () => {
      const r = releaseOutcome(input({ review: review('reject', 'Wrong branch.') }));
      expect(r.outcome).toBe('not_approved');
      expect(r.feedback).toBe('Wrong branch.');
      expect(r.decidedByHuman).toBe(true);
    });

    it('overrides the engine in BOTH directions', () => {
      expect(
        releaseOutcome(
          input({ latestVerdict: 'auto_verified', latestResultAt: RESULT_AT, review: review('reject') }),
        ).outcome,
      ).toBe('not_approved');
      expect(
        releaseOutcome(input({ latestVerdict: 'rejected', review: review('approve') })).outcome,
      ).toBe('approved');
    });

    it('empty or whitespace feedback is null, not an empty bubble on the screen', () => {
      expect(releaseOutcome(input({ review: review('approve', '   ') })).feedback).toBeNull();
      expect(releaseOutcome(input({ review: review('approve', null) })).feedback).toBeNull();
    });
  });

  /**
   * The negative claim, asserted structurally rather than by reading the code: no score, no
   * signal and no engine version can reach a participant through this function, whatever a
   * future caller passes in. D-034.
   */
  it('never returns a score, a signal or an engine version', () => {
    const r = releaseOutcome(input({ latestVerdict: 'auto_verified', latestResultAt: RESULT_AT }));
    expect(Object.keys(r).sort()).toEqual(['decidedAt', 'decidedByHuman', 'feedback', 'outcome']);
  });
});

describe('hasReadDecision', () => {
  const seen = new Date('2026-09-09T12:00:00.000Z');

  it('is false when there is no marker', () => {
    expect(hasReadDecision(null, AT)).toBe(false);
    expect(hasReadDecision(undefined, AT)).toBe(false);
  });

  it('is false when nothing has been released', () => {
    expect(hasReadDecision(seen, null)).toBe(false);
  });

  it('is true when they looked after the decision', () => {
    expect(hasReadDecision(seen, AT)).toBe(true);
  });

  it('is true when the two are the same instant', () => {
    expect(hasReadDecision(AT, AT)).toBe(true);
  });

  /**
   * The reason this is a comparison and not a boolean. A reviewer reverses an approval, or the
   * evaluator re-runs under a newer engine: the decision is NEW, the old marker predates it,
   * and the participant has to be told again.
   */
  it('is false again once the decision is superseded', () => {
    const laterDecision = new Date(seen.getTime() + 60_000);
    expect(hasReadDecision(seen, laterDecision)).toBe(false);
  });
});
