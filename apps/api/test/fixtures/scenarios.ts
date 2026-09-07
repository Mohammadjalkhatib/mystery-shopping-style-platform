import type { VisitEvidence } from '../../src/verification/types.js';
import {
  buildTrace,
  everyN,
  INDOOR_VENUE,
  OUTDOOR_VENUE,
  SALMIYA,
  T0,
  type FixSpec,
} from './trace-builder.js';

/**
 * Named ping traces, one per scenario the engine has to get right.
 *
 * Honest traces jitter, vary their accuracy, contain gaps, and show an approach and a
 * departure. Spoof traces are built by removing exactly one of those properties, so a test
 * failure points at a specific signal rather than at "something changed".
 */

/** An unremarkable outdoor visit: approach, 12 min inside, departure. */
export const honestOutdoor = (): VisitEvidence =>
  buildTrace(OUTDOOR_VENUE, [
    { atSeconds: 0, offsetM: 260, accuracyM: 9 },
    { atSeconds: 30, offsetM: 150, accuracyM: 11 },
    { atSeconds: 60, offsetM: 90, accuracyM: 8 },
    ...everyN(24, 30, (i) => ({ offsetM: 20 + (i % 4) * 6, accuracyM: 7 + (i % 5) * 2 }), 90),
    { atSeconds: 840, offsetM: 130, accuracyM: 10 },
    { atSeconds: 870, offsetM: 280, accuracyM: 12 },
  ]);

/** Indoor mall visit. Accuracy legitimately degrades; the engine must not punish that. */
export const honestIndoorDegraded = (): VisitEvidence =>
  buildTrace(INDOOR_VENUE, [
    { atSeconds: 0, offsetM: 340, accuracyM: 14 },
    { atSeconds: 30, offsetM: 190, accuracyM: 22 },
    ...everyN(22, 30, (i) => ({ offsetM: 40 + (i % 5) * 9, accuracyM: 28 + (i % 6) * 7 }), 60),
    { atSeconds: 720, offsetM: 210, accuracyM: 25 },
    { atSeconds: 750, offsetM: 360, accuracyM: 18 },
  ]);

/** Honest, but the phone went in a pocket for six minutes. D-005: gaps are normal. */
export const honestWithGaps = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    [
      { atSeconds: 0, offsetM: 240, accuracyM: 10 },
      { atSeconds: 40, offsetM: 60, accuracyM: 9 },
      { atSeconds: 80, offsetM: 25, accuracyM: 8 },
      { atSeconds: 120, offsetM: 30, accuracyM: 12 },
      // pocketed here -- 360 s with nothing, flushed late so the skew is wide
      { atSeconds: 480, offsetM: 28, accuracyM: 14, skewSeconds: 240 },
      { atSeconds: 520, offsetM: 35, accuracyM: 11 },
      { atSeconds: 560, offsetM: 150, accuracyM: 13 },
      { atSeconds: 600, offsetM: 300, accuracyM: 15 },
    ],
    { sessionSeconds: 640 },
  );

/** The cheapest attack: a DevTools coordinate override left switched on. */
export const staticSpoof = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    everyN(26, 30, () => ({ offsetM: 15, accuracyM: 12, frozen: true })),
  );

/** Override toggled on at the venue and off again: no approach, no departure. */
export const teleportIn = (): VisitEvidence =>
  buildTrace(OUTDOOR_VENUE, [
    { atSeconds: 0, offsetM: 0, at: SALMIYA, accuracyM: 10 },
    // ~9.6 km in 30 s
    ...everyN(20, 30, (i) => ({ offsetM: 18 + (i % 3) * 5, accuracyM: 9 + (i % 4) * 3 }), 30),
    { atSeconds: 660, offsetM: 0, at: SALMIYA, accuracyM: 11 },
  ]);

/** Never got closer than 2 km. Honest-looking trace, wrong place. */
export const wrongVenue = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    everyN(20, 30, (i) => ({ offsetM: 2000 + (i % 5) * 12, accuracyM: 9 + (i % 3) * 3 })),
  );

