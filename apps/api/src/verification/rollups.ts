import type { EvidenceFix, VisitEvidence, VisitRollups } from './types.js';

/**
 * Pure derivations over a trace. Everything the signals need is computed once here so a
 * signal cannot quietly disagree with the number the console shows.
 */

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/**
 * Dwell is integrated over gaps between consecutive fixes, not counted per fix.
 *
 * A fix is an instant, not a duration. Counting "12 fixes inside x 30s cadence" would let a
 * spoofer inflate dwell just by sampling faster. Integrating over the actual interval
 * between two fixes that were both inside is cadence-independent.
 *
 * A gap only counts when BOTH ends are inside, and **each interval is capped at the same
 * maxGap that coverageRatio uses**. Without that cap this function credits arbitrarily long
 * unobserved time: two fixes five minutes apart both reading `inside` bought 300 seconds of
 * dwell from two observed instants. That was the cheapest attack on the engine -- spoof two
 * coordinates, switch the override off, let the real phone supply the rest of the trace --
 * and it scored 78, auto-verified. Found by the spoof-adversary pass, see D-010.
 *
 * We did not observe the middle, so we do not claim more than one sampling window of it.
 */
export function dwellSeconds(fixes: EvidenceFix[], maxGapSeconds: number): number {
  const maxGapMs = maxGapSeconds * 1000;
  let total = 0;
  for (let i = 1; i < fixes.length; i++) {
    const prev = fixes[i - 1] as EvidenceFix;
    const cur = fixes[i] as EvidenceFix;
    if (prev.presence === 'inside' && cur.presence === 'inside') {
      total += Math.min(Math.max(0, cur.receivedAt - prev.receivedAt), maxGapMs) / 1000;
    }
  }
  return Math.round(total);
}

/**
 * How much of the session we actually observed, 0..1.
 *
 * D-005: gaps are a normal condition on mobile web, not a failure. This turns "how much
 * evidence exists" into a number the score can weigh, instead of treating a backgrounded
 * tab as proof of absence.
 *
 * Computed as observed span over session span, where a gap wider than three sampling
 * intervals counts as unobserved.
 */
export function coverageRatio(evidence: VisitEvidence, expectedIntervalSeconds: number): number {
  const { startedAt, endedAt } = evidence.session;
  const span = endedAt - startedAt;
  if (span <= 0) return 0;

  const usable = evidence.fixes.filter((f) => f.presence !== 'unknown');
  if (usable.length === 0) return 0;

  const maxGapMs = expectedIntervalSeconds * 3 * 1000;
  let observed = 0;

  // Leading edge: from session start to the first fix, capped at one max gap.
  const first = usable[0] as EvidenceFix;
  observed += Math.min(Math.max(0, first.receivedAt - startedAt), maxGapMs);

  for (let i = 1; i < usable.length; i++) {
    const prev = usable[i - 1] as EvidenceFix;
    const cur = usable[i] as EvidenceFix;
    observed += Math.min(Math.max(0, cur.receivedAt - prev.receivedAt), maxGapMs);
  }

  // Trailing edge.
  const last = usable[usable.length - 1] as EvidenceFix;
  observed += Math.min(Math.max(0, endedAt - last.receivedAt), maxGapMs);

  return Math.min(1, observed / span);
}

export function computeRollups(
  evidence: VisitEvidence,
  expectedIntervalSeconds: number,
): VisitRollups {
  const { fixes } = evidence;
  const usable = fixes.filter((f) => f.presence !== 'unknown');

  return {
    fixCount: fixes.length,
    dwellSeconds: dwellSeconds(fixes, expectedIntervalSeconds * 3),
    coverageRatio: coverageRatio(evidence, expectedIntervalSeconds),
    // reduce, not Math.min(...spread): a long offline flush would blow the argument limit
    // and throw RangeError, which would stall the outbox retrying forever.
    minDistanceM: usable.length
      ? usable.reduce((m, f) => (f.distanceM < m ? f.distanceM : m), Infinity)
      : null,
    // Usable fixes only. Including coarse fixes the accuracy cap already discarded drags the
    // median up and then penalises the participant for fixes that were never used.
    medianAccuracyM: median(usable.map((f) => f.accuracyM)),
    unusableFixCount: fixes.length - usable.length,
  };
}
