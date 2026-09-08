import type { Signal } from '@msp/shared';
import { ACCURACY_CAP_M, haversineM } from '../geo/haversine.js';
import type { EngineConfig, EvidenceFix, VisitEvidence, VisitRollups } from './types.js';

/**
 * The signal set.
 *
 * Every signal is a pure function of (evidence, rollups, config) and returns a Signal or null
 * when it has nothing to say. `reason` is written for a human who has to explain a verdict to
 * a participant who is disputing it, so it states what was observed, not what was concluded.
 *
 * Weights are placeholders. They were reasoned about, not measured, because there is no
 * labelled data yet. See D-009 for what would make them principled.
 */

export type SignalFn = (
  evidence: VisitEvidence,
  rollups: VisitRollups,
  config: EngineConfig,
) => Signal | null;

const round = (n: number): number => Math.round(n * 10) / 10;

/* ------------------------------------------------------ absence of evidence */

/**
 * Fires when nothing usable was captured. Deliberately NOT the same as "they were absent" --
 * D-001 is explicit that we cannot distinguish those, and the reason string says so.
 */
export const noUsableEvidence: SignalFn = (_e, rollups) => {
  if (rollups.fixCount === 0) {
    return {
      code: 'noUsableEvidence',
      contribution: -40,
      reason: 'No location fixes were received for this visit. This is not evidence of absence, only an absence of evidence.',
    };
  }
  if (rollups.minDistanceM === null) {
    return {
      code: 'noUsableEvidence',
      contribution: -35,
      reason: `All ${rollups.fixCount} fixes reported accuracy worse than the 100 m cap, so none of them place the participant inside or outside the venue.`,
    };
  }
  return null;
};

/* ------------------------------------------------------------------- dwell */

export const presenceDwell: SignalFn = (_e, rollups, config) => {
  // noUsableEvidence has already spoken. Piling on here would count one fact three times
  // and bury the real reason under two derived ones.
  if (rollups.minDistanceM === null) return null;
  const { dwellSeconds } = rollups;
  const expected = config.expectedDwellSeconds;

  if (dwellSeconds === 0) {
    return {
      code: 'presenceDwell',
      contribution: -20,
      reason: 'No two consecutive fixes both placed the participant inside the venue, so no time on site could be established.',
    };
  }
  const ratio = Math.min(1, dwellSeconds / expected);
  return {
    code: 'presenceDwell',
    contribution: round(-5 + 23 * ratio),
    reason: `Spent about ${Math.round(dwellSeconds / 60)} min inside the venue geofence, against an expected ${Math.round(expected / 60)} min.`,
  };
};

/* ---------------------------------------------------------------- coverage */

/** D-005: gaps are normal on mobile web. This scores how much we saw, not whether it is "complete". */
export const coverage: SignalFn = (_e, rollups) => {
  if (rollups.minDistanceM === null) return null;
  const r = rollups.coverageRatio;
  if (r >= 0.8) {
    return {
      code: 'coverage',
      contribution: 10,
      reason: `Location was sampled across ${Math.round(r * 100)}% of the session, leaving few unobserved gaps.`,
    };
  }
  if (r >= 0.4) {
    return {
      code: 'coverage',
      contribution: round(-6 + 20 * (r - 0.4)),
      reason: `Location was sampled across ${Math.round(r * 100)}% of the session. Gaps are normal when the phone is pocketed, but they limit what can be confirmed.`,
    };
  }
  return {
    code: 'coverage',
    contribution: -18,
    reason: `Only ${Math.round(r * 100)}% of the session was observed. Most of the visit has no location evidence either way.`,
  };
};

/* --------------------------------------------------------------- proximity */

export const proximity: SignalFn = (evidence, rollups) => {
  const min = rollups.minDistanceM;
  if (min === null) return null;
  const radius = evidence.venue.radiusM;

  // The same tolerance the presence rule applies. Without it a fix could be presence
  // "inside" (feeding dwell, +18) while this signal called it "well outside the geofence"
  // (-25), and the console would show a business user two contradictory sentences about the
  // same visit. That is not defensible to a participant disputing a rejection. See D-010.
  const usable = evidence.fixes.filter((f) => f.presence !== 'unknown');
  const tolerance = usable.length
    ? Math.min(ACCURACY_CAP_M, usable.reduce((m, f) => (f.accuracyM < m ? f.accuracyM : m), Infinity))
    : 0;

  if (min <= radius + tolerance) {
    return {
      code: 'proximity',
      contribution: 6,
      reason: `Closest confirmed position was ${Math.round(min)} m from the venue centre, inside the ${radius} m geofence.`,
    };
  }
  if (min <= radius * 2 + tolerance) {
    return {
      code: 'proximity',
      contribution: -10,
      reason: `Closest confirmed position was ${Math.round(min)} m from the venue centre, outside the ${radius} m geofence but nearby.`,
    };
  }
  return {
    code: 'proximity',
    contribution: -25,
    reason: `Closest confirmed position was ${Math.round(min)} m from the venue centre, well outside the ${radius} m geofence.`,
  };
};

