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
      /**
       * -20, not -40, and the change is the point rather than a retune.
       *
       * -40 put this case at 10 and the coarse-fix case at 15, both under any sane reject
       * threshold, which made "we could not read this visit" indistinguishable in the console
       * from "this visit did not happen". The engine now floors an absence-only trace at the
       * reject threshold (see `evaluate`), so these numbers no longer decide the VERDICT -- they
       * only place the score within `needs_review`, below every trace that actually showed us
       * something. Nothing learned at all still ranks below something unreadable.
       */
      contribution: -20,
      reason: 'No location fixes were received for this visit. This is not evidence of absence, only an absence of evidence.',
    };
  }
  /**
   * There used to be a second branch here for "every fix was above the accuracy cap", and D-054
   * deleted it rather than retuning it. Reported accuracy no longer discards a fix, so a coarse
   * trace now has a position and is scored on it: `proximity` charges a coarse fix that is
   * genuinely far away, and credits one that is genuinely at the venue. The branch was the
   * engine describing its own discarded input, and the bucket it fed had become a safe harbour
   * reachable from anywhere on earth.
   */
  return null;
};

/* ------------------------------------------- coarse fixes that still exclude */

/**
 * REMOVED by D-054, and the reason is worth keeping because the signal was correct about a
 * problem that no longer exists.
 *
 * It fired only when `minDistanceM === null` -- i.e. when every fix had been discarded for coarse
 * accuracy -- and recovered the one thing that discarding threw away: a 182 m uncertainty circle
 * centred 5 km from the venue cannot reach the fence, so it excludes presence even though it
 * cannot confirm it. That was a real gap and this closed it.
 *
 * D-054 removed the discarding instead. A coarse fix now keeps its position and is scored by
 * `proximity` like any other, which charges -25 for "well outside the geofence" on exactly the
 * trace this signal was built to catch, and -10 for one merely nearby -- a gradient the binary
 * exclusion test never had. Two mechanisms for one job, and the general one is better. Deleting
 * it also removed the attack it had brought with it: its margin scaled with client-supplied
 * `accuracyM`, so reporting 2000 m of accuracy from home switched the exclusion off entirely.
 */

/* ------------------------------------------------------------------- dwell */

/**
 * Ceiling on the corroboration requirement: the most separate inside-to-inside observations any
 * task can be asked for before dwell scores in full.
 */
export const MIN_DWELL_INTERVALS = 5;

/**
 * Floor on it. Two, because the attack D-032 found was that a SINGLE capped interval could
 * saturate dwell -- two fixes, two minutes, and the largest positive signal in the engine paid
 * out in full. Requiring two intervals means three fixes, which ends that specific attack for
 * every task length, however short.
 */
export const MIN_CORROBORATION_INTERVALS = 2;

/**
 * How many inside-to-inside observations THIS task can fairly be asked for.
 *
 * D-032 set a flat floor of five and claimed "a short task stays short, it just has to be watched
 * rather than asserted". That claim was false, and the arithmetic is not subtle: `useVisitTracker`
 * throttles to one fix per `expectedSampleIntervalSeconds` (30 s), so five intervals needs six
 * fixes and **two and a half minutes of wall time**. A task authored at one minute -- which the
 * admin form allows, the schema stores and `dwellExpectationFor` reads -- could therefore never
 * reach full dwell credit, no matter how honestly it was performed. The participant did exactly
 * what the task asked and the engine charged them for the task being short.
 *
 * This was a real regression and it was caught in production, not in review: four visits from one
 * location, two of them 77 s long on a 60 s task, scoring 67 and sent to review. Before D-032 the
 * same trace scored 88 and auto-verified.
 *
 * So the requirement scales with what the task's own expectation can physically produce, clamped
 * between `MIN_CORROBORATION_INTERVALS` and `MIN_DWELL_INTERVALS`. A 5 min task still needs five
 * observations, exactly as D-032 intended. A 1 min task needs two -- three fixes -- which is all a
 * minute at a 30 s cadence can yield, and still more than the single interval D-032 was written to
 * stop. Corroboration stays proportional to the claim instead of being absolute.
 */
