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

/**
 * The visit that was failing in production, reproduced.
 *
 * A participant standing inside an indoor venue for the full expected dwell, on a modern phone
 * that fuses GNSS with Wi-Fi and therefore reports ~7 m indoors, who started the session on
 * arrival and ended it before leaving -- exactly what the app's own instructions ask for.
 *
 * Before the D-032 fixes this scored 68 and went to manual review: -12 from `accuracyRealism`
 * for having good GPS indoors, and -6 from `approachDeparture` for following the onboarding.
 * It is the honest modal case and it must clear the auto threshold.
 */
export const honestIndoorGoodPhone = (): VisitEvidence =>
  buildTrace(INDOOR_VENUE, [
    // Starts inside: "Start the visit as you arrive."
    ...everyN(11, 30, (i) => ({ offsetM: 8 + (i % 4) * 3, accuracyM: 6 + (i % 4) * 1.5 }), 0),
  ]);

/**
 * The 68 -> 88 flip the spoof-adversary pass caught. A fabrication that changed NOTHING while
 * the rules changed twice underneath it: `accuracyRealism`'s indoor branch went -12 to +2, and
 * `approachDeparture` went -6 to 0.
 *
 * Tight, plausible accuracy is exactly what a hand-written shim emits -- nobody faking a fix
 * types `accuracy: 47`. This must not auto-verify.
 */
export const indoorTightAccuracyNoApproach = (): VisitEvidence =>
  buildTrace(
    INDOOR_VENUE,
    everyN(11, 30, (i) => ({
      offsetM: 17 + (i % 4) * 5,
      // 4.2-7.8 m, but clustered: spread/median is ~0.6 of what an honest receiver wanders.
      accuracyM: 5.6 + (i % 5) * 0.18,
    })),
    { sessionSeconds: 300 },
  );

/**
 * The floor a short task used to permit: three fixes, two minutes, auto-verified.
 *
 * With `expectedDwellSeconds: 60` this scored 88, because one capped 90 s interval saturated
 * `presenceDwell`. It is the cheapest fabrication the engine has ever allowed and it exists to
 * hold the corroboration floor in place.
 */
export const minimalShortTaskSpoof = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    [
      { atSeconds: 0, offsetM: 28, accuracyM: 9.4 },
      { atSeconds: 60, offsetM: 24, accuracyM: 12.1 },
      { atSeconds: 120, offsetM: 31, accuracyM: 8.7 },
    ],
    { sessionSeconds: 120 },
  );

/**
 * Inside the fence every time it was looked at, and looked at almost never.
 *
 * Eight fixes spread 400 s apart: dwell saturates and the corroboration floor is met, so every
 * other signal is happy. Only `coverage` objects, and it should -- 29% observation of a
 * forty-minute session is not a watched visit. This fixture exists because the spoof-adversary
 * pass showed the suite had NO case where coverage alone decided a verdict, which meant the
 * "no decorative signals" test could not tell whether coverage was doing anything at all.
 */
export const sparselyObservedButInside = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    everyN(8, 400, (i) => ({ offsetM: 18 + (i % 4) * 7, accuracyM: 8 + (i % 5) * 3 })),
    { sessionSeconds: 2900 },
  );

/**
 * Four pings, 90 s apart, and the attacker owns both session boundaries.
 *
 * 90 s is not incidental -- it is the optimum. It is the largest gap `dwellSeconds` still
 * credits in full (the cap is 3x the sampling period) AND that `coverageRatio` still counts as
 * observed. Four fixes also used to slip under the dispersion test's fix-count guard. Do not
 * "tidy" the spacing; it is the whole point of the fixture.
 */
export const fourPingLadder = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    [
      { atSeconds: 0, offsetM: 21, accuracyM: 9.3 },
      { atSeconds: 90, offsetM: 26, accuracyM: 11.6 },
      { atSeconds: 180, offsetM: 23, accuracyM: 8.4 },
      { atSeconds: 270, offsetM: 29, accuracyM: 10.9 },
    ],
    { sessionSeconds: 270 },
  );

/**
 * Six pings inside sixty seconds, against a task authored at the 60 s minimum.
 *
 * The counter-example to counting bare intervals: the honest client is throttled to one fix
 * per 30 s by `useVisitTracker`, so it CANNOT produce five intervals in a minute, while
 * anything POSTing to the ingest endpoint directly can. Corroboration measured in intervals
 * charged the honest participant time and the fabricator one extra request.
 */