/* ----------------------------------------------------- jitter fingerprint */

/**
 * A real stationary device drifts by a few metres between fixes and its reported accuracy
 * varies. Repeated byte-identical coordinates are the signature of a fixed DevTools override,
 * which is the cheapest spoof available and therefore the most common one.
 *
 * See the geo-fixtures skill: honest fixtures must never contain two identical consecutive
 * coordinates, precisely so this signal stays meaningful.
 */
export const jitterFingerprint: SignalFn = (evidence) => {
  const fixes = evidence.fixes;
  if (fixes.length < 3) return null;

  let identical = 0;
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1] as EvidenceFix;
    const b = fixes[i] as EvidenceFix;
    if (a.lat === b.lat && a.lng === b.lng) identical++;
  }
  const ratio = identical / (fixes.length - 1);

  if (ratio >= 0.9) {
    return {
      code: 'jitterFingerprint',
      contribution: -45,
      reason: `${identical} of ${fixes.length - 1} consecutive fixes reported byte-identical coordinates. Real GPS drifts by a few metres even when stationary; this pattern is characteristic of an overridden location.`,
    };
  }
  if (ratio >= 0.5) {
    return {
      code: 'jitterFingerprint',
      contribution: -20,
      reason: `${identical} of ${fixes.length - 1} consecutive fixes repeated the exact same coordinates, which is more repetition than a real device usually produces.`,
    };
  }
  return {
    code: 'jitterFingerprint',
    contribution: 2,
    reason: 'Fix-to-fix movement shows the small random drift characteristic of a real GPS receiver.',
  };
};

/* --------------------------------------------------------- accuracy realism */

/**
 * Two things at once: is the accuracy *varying* like a real receiver, and is it *plausible*
 * for this kind of venue. Indoor venues legitimately report tens of metres, so the engine
 * must not treat degraded indoor accuracy as suspicious -- that would punish honest
 * participants doing exactly what the job requires.
 */
export const accuracyRealism: SignalFn = (evidence, rollups) => {
  // Same anti-double-counting guard as presenceDwell and coverage: when nothing was usable,
  // noUsableEvidence speaks alone. Without this, a trace of entirely unusable fixes earned
  // +2 here for "plausible accuracy", which is nonsense.
  if (rollups.minDistanceM === null) return null;
  const fixes = evidence.fixes;
  if (fixes.length < 3) return null;

  const values = fixes.map((f) => f.accuracyM);
  const distinct = new Set(values).size;

  if (distinct === 1) {
    return {
      code: 'accuracyRealism',
      contribution: -20,
      reason: `Every fix reported exactly ${values[0]} m accuracy. A real receiver's accuracy estimate varies between readings.`,
    };
  }

  const median = rollups.medianAccuracyM ?? 0;
  const indoor = evidence.venue.indoor;

  if (!indoor && median > 60) {
    return {
      code: 'accuracyRealism',
      contribution: -8,
      reason: `Median accuracy was ${Math.round(median)} m at an outdoor venue, which is poorer than a working GPS fix outdoors normally reports.`,
    };
  }
  if (indoor && median < 8) {
    return {
      code: 'accuracyRealism',
      contribution: -12,
      reason: `Median accuracy was ${Math.round(median)} m at an indoor venue. Indoor fixes normally degrade to tens of metres, so readings this tight are unusual.`,
    };
  }
  return {
    code: 'accuracyRealism',
    contribution: 2,
    reason: `Accuracy varied between readings and its median of ${Math.round(median)} m is consistent with an ${indoor ? 'indoor' : 'outdoor'} venue.`,
  };
};

/* -------------------------------------------------------------- clock skew */

/** Rule 3: the delta between the device clock and the server clock is a signal, not noise. */
export const clockSkew: SignalFn = (evidence, _rollups, config) => {
  const fixes = evidence.fixes;
  if (fixes.length === 0) return null;

  // reduce, not Math.max(...spread): a long offline flush would exceed the argument limit
  // and throw RangeError, stalling the outbox on permanent retry.
  const deltas = fixes.map((f) => Math.abs(f.receivedAt - f.capturedAt) / 1000);
  const worst = deltas.reduce((m, d) => (d > m ? d : m), 0);
  const tolerance = config.clockSkewToleranceSeconds;

  if (worst <= tolerance) return null; // unremarkable; say nothing rather than pad the trail

  /**
   * Only the extreme case scores now.
   *
   * A moderate delta here is QUEUE LATENCY, not clock skew, and penalising it taxed exactly
   * the offline buffering that rule 4 exists to make safe: an honest participant flushing
   * after ten minutes underground paid, while an attacker setting capturedAt = Date.now()
   * paid nothing. It was a pure honest-participant penalty.
   *
   * The statistic that would actually catch a forgery is the VARIANCE of the skew across the
   * trace -- a forger's latency is suspiciously constant, a real queue's is not. That is the
   * follow-up recorded in D-010, not something to guess at now.
   */
  if (worst > tolerance * 10) {
    return {
      code: 'clockSkew',
      contribution: -20,
      reason: `Device and server clocks disagreed by up to ${Math.round(worst / 60)} min. A large offset can indicate a replayed or hand-crafted trace.`,
    };
  }
  // Between the tolerance and the extreme: almost certainly a buffered offline flush, which
  // is normal and expected behaviour. Say nothing rather than pad the evidence trail.
  return null;
};