export function requiredDwellIntervals(config: EngineConfig): number {
  const affordable = Math.floor(config.expectedDwellSeconds / config.expectedSampleIntervalSeconds);
  return Math.min(MIN_DWELL_INTERVALS, Math.max(MIN_CORROBORATION_INTERVALS, affordable));
}

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
   * time: saturation requires `requiredDwellIntervals(config)` separate inside-to-inside
   * observations. A fabricator has to keep the forgery running for as long as the task claims.
   *
   * That requirement is PROPORTIONAL, not flat, and the difference is D-053. D-032 hard-coded
   * five, which silently made every task shorter than 2.5 min unverifiable however honestly it
   * was performed -- see `requiredDwellIntervals` for the arithmetic and the production
   * regression that exposed it. A one-minute task now needs the two intervals a minute can
   * actually yield, which is still more than the single interval D-032 existed to stop.
   */
  /**
   * Inside readings that never span real time establish nothing, and this now BLOCKS (D-054).
   *
   * Once presence became the deciding signal, three fixes POSTed one second apart at the venue
   * centre scored 77 and auto-verified in five seconds: dwell was above zero, so this signal paid
   * -5 instead of -20 and nothing else objected. `dwellIntervals` only counts a gap of at least
   * 0.8x the sampling cadence on EITHER clock, and the honest client cannot send faster than one
   * fix per 30 s -- so an honest one-minute visit has at least one interval and a burst has none.
   */
  if (rollups.dwellIntervals === 0) {
    return {
      code: 'presenceDwell',
      contribution: -20,
      reason: 'The readings inside the venue arrived too close together to show any real time on site.',
    };
  }
  const ratio = Math.min(1, dwellSeconds / expected);
  const corroboration = Math.min(1, rollups.dwellIntervals / requiredDwellIntervals(config));
  const contribution = round(-5 + 23 * ratio * corroboration);
  const thin = corroboration < 1;
  return {
    code: 'presenceDwell',
    contribution,
    reason: thin
      ? `Spent about ${Math.round(dwellSeconds / 60)} min inside the venue geofence, but across only ${rollups.dwellIntervals} location update${rollups.dwellIntervals === 1 ? '' : 's'} — this task needs ${requiredDwellIntervals(config)} to corroborate continuous presence.`
      : `Spent about ${Math.round(dwellSeconds / 60)} min inside the venue geofence, against an expected ${Math.round(expected / 60)} min.`,
  };
};

/* ---------------------------------------------------------------- coverage */