export const fastCadenceShortTask = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    [
      { atSeconds: 0, offsetM: 18, accuracyM: 8.1 },
      { atSeconds: 12, offsetM: 24, accuracyM: 11.4 },
      { atSeconds: 24, offsetM: 20, accuracyM: 9.2 },
      { atSeconds: 36, offsetM: 27, accuracyM: 12.8 },
      { atSeconds: 48, offsetM: 22, accuracyM: 10.3 },
      { atSeconds: 60, offsetM: 25, accuracyM: 12.0 },
    ],
    { sessionSeconds: 60 },
  );

/**
 * The tight-cluster fabrication with ONE junk fix appended to launder the accuracy check.
 *
 * A single `accuracyM: 250` fix is `unknown` (over the 100 m cap) so it never reached the
 * median, but it used to reach the spread -- inflating it enough to disable both negative
 * branches for the price of one ping.
 */
export const accuracyLaunderedByOneUnusableFix = (): VisitEvidence =>
  buildTrace(
    INDOOR_VENUE,
    [
      ...everyN(11, 30, (i) => ({ offsetM: 17 + (i % 4) * 5, accuracyM: 5.6 + (i % 5) * 0.18 })),
      { atSeconds: 330, offsetM: 20, accuracyM: 250 },
    ],
    { sessionSeconds: 360 },
  );

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

/**
 * The laptop case, and it is a real trace rather than an invented one.
 *
 * A desktop browser has no GPS radio, so Chrome answers `getCurrentPosition` from a cached
 * Wi-Fi scan. Two things follow, and both were live false positives:
 *
 * - **Accuracy in the 100-500 m band.** The visits this fixture is taken from reported 182 m
 *   against a 120 m fence, from a machine that was 9 m from the venue centre. Every fix
 *   exceeded the 100 m cap, so presence was `unknown` throughout and the score was 15 --
 *   `rejected`, which the console renders as "Not supported by the evidence".
 * - **Byte-identical coordinates.** An unchanged cached scan returns the same fix every time,
 *   so `frozen: true` here is honest behaviour and not a spoof. With three or more fixes the
 *   old unfiltered `jitterFingerprint` fired -45 on top, taking an honest laptop visit to 0.
 *
 * Six fixes, because the bug needed three to show and a real session produces more. The
 * correct outcome is `needs_review`: nothing here places the participant anywhere, which is
 * not the same claim as their not having been there.
 */
export const honestLaptopWifiOnly = (): VisitEvidence =>
  buildTrace(
    INDOOR_VENUE,
    // Jittered and with varying accuracy, because that is what the MEASURED traces do: the real
    // laptop moved 5-7 m and 182-185 m between readings. It was `frozen: true` here until D-054
    // and that was wrong twice over -- it made the fixture model a DevTools override rather than
    // a laptop, and it was the reason this "honest" trace tripped a spoof signal.
    everyN(6, 30, (i) => ({ offsetM: 5 + (i % 3), accuracyM: 182 + (i % 2) * 3 })),
  );

/**
 * The attack D-051's floor created, and the reason D-052 exists.
 *
 * An attacker anywhere on earth reports accuracy just above the 100 m cap on every fix. Before
 * `coarseFixesExcludeVenue` this scored 35 with a single `noUsableEvidence` signal -- the same
 * score, the same verdict and the same reason string as `honestLaptopWifiOnly`, a participant
 * standing 9 m from the venue centre. The server held a `distanceM` of ~5,100 m on every ping
 * and the engine said "their device was not good enough".
 *
 * Accuracy is varied and the coordinates are jittered on purpose, so that no other signal can
 * be credited with catching this. The only thing that can is the exclusion geometry.
 */
export const coarseFixesFarFromVenue = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    everyN(8, 30, (i) => ({ offsetM: 5100, accuracyM: 176 + (i % 4) * 3 })),
  );

/**
 * The honest counterpart, and the pair is the point.
 *
 * Same coarse accuracy as `coarseFixesFarFromVenue`, but the fixes are where the venue is. The
 * exclusion margin is nowhere near met -- at a 120 m fence with a 50 m buffer and 182 m of
 * reported accuracy, nothing inside 716 m of the centre fires -- so this stays `needs_review`
 * while the far trace rejects. If a change ever collapses these two back onto the same score,
 * the engine has lost the distinction D-051 and D-052 were both written to protect.
 */
export const coarseFixesAtVenue = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    everyN(8, 30, (i) => ({ offsetM: 30 + (i % 3) * 2, accuracyM: 176 + (i % 4) * 3 })),
  );

/**
 * The laptop's cheap cousin: a fixed DevTools override that reports coarse accuracy.
 *
 * D-054 scoped `jitterFingerprint`'s drift test to GPS-quality fixes so it would stop accusing
 * laptops, and this fixture is the reason that scoping is not a free pass. Every coordinate is
 * byte-identical, which a refreshing Wi-Fi scan does not do, so the coarse population is still
 * tested at its extreme end. Must not auto-verify.
 */
