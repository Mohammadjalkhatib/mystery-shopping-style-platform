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

/**
 * Separate inside-to-inside observations needed before dwell can score in full.
 *
 * Five, because the dwell integrator caps one interval at three sampling periods, so five
 * intervals is the point at which the elapsed time being claimed cannot come from a single
 * observation however the task's expectation is authored. It is a corroboration floor, not a
 * duration: a short task stays short, it just has to be watched rather than asserted.
 */
export const MIN_DWELL_INTERVALS = 5;

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
  /**
   * Time AND corroboration. Full credit needs both.
   *
   * `expectedDwellSeconds` is authored per task and may legitimately be short -- a drive-through
   * check really is a one-minute job. But the dwell integrator caps each interval at three
   * sampling periods (90 s), so any expectation at or below that could be satisfied by a SINGLE
   * pair of fixes: two pings, two minutes, and the largest positive signal in the engine paid
   * out in full. The spoof-adversary pass scored that fabrication at 88 against an honest
   * gappy visit's 75 -- the engine ranking a forgery above a real visit, which is the same
   * inversion D-010's dwell cap was written to end.
   *
   * The fix keeps short tasks authorable and makes them cost more EVIDENCE rather than more
   * time: saturation requires `MIN_DWELL_INTERVALS` separate inside-to-inside observations.
   * An honest participant standing still and sampling every 30 s reaches that in about two
   * and a half minutes; a fabricator has to keep the forgery running just as long.
   */
  const ratio = Math.min(1, dwellSeconds / expected);
  const corroboration = Math.min(1, rollups.dwellIntervals / MIN_DWELL_INTERVALS);
  const contribution = round(-5 + 23 * ratio * corroboration);
  const thin = corroboration < 1;
  return {
    code: 'presenceDwell',
    contribution,
    reason: thin
      ? `Spent about ${Math.round(dwellSeconds / 60)} min inside the venue geofence, but across only ${rollups.dwellIntervals} location update${rollups.dwellIntervals === 1 ? '' : 's'} — too few to corroborate continuous presence.`
      : `Spent about ${Math.round(dwellSeconds / 60)} min inside the venue geofence, against an expected ${Math.round(expected / 60)} min.`,
  };
};

/* ---------------------------------------------------------------- coverage */

