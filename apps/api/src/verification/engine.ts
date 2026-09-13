import type { Verdict } from '@msp/shared';
import { computeRollups } from './rollups.js';
import { ALL_SIGNALS } from './signals.js';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig, type EngineOutput, type VisitEvidence } from './types.js';

/**
 * The verification engine. Pure: evidence in, result out.
 *
 * No Mongoose, no I/O, no Date.now(). Everything time-related arrives inside the evidence
 * object. That is what makes this cheap to test, and it is the most important code in the
 * repo (CLAUDE.md section 4).
 */

/**
 * Scoring starts at 50, not 0.
 *
 * 0 would mean "no evidence == rejected", which contradicts D-005: gaps are a normal
 * condition on mobile web, not proof of anything. Starting at the middle of the band means a
 * visit we learned nothing about lands in `needs_review` -- which is the honest answer -- and
 * signals push it up or down from there.
 */
export const BASE_SCORE = 50;

function bandFor(score: number, config: EngineConfig): Verdict {
  if (score >= config.autoThreshold) return 'auto_verified';
  if (score < config.rejectThreshold) return 'rejected';
  return 'needs_review';
}

export function evaluate(
  evidence: VisitEvidence,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): EngineOutput {
  const rollups = computeRollups(evidence, config.expectedSampleIntervalSeconds);

  const signals = ALL_SIGNALS.map((fn) => fn(evidence, rollups, config)).filter(
    (s): s is NonNullable<typeof s> => s !== null,
  );

  const raw = signals.reduce((acc, s) => acc + s.contribution, BASE_SCORE);

  /**
   * Absence of evidence never rejects on its own.
   *
   * `rejected` renders to the business as "Not supported by the evidence" and to the
   * participant as a refusal. That is a claim ABOUT the visit, and it requires evidence that
   * contradicts the visit -- a spoof fingerprint, an impossible movement, a position provably
   * somewhere else. A trace we simply could not read is not that. D-001 says we cannot
   * distinguish "absent" from "no evidence", `noUsableEvidence`'s own reason string says so in
   * words, and the comment on BASE_SCORE above says the honest landing place for a visit we
   * learned nothing about is `needs_review`. The arithmetic disagreed with all three.
   *
   * This was not hypothetical. A desktop browser has no GPS radio, so Chrome answers
   * `getCurrentPosition` from Wi-Fi and reports accuracy in the 100-500 m band -- 182 m on the
   * visits that prompted this fix, from a machine that was 9 m from the venue centre. Every
   * fix exceeded the 100 m cap, every other signal correctly self-suppressed, and the one
   * remaining signal docked enough to reject. Every honest laptop visit scored exactly 15.
   *
   * The floor is expressed against `config.rejectThreshold` rather than baked into the
   * signal's contribution because the threshold is configurable (VERIFY_REJECT_THRESHOLD).
   * Tuning it must not silently re-open this hole. The narrow condition -- absence as the ONLY
   * thing the engine found -- is what keeps the guard honest: `clockSkew` still fires on an
   * unreadable trace, and an hour of clock offset IS contradicting evidence, so a hand-crafted
   * replay can still reject.
   */
  const onlyAbsence = signals.length === 1 && signals[0]!.code === 'noUsableEvidence';
  /**
   * Clamped below `autoThreshold`, because a floor that can cross it is worse than no floor.
   *
   * `bandFor` tests `auto_verified` FIRST, and `evaluator.service.ts` validates the two
   * thresholds only for being finite and positive -- it never checks that reject sits below
   * auto. So `VERIFY_REJECT_THRESHOLD=80` against the default `autoThreshold: 75` floored a
   * zero-fix session at 80 and **auto-verified a visit with no evidence whatsoever**, paying it
   * with no human ever looking. A guard written to stop the engine over-accusing people turned
   * into one that silently approved everything.
   *
   * Found by the spoof-adversary pass. The test loop that was supposed to cover this ran
   * thresholds 30/40/55/70 and stopped one step short of the inversion; it now runs past it.
   */
  const floor = onlyAbsence ? Math.min(config.rejectThreshold, config.autoThreshold - 1) : 0;
  const score = Math.max(floor, Math.min(100, Math.round(raw)));

  return {
    score,
    verdict: bandFor(score, config),
    signals,
    engineVersion: config.engineVersion,
    rollups,
  };
}
