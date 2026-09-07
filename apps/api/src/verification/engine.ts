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
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    score,
    verdict: bandFor(score, config),
    signals,
    engineVersion: config.engineVersion,
    rollups,
  };
}