/** D-005: gaps are normal on mobile web. This scores how much we saw, not whether it is "complete". */
export const coverage: SignalFn = (_e, rollups) => {
  if (rollups.minDistanceM === null) return null;
  const r = rollups.coverageRatio;

  /**
   * A ratio of a window the attacker chose is not evidence of volume.
   *
   * `coverageRatio` is observed time over `endedAt - startedAt`, and a fabricator owns both
   * boundaries: press Start immediately before the first ping and End immediately after the
   * last, and coverage is pinned at 1.0 for a four-ping, four-minute forgery -- worth +10,
   * against an honest pocketed visit's -18. A 28-point swing in the forger's favour, on a
   * signal that in adversarial terms only ever charged honest participants.
   *
   * So full credit now also requires the session to have been observed OFTEN enough, reusing
   * the same corroboration floor `presenceDwell` uses. Deliberately density and not duration:
   * `presenceDwell` already scales with how long the visit ran, and charging for that twice
   * would count one fact in two places -- the mistake `noUsableEvidence`'s guard exists to
   * prevent elsewhere in this file. Four pings ninety seconds apart is 100% coverage of a
   * window the fabricator chose; ten pings thirty seconds apart is a watched visit.
   *
   * Found by the second spoof-adversary pass.
   */
  const wellObserved = rollups.dwellIntervals >= MIN_DWELL_INTERVALS;

  if (r >= 0.8 && wellObserved) {
    return {
      code: 'coverage',
      contribution: 10,
      reason: `Location was sampled across ${Math.round(r * 100)}% of the session, leaving few unobserved gaps.`,
    };
  }
  if (r >= 0.8) {
    return {
      code: 'coverage',
      contribution: 3,
      reason: `Location was sampled across ${Math.round(r * 100)}% of the session, but across only ${rollups.dwellIntervals} update${rollups.dwellIntervals === 1 ? '' : 's'} inside the venue — too sparse to confirm much.`,
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

  /**
   * USABLE fixes only, and this line is a fix for a real hole.
   *
   * `medianAccuracyM` is computed from usable fixes; this array used to be computed from ALL
   * of them. Appending one junk fix with `accuracyM: 250` therefore inflated the spread
   * without moving the median, and disabled BOTH negative branches at once -- the tight-
   * cluster fabrication went from 71 to 88, and a frozen-coordinate spoof from 19 (rejected)
   * to 41 (needs_review), for the price of one extra ping. Found by the second
   * spoof-adversary pass. The two statistics must be drawn from the same population.
   */
  const values = fixes.filter((f) => f.presence !== 'unknown').map((f) => f.accuracyM);
  if (values.length < 3) return null;
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
  /**
   * DISPERSION, not level. This is the replacement for the old indoor threshold, and the
   * difference is the whole point.
   *
   * The old branch fired on `indoor && median < 8` for -12, on the premise that indoor fixes
   * "degrade to tens of metres". That was true of older hardware and is not true now: a current
   * phone fusing GNSS with Wi-Fi routinely reports 4-8 m inside a shop. It produced a false
   * positive on three separate real visits, every one an honest participant standing in the
   * right place with a good phone -- the only evidence this project has ever had about that
   * signal, and all of it said the threshold was wrong.
   *
   * But deleting it outright left NOTHING watching accuracy on an indoor venue, and the
   * spoof-adversary pass showed why that matters: 4-8 m is exactly the band a hand-written
   * shim picks, because nobody faking a fix types `accuracy: 47`. So the level was the wrong
   * statistic and the shape is the right one. A real receiver's estimate wanders as satellites
   * and access points come and go; a generated one clusters tightly around whatever constant
   * the author chose. `distinct === 1` above is the degenerate case of exactly this test, and
   * this generalises it to a continuum.
   *
   * Honest fixtures measure 0.55-1.17 on this. A shim emitting `12 + rand()*1` measures 0.08.
   */
  /**
   * Robust spread, and only where quantisation cannot explain it.
   *
   * Three guards, each closing something the second adversary pass found:
   *
   * - **p10..p90, not max-min.** `(max - min)` is the least robust dispersion statistic there
   *   is: one outlying value defeats it entirely. Percentiles require the attacker to move a
   *   fifth of the trace, not one entry.
   * - **`distinct >= 4`.** This is what separates a shim from an honest Android. The ping DTO
   *   already warns that a stationary device on one unchanging Wi-Fi scan reports a quantised,
   *   REPEATING accuracy -- a handful of values, each seen many times. A generated trace has
   *   many distinct values clustered tightly. Without this guard the branch re-opens exactly
   *   the false positive that comment exists to prevent, which is how the previous version of
   *   this signal earned three false positives on real honest visits.
   * - **eight fixes.** Below that a spread is noise, and a four-fix trace could skip the check
   *   entirely by staying under the old five-fix guard.
   */
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const spread = median > 0 ? (at(0.9) - at(0.1)) / median : 1;
  if (values.length >= 8 && distinct >= 4 && spread < 0.15) {
    return {
      code: 'accuracyRealism',
      /**
       * -15, not -10, and the number is not a taste.
       *
       * The maximum reachable score is 88 and the auto threshold is 75, so every trace carries
       * a 13-point cushion. A penalty of 10 leaves a tight-cluster fabrication at 78 -- still
       * auto-verified, still nobody looking at it. Any signal meant to actually stop something
       * has to exceed the cushion, or it is a decoration that reads like a defence.
       */
      contribution: -15,
      reason: `Reported accuracy barely moved across the visit (${at(0.1).toFixed(1)}-${at(0.9).toFixed(1)} m). A real receiver's accuracy estimate wanders as conditions change.`,
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
 * REMOVED. It could not detect anything, and it paid the attacker more than the honest user.
 *
 * The signal rewarded a trace that showed the participant arriving from outside the fence and
 * leaving again. It went -18, then -6, then 0 for the "neither observed" case, each time for
 * the same reason: the participant screen says "Start the visit as you arrive, and keep this
 * page open while you are inside", and following that instruction produces start-inside /
 * end-inside. Every version of the rule was docking people for compliance with our own
 * onboarding.
 *
 * Once the penalty reached 0 the signal could only ever ADD to a score, which the
 * spoof-adversary pass identified as strictly worse than deleting it: a fabricator
 * synthesising coordinates adds two entries 250 m out for free and collects the bonus, while
 * the honest participant who did as they were told collects nothing. A signal whose only
 * possible effect is the attacker's preferred outcome is not a fraud signal.
 *
 * There is no replacement. The thing it claimed to measure -- the journey to and from the
 * venue -- is not observable by a web client that is told to start on arrival, and pretending
 * otherwise cost this engine three revisions. See D-032.
 */

/** Evaluation order is display order in the console, so most decisive first. */
export const ALL_SIGNALS: readonly SignalFn[] = [
  noUsableEvidence,
  jitterFingerprint,
  teleport,
  presenceDwell,
  proximity,
  coverage,
  accuracyRealism,
  clockSkew,
];