/** D-005: gaps are normal on mobile web. This scores how much we saw, not whether it is "complete". */
export const coverage: SignalFn = (_e, rollups, config) => {
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
  const wellObserved = rollups.dwellIntervals >= requiredDwellIntervals(config);

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
      /**
       * +25, and this is the deciding number in the engine by design (D-054).
       *
       * It used to be +6 -- a rounding error next to `presenceDwell`'s +18 -- which meant the
       * question "was this person at the venue?" contributed less to the verdict than "how
       * continuously did we watch them?". A participant provably 7 m from the centre could not
       * reach the auto threshold without also producing enough updates to satisfy a corroboration
       * gate, so real visits from the right place kept landing in review and the business had to
       * hand-approve visits the server already had the coordinates for.
       *
       * Presence is now the primary evidence and the rest is confidence around it: dwell and
       * coverage still adjust the score, and every spoof detector can still veto a pass outright
       * (`jitterFingerprint` -45, `teleport` -30, `accuracyRealism` -20, `clockSkew` -20). A
       * confirmed position inside the fence passes unless something argues against it, which is
       * the rule the product actually wants and a far easier one to explain to a participant.
       */
      contribution: 25,
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
 * Accuracy at or under which a fix is treated as coming from a GNSS receiver rather than a
 * network scan, for the purpose of the drift test below.
 *
 * 50 m is generous on purpose. A phone indoors fusing GNSS with Wi-Fi reports 4-20 m, a clear
 * outdoor fix 3-8 m, and a laptop's Wi-Fi scan 100-500 m -- so the populations are separated by
 * an order of magnitude and the exact line between them is not load-bearing. It is set well
 * above real GPS rather than close to it, because the cost of the wrong answer is asymmetric:
 * a false -45 accuses an honest participant of spoofing.
 */
export const GPS_ACCURACY_M = 50;

/**
 * A real stationary device drifts by a few metres between fixes and its reported accuracy
 * varies. Repeated byte-identical coordinates are the signature of a fixed DevTools override,
 * which is the cheapest spoof available and therefore the most common one.
 *
 * See the geo-fixtures skill: honest fixtures must never contain two identical consecutive
 * coordinates, precisely so this signal stays meaningful.
 */
export const jitterFingerprint: SignalFn = (evidence) => {
  /**
   * GPS-QUALITY fixes only, and the scoping is what keeps this signal honest.
   *
   * The premise is in this comment block above: "a real stationary device drifts by a few metres
   * between fixes". That is true of a GNSS receiver and simply false of a cached Wi-Fi scan --
   * an unchanged scan returns the SAME fix every call, byte-identical, because it is literally
   * the same cached object. So the test only means anything for a fix claiming GPS-like
   * precision, and applying it to a coarse network fix reports "characteristic of an overridden
   * location" about a laptop doing nothing but sitting still. That is not a hypothetical: it is
   * what the measured laptop traces behind D-054 look like.
   *
   * Nothing is conceded to an attacker. A forgery has to claim a small `accuracyM` to be scored
   * `inside` a tight fence and to escape `proximity`'s distance bands, and the moment it does it
   * is back in this signal's population -- `staticSpoof` claims 12 m and is still caught at -45.
   * Claiming 200 m instead buys only `ACCURACY_CAP_M` of fence tolerance and forfeits nothing
   * this signal was protecting, because the position itself is now scored on its merits.
   */
  const usable = evidence.fixes.filter((f) => f.presence !== 'unknown');
  const gps = usable.filter((f) => f.accuracyM <= GPS_ACCURACY_M);

  const frozenRatio = (of: EvidenceFix[]): number => {
    let identical = 0;
    for (let i = 1; i < of.length; i++) {
      const a = of[i - 1] as EvidenceFix;
      const b = of[i] as EvidenceFix;
      if (a.lat === b.lat && a.lng === b.lng) identical++;
    }
    return identical / (of.length - 1);
  };

  /**
   * A coarse trace gets a narrower version of the same test rather than a free pass.
   *
   * Scoping the drift test to GPS-quality fixes stops it accusing a laptop, but on its own it
   * would hand an attacker the cheapest possible evasion: a DevTools override claiming 182 m of
   * accuracy is frozen AND exempt, and would auto-verify on the strength of `proximity` alone.
   *
   * So the coarse population is still tested, at only the extreme end and for a smaller penalty.
   * A cached Wi-Fi scan legitimately repeats a fix, but a scan that is being refreshed at all
   * varies -- the measured laptop traces move 5-7 m and 182-185 m between readings, which is
   * nowhere near this threshold. EVERY fix identical is a different claim, and combined with
   * `accuracyRealism`'s `distinct === 1` branch it is enough to keep such a trace out of the
   * auto band without asserting more than we can support.
   */
  if (gps.length < 3) {
    if (usable.length < 3) return null;
    if (frozenRatio(usable) >= 0.9) {
      return {
        code: 'jitterFingerprint',
        contribution: -20,
        reason: `Every one of ${usable.length} fixes reported the exact same coordinates. A device answering from a network scan can repeat a cached position, but not usually without any variation at all.`,
      };
    }
    // Drift is not evidence of anything for a network fix, so say nothing rather than pay a bonus.
    return null;
  }

  const fixes = gps;
  const identical = Math.round(frozenRatio(fixes) * (fixes.length - 1));
  const ratio = frozenRatio(fixes);

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
  /**
   * GPS-quality fixes only, for the same reason as `jitterFingerprint` (D-054). Both tests below --
   * one constant value, or a spread under 15% of the median -- describe what a GNSS receiver does
   * not do, and a Wi-Fi scan does exactly that: a laptop reporting 182, 183.5, 184.2, 185 m has a
   * spread of 1.6% of its median, and on a ten-fix visit that fired -15 and blocked an honest laptop
   * 6 m from the venue centre. Found by the adversary pass on D-054.
   */
  const values = fixes
    .filter((f) => f.presence !== 'unknown' && f.accuracyM <= GPS_ACCURACY_M)
    .map((f) => f.accuracyM);
  if (values.length < 3) return null;
  const distinct = new Set(values).size;

  if (distinct === 1) {
    return {
      code: 'accuracyRealism',
      contribution: -20,
      reason: `Every fix reported exactly ${values[0]} m accuracy. A real receiver's accuracy estimate varies between readings.`,
    };
  }

  // Median from THIS population, never `rollups.medianAccuracyM` (every usable fix). Drawing the
  // spread from one set and the median from another is the bug the second D-032 pass found.
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 ? ordered[mid]! : (ordered[mid - 1]! + ordered[mid]!) / 2;
  const indoor = evidence.venue.indoor;
  // The old `!indoor && median > 60` branch (-8) is gone: every value here is at most
  // GPS_ACCURACY_M, so it could never fire, and its only real target was the honest laptop.
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
  /**
   * GPS-quality fixes only. A cached cell-tower fix at the carrier's registered address, landing
   * between two good GPS fixes, is routine on mobile web -- 2 km away at 1,500 m accuracy, 30 s
   * after a real fix, reads as 240 km/h. It used to be filtered out for being `unknown`; D-054 made
   * coarse fixes positions again, so the filter now says what it always meant: a speed check needs
   * positions precise enough to measure a speed with.
   */
  const fixes = evidence.fixes.filter(
    (f) => f.presence !== 'unknown' && f.accuracyM <= GPS_ACCURACY_M,
  );
  if (fixes.length < 2) return null;

  let worst = 0;
  let sameStamp = 0;
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1] as EvidenceFix;
    const b = fixes[i] as EvidenceFix;
    /**
     * The wider of the two clock gaps, exactly as `dwellDetail` measures an interval.
     *
     * Ingest stamps `receivedAt` per fix, so an offline flush lands its fixes milliseconds apart:
     * two honest fixes 5 m and 3 ms apart read as 1,700 m/s, and once fraud signals began blocking
     * auto-verification that stopped every honest flush. The device clock carries the real
     * spacing. It is untrusted (rule 3), but stretching it to hide a jump opens a device/server
     * delta that `clockSkew` charges -- the same trade `dwellDetail` already makes.
     */
    const seconds = Math.max(b.receivedAt - a.receivedAt, b.capturedAt - a.capturedAt) / 1000;
    if (seconds <= 0) {
      // Both clocks say no time passed, yet the fixes are in different places. Skipping the pair
      // silently would disable this signal for exactly that trace. Count it.
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
      reason: `${sameStamp} pairs of fixes carried the same timestamp on both the device and the server despite being in different places, so the movement between them could not be checked.`,
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