export const frozenOverrideCoarseAccuracy = (): VisitEvidence =>
  buildTrace(
    INDOOR_VENUE,
    everyN(6, 30, () => ({ offsetM: 9, accuracyM: 182, frozen: true })),
  );

/**
 * Unreadable AND hand-crafted: coarse fixes, plus an hour of clock offset.
 *
 * This fixture exists to hold open the escape hatch in `evaluate`'s absence floor, and the
 * `no decorative signals` meta-test is what demanded it. Once absence alone stopped being able
 * to reject, `noUsableEvidence` could not make ANY verdict stricter in any existing scenario --
 * correctly reported as a decorative signal, because the one case that proves otherwise was
 * missing from the table.
 *
 * The distinction the engine has to draw is exactly here. Coarse fixes on their own are a
 * laptop (see `honestLaptopWifiOnly`) and must reach a human. Coarse fixes whose device clock
 * is an hour out are a replayed capture: the accuracy says nothing, but the skew is positive
 * evidence about how the trace was made, and that still rejects.
 */
export const unreadableAndReplayed = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    everyN(10, 30, (i) => ({
      offsetM: 40 + (i % 4) * 8,
      accuracyM: 400 + (i % 3) * 50,
      skewSeconds: 3600 + i,
    })),
  );

/**
 * Three fixes POSTed one second apart at the venue centre. Found by the adversary pass on D-054:
 * it scored 77 and auto-verified in five seconds. The honest client cannot send faster than one fix
 * per 30 s, so no gap here is long enough to count as time on site. Must not auto-verify.
 */
export const threeFixBurst = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    [
      { atSeconds: 0, offsetM: 20, accuracyM: 8 },
      { atSeconds: 1, offsetM: 22, accuracyM: 11 },
      { atSeconds: 2, offsetM: 19, accuracyM: 9 },
    ],
    { sessionSeconds: 5 },
  );

/**
 * An honest laptop on a full five-minute indoor visit. Ten Wi-Fi fixes whose accuracy moves only
 * between 182 and 185 m -- a spread of 1.6% of the median, which `accuracyRealism`'s tight-spread
 * test read as a generated trace and blocked. Must auto-verify.
 */
export const honestLaptopLongIndoor = (): VisitEvidence =>
  buildTrace(
    INDOOR_VENUE,
    everyN(10, 30, (i) => ({ offsetM: 5 + (i % 3), accuracyM: [182, 183.5, 184.2, 185][i % 4]! })),
  );

/**
 * An honest phone visit with one cell-tower fallback in the middle: 2 km off at 1,500 m accuracy,
 * 30 s after a real GPS fix. `teleport` read it as 240 km/h and blocked the visit once coarse fixes
 * stopped being discarded. Must auto-verify, and `teleport` must stay silent.
 */
export const phoneWithCellTowerBlip = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    everyN(10, 30, (i) =>
      i === 4
        ? { offsetM: 0, at: { lat: OUTDOOR_VENUE.lat + 0.018, lng: OUTDOOR_VENUE.lng }, accuracyM: 1500 }
        : { offsetM: 15 + (i % 3) * 4, accuracyM: 8 + (i % 4) * 2 },
    ),
  );

/**
 * A real offline flush as ingest actually stores it: the device captured fixes 30 s apart, and the
 * server stamped `receivedAt` per fix a few milliseconds apart when the queue drained.
 * `batchFlushedHonestVisit` gives a whole batch ONE identical timestamp, which is not what
 * `pings.service.ts` does, so it never exercised this. `teleport` must not read the flush as
 * movement at 1,700 m/s.
 */
export const realOfflineFlush = (): VisitEvidence =>
  buildTrace(
    OUTDOOR_VENUE,
    everyN(10, 30, (i) => ({
      offsetM: 15 + (i % 3) * 4,
      accuracyM: 8 + (i % 4) * 2,
      receivedAtSeconds: 300 + i * 0.004,
    })),
    { sessionSeconds: 300 },
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
  honestIndoorGoodPhone,
  indoorTightAccuracyNoApproach,
  minimalShortTaskSpoof,
  sparselyObservedButInside,
  fourPingLadder,
  fastCadenceShortTask,
  accuracyLaunderedByOneUnusableFix,
  honestWithGaps,
  staticSpoof,
  teleportIn,
  wrongVenue,
  allFixesUnusable,
  honestLaptopWifiOnly,
  coarseFixesFarFromVenue,
  coarseFixesAtVenue,
  frozenOverrideCoarseAccuracy,
  threeFixBurst,
  honestLaptopLongIndoor,
  phoneWithCellTowerBlip,
  realOfflineFlush,
  unreadableAndReplayed,
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