/** Tab was never granted permission, or every fix was a coarse Wi-Fi fix. */
export const allFixesUnusable = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    everyN(14, 30, (i) => ({ offsetM: 40 + (i % 4) * 8, accuracyM: 400 + (i % 3) * 50 })),
  );

/** Session ran, nothing was ever captured. */
export const noFixes = (): VisitEvidence => ({
  venue: OUTDOOR_VENUE,
  session: { startedAt: T0, endedAt: T0 + 600_000 },
  fixes: [],
});

/** Hand-crafted trace replayed from an old capture: device clock badly behind. */
export const replayedClock = (): VisitEvidence =>
  buildTrace(OUTDOOR_VENUE, [
    { atSeconds: 0, offsetM: 250, accuracyM: 11, skewSeconds: 3600 },
    ...everyN(18, 30, (i) => ({
      offsetM: 20 + (i % 4) * 7,
      accuracyM: 8 + (i % 5) * 3,
      skewSeconds: 3600 + i,
    }), 30),
    { atSeconds: 600, offsetM: 280, accuracyM: 12, skewSeconds: 3660 },
  ]);

/** Two fixes only. Almost nothing to reason about; must not auto-verify. */
export const tooFewFixes = (): VisitEvidence =>
  buildTrace(OUTDOOR_VENUE, [
    { atSeconds: 0, offsetM: 22, accuracyM: 9 },
    { atSeconds: 600, offsetM: 26, accuracyM: 11 },
  ]);

/** Drove past without stopping: inside the fence for one sample, then gone. */
export const driveBy = (): VisitEvidence =>
  buildTrace(OUTDOOR_VENUE, [
    { atSeconds: 0, offsetM: 700, accuracyM: 12 },
    { atSeconds: 20, offsetM: 300, accuracyM: 10 },
    { atSeconds: 40, offsetM: 40, accuracyM: 9 },
    { atSeconds: 60, offsetM: 320, accuracyM: 11 },
    { atSeconds: 80, offsetM: 760, accuracyM: 13 },
    { atSeconds: 100, offsetM: 1200, accuracyM: 14 },
  ]);

/**
 * The interesting adversarial case: a spoofer who read this file. Jittered coordinates,
 * varying accuracy, a fake approach and departure. Should NOT auto-verify on the strength
 * of a well-formed trace alone.
 */
export const sophisticatedSpoof = (): VisitEvidence =>
  buildTrace(OUTDOOR_VENUE, [
    { atSeconds: 0, offsetM: 250, accuracyM: 11 },
    { atSeconds: 30, offsetM: 120, accuracyM: 9 },
    ...everyN(22, 30, (i) => ({ offsetM: 18 + (i % 5) * 7, accuracyM: 8 + (i % 6) * 3 }), 60),
    { atSeconds: 780, offsetM: 140, accuracyM: 12 },
    { atSeconds: 810, offsetM: 290, accuracyM: 10 },
  ]);


/**
 * Honest, but sampled far too rarely to confirm much: five fixes across twenty minutes.
 * Exists so `coverage` is decisive somewhere -- without it this auto-verifies.
 */
export const sparseButHonest = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    [
      { atSeconds: 0, offsetM: 260, accuracyM: 10 },
      { atSeconds: 300, offsetM: 30, accuracyM: 12 },
      { atSeconds: 600, offsetM: 24, accuracyM: 9 },
      { atSeconds: 900, offsetM: 33, accuracyM: 14 },
      { atSeconds: 1200, offsetM: 290, accuracyM: 11 },
    ],
    { sessionSeconds: 1230 },
  );

/**
 * Looks entirely normal except that every fix reports the same accuracy to the metre.
 * A real receiver's accuracy estimate moves between readings. Isolates `accuracyRealism`.
 */
export const constantAccuracy = (): VisitEvidence =>
  buildTrace(OUTDOOR_VENUE, [
    { atSeconds: 0, offsetM: 240, accuracyM: 12 },
    ...everyN(20, 30, (i) => ({ offsetM: 20 + (i % 4) * 6, accuracyM: 12 }), 30),
    { atSeconds: 660, offsetM: 270, accuracyM: 12 },
  ]);