/* ---------------------------------------------------------------- teleport */

export const teleport: SignalFn = (evidence, _rollups, config) => {
  // Usable fixes only. A single cached cell-tower fix at the carrier's registered address,
  // landing between two good GPS fixes, is routine on mobile web. It contributes nothing to
  // presence and must not be able to fire a -30 movement penalty on an honest trace.
  const fixes = evidence.fixes.filter((f) => f.presence !== 'unknown');
  if (fixes.length < 2) return null;

  let worst = 0;
  let sameStamp = 0;
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1] as EvidenceFix;
    const b = fixes[i] as EvidenceFix;
    const seconds = (b.receivedAt - a.receivedAt) / 1000;
    if (seconds <= 0) {
      // Two fixes in different places sharing a server timestamp means receivedAt was
      // stamped per BATCH rather than per fix. Skipping the pair silently disables this
      // signal for every offline flush, which is exactly what an attacker wants. Count it.
      if (haversineM(a, b) > 0) sameStamp++;
      continue;
    }
    const speed = haversineM(a, b) / seconds;
    if (speed > worst) worst = speed;
  }

  if (sameStamp > 0) {
    return {
      code: 'teleport',
      contribution: -12,
      reason: `${sameStamp} pairs of fixes arrived carrying the same server timestamp despite being in different places, so the movement between them could not be checked.`,
    };
  }

  if (worst > config.implausibleSpeedMps) {
    return {
      code: 'teleport',
      contribution: -30,
      reason: `Implied movement of ${Math.round(worst * 3.6)} km/h between two consecutive fixes, which is not physically plausible for a shopper on foot.`,
    };
  }
  return null;
};

/* ------------------------------------------------------ approach/departure */

/**
 * A real visit has fixes outside the fence before and after the dwell. A trace that begins
 * inside and ends inside, with nothing either side, is what you get from an override toggled
 * on and off -- nobody materialises in a shop.
 */
export const approachDeparture: SignalFn = (evidence) => {
  const usable = evidence.fixes.filter((f) => f.presence !== 'unknown');
  if (usable.length < 4) return null;

  const first = usable[0] as EvidenceFix;
  const last = usable[usable.length - 1] as EvidenceFix;
  const approached = first.presence !== 'inside';
  const departed = last.presence !== 'inside';
  const everInside = usable.some((f) => f.presence === 'inside');
  if (!everInside) return null;

  if (approached && departed) {
    return {
      code: 'approachDeparture',
      contribution: 6,
      reason: 'The trace shows the participant arriving from outside the geofence and leaving again afterwards, consistent with a real visit.',
    };
  }
  if (!approached && !departed) {
    /**
     * Only -6, and worded as "not corroborated" rather than as an accusation.
     *
     * This was -18 until the spoof-adversary pass pointed out that CLAUDE.md section 1
     * describes the honest flow as "starts a visit session, keeps the tab open while on
     * site, ends the session" -- which is start-inside, end-inside. Penalising that heavily
     * sent the MODAL HONEST VISIT to manual review. Recording an approach would require the
     * participant to grant location permission and keep the tab foregrounded on the walk in
     * from the car park, which nobody does. See D-010.
     */
    return {
      code: 'approachDeparture',
      contribution: -6,
      reason: 'Location reporting began and ended on site, so the journey to and from the venue could not be corroborated. This is expected when a session is started after arriving.',
    };
  }
  // One-sided. Weak, but returning null here made the toggle-off spoof completely free.
  return {
    code: 'approachDeparture',
    contribution: -2,
    reason: approached
      ? 'An approach to the venue was recorded but no departure, so the end of the visit is uncorroborated.'
      : 'A departure was recorded but no approach, so the start of the visit is uncorroborated.',
  };
};

/** Evaluation order is display order in the console, so most decisive first. */
export const ALL_SIGNALS: readonly SignalFn[] = [
  noUsableEvidence,
  jitterFingerprint,
  teleport,
  presenceDwell,
  proximity,
  coverage,
  accuracyRealism,
  approachDeparture,
  clockSkew,
];