/**
 * Session started after arriving and ended before leaving: no approach, no departure.
 *
 * Originally written as a spoof fixture. The spoof-adversary pass pointed out this is the
 * flow CLAUDE.md section 1 literally describes -- "starts a visit session, keeps the tab
 * open while on site, ends the session" -- so it is the MODAL HONEST VISIT, not an attack.
 * Renamed and re-expected accordingly. See D-010.
 */
export const startedAndEndedOnSite = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    everyN(22, 30, (i) => ({ offsetM: 18 + (i % 5) * 6, accuracyM: 8 + (i % 6) * 3 })),
  );


/** Home address ~5.1 km from KUWAIT_CITY_CENTRE, where the attacker actually is. */
export const HOME_5KM = { lat: 29.34, lng: 47.945 };

/**
 * REGRESSION FIXTURE, from the spoof-adversary pass. The cheapest attack that beat the
 * engine, and it needed no script at all: type two venue coordinates into DevTools five
 * minutes apart, switch the override off, and let the real phone supply the rest.
 *
 * dwellSeconds used to credit the whole unobserved 300 s because both endpoints read
 * inside, and coverageRatio is a whole-session average so the honest trailing fixes
 * repaired it. It scored 78 and auto-verified - outranking honestWithGaps at 72.
 *
 * The 120 s gap to home keeps implied speed at ~42 m/s, under the 60 m/s teleport bar.
 * That is the attacker choosing their evasion, so the test asserts teleport does NOT fire:
 * the dwell cap has to be what stops this, not luck.
 */
export const unobservedDwellPadded = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    [
      { atSeconds: 0, offsetM: 25, accuracyM: 12 },
      { atSeconds: 300, offsetM: 29, accuracyM: 9 },
      { atSeconds: 420, offsetM: 0, at: HOME_5KM, jitterAt: true, accuracyM: 14 },
      ...everyN(10, 30, (i) => ({
        offsetM: 0,
        at: HOME_5KM,
        jitterAt: true,
        accuracyM: 10 + (i % 4) * 2,
      }), 450),
    ],
    { sessionSeconds: 750 },
  );

/**
 * An honest 12 min visit whose offline queue flushed in two batches, with receivedAt
 * stamped PER BATCH instead of per fix.
 *
 * This is the ingest specification expressed as a test. If feat/ping-ingest stamps
 * receivedAt once per batch, 22 of 23 intervals become zero-length: coverage collapses,
 * dwell zeroes, and teleport is skipped entirely for every pair in the batch. It punishes
 * the honest participant and hands the attacker a free pass through the same bug.
 */
export const batchFlushedHonestVisit = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    [
      { atSeconds: 0, offsetM: 260, accuracyM: 11, receivedAtSeconds: 360 },
      { atSeconds: 30, offsetM: 140, accuracyM: 9, receivedAtSeconds: 360 },
      ...everyN(10, 30, (i) => ({
        offsetM: 18 + (i % 4) * 6,
        accuracyM: 8 + (i % 5) * 3,
        receivedAtSeconds: 360,
      }), 60),
      ...everyN(10, 30, (i) => ({
        offsetM: 20 + (i % 4) * 5,
        accuracyM: 9 + (i % 6) * 2,
        receivedAtSeconds: 720,
      }), 360),
      { atSeconds: 660, offsetM: 150, accuracyM: 13, receivedAtSeconds: 720 },
      { atSeconds: 690, offsetM: 285, accuracyM: 12, receivedAtSeconds: 720 },
    ],
    { sessionSeconds: 750 },
  );

export const ALL_SCENARIOS: Record<string, () => VisitEvidence> = {
  honestOutdoor,
  honestIndoorDegraded,
  honestWithGaps,
  staticSpoof,
  teleportIn,
  wrongVenue,
  allFixesUnusable,
  noFixes,
  replayedClock,
  tooFewFixes,
  driveBy,
  sophisticatedSpoof,
  sparseButHonest,
  constantAccuracy,
  startedAndEndedOnSite,
  unobservedDwellPadded,
  batchFlushedHonestVisit,
};

export type { FixSpec };
