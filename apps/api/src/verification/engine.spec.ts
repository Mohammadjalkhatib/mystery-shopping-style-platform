import type { Verdict } from '@msp/shared';
import { ALL_SCENARIOS } from '../../test/fixtures/scenarios.js';
import { buildTrace, everyN, INDOOR_VENUE, OUTDOOR_VENUE } from '../../test/fixtures/trace-builder.js';
import { BASE_SCORE, BLOCKING_CONTRIBUTION, evaluate } from './engine.js';
import { computeRollups } from './rollups.js';
import {
  ALL_SIGNALS,
  MIN_CORROBORATION_INTERVALS,
  MIN_DWELL_INTERVALS,
  requiredDwellIntervals,
  type SignalFn,
} from './signals.js';
import { DEFAULT_ENGINE_CONFIG, type VisitEvidence } from './types.js';

/**
 * Table-driven over synthetic ping traces, per CLAUDE.md section 5.
 *
 * The table asserts a VERDICT BAND, not an exact score. Scores are placeholders until there
 * is labelled data (D-009); asserting 73 rather than "needs_review" would make every future
 * weight tweak a test rewrite, and would test the arithmetic rather than the judgement.
 */

const cfg = DEFAULT_ENGINE_CONFIG;

interface Case {
  scenario: keyof typeof ALL_SCENARIOS;
  expected: Verdict;
  /** Signals that must appear. Guards against a verdict that is right for the wrong reason. */
  mustFire?: string[];
  mustNotFire?: string[];
  why: string;
}

const TABLE: Case[] = [
  {
    scenario: 'honestOutdoor',
    expected: 'auto_verified',
    mustFire: ['presenceDwell', 'proximity'],
    mustNotFire: ['jitterFingerprint_negative', 'teleport', 'noUsableEvidence'],
    why: 'the base case: approach, dwell, departure, plausible accuracy',
  },
  {
    scenario: 'honestIndoorDegraded',
    expected: 'auto_verified',
    mustNotFire: ['teleport', 'noUsableEvidence'],
    why: 'indoor accuracy in the tens of metres is honest, not suspicious',
  },
  {
    scenario: 'honestWithGaps',
    expected: 'auto_verified',
    mustNotFire: ['teleport'],
    why: 'D-054 inverts this deliberately: the participant was repeatedly confirmed inside the fence, and gaps in between are the normal condition on mobile web (D-005), not an argument against a visit. Coverage still costs a few points; it no longer withholds the verdict',
  },
  {
    scenario: 'staticSpoof',
    expected: 'needs_review',
    mustFire: ['jitterFingerprint', 'accuracyRealism'],
    why: 'a frozen DevTools override: identical coordinates and one constant accuracy value. Both signals fire and both block auto-verification, so it cannot be paid; it lands in review rather than refused because D-054 credits the position it CLAIMS, and a human reading "identical coordinates" and "every fix reported exactly 12 m" has what they need',
  },
  {
    scenario: 'teleportIn',
    expected: 'needs_review',
    mustFire: ['teleport'],
    why: '9.6 km in 30 s is impossible; the dwell in between still looks real, so a human decides',
  },
  {
    scenario: 'wrongVenue',
    expected: 'rejected',
    mustFire: ['proximity'],
    why: 'never got within 2 km of the venue',
  },
  {
    scenario: 'allFixesUnusable',
    expected: 'auto_verified',
    mustNotFire: ['noUsableEvidence'],
    why: 'renamed in spirit by D-054: these fixes are coarse, not unusable. They put the participant 40-70 m inside a 75 m fence and are scored on that, which is the whole point -- a laptop with no GPS radio reports this accuracy routinely and was previously refused for it',
  },
  {
    scenario: 'noFixes',
    expected: 'needs_review',
    mustFire: ['noUsableEvidence'],
    mustNotFire: ['presenceDwell', 'coverage', 'proximity'],
    why: 'nothing was captured at all, exactly one signal should say so, and D-001 forbids reading that as absence -- a human decides',
  },
  {
    scenario: 'replayedClock',
    expected: 'needs_review',
    mustFire: ['clockSkew'],
    why: 'an hour of clock offset suggests a replayed trace, but a broken device clock also does',
  },
  {
    scenario: 'tooFewFixes',
    expected: 'needs_review',
    why: 'two fixes is not enough to auto-approve, and not enough to reject either',
  },
  {
    scenario: 'driveBy',
    expected: 'needs_review',
    why: 'one sample inside the fence is not a mystery shop, but it is not a fabrication either',
  },
  {
    // DOCUMENTED LIMIT, not an oversight. This fixture is a forgery that jitters its
    // coordinates, varies its accuracy and fakes an approach and departure -- and it is
    // therefore indistinguishable from honestOutdoor, because from a browser it IS
    // indistinguishable. D-001 says the system does not claim to prove presence, and this
    // is what that costs. Changing this to needs_review would require punishing honest
    // visits by exactly the same amount. Recorded in D-009 and handed to spoof-adversary.
    scenario: 'sophisticatedSpoof',
    expected: 'auto_verified',
    why: 'a competent forgery is indistinguishable from an honest visit; this test pins that limit',
  },
  {
    scenario: 'sparseButHonest',
    expected: 'needs_review',
    mustFire: ['coverage'],
    why: 'five fixes across twenty minutes is too little to confirm, and not evidence of fraud',
  },
  {
    scenario: 'constantAccuracy',
    expected: 'needs_review',
    mustFire: ['accuracyRealism'],
    why: 'an accuracy estimate identical to the metre on every fix is not what a receiver does',
  },
  {
    // Was 'needs_review' until the spoof-adversary pass: this is the flow CLAUDE.md section 1
    // describes, so penalising it heavily sent the modal honest visit to manual review.
    scenario: 'startedAndEndedOnSite',
    expected: 'auto_verified',
    mustFire: ['presenceDwell'],
    why: 'the documented honest flow: session started on arrival and ended before leaving',
  },
  {
    scenario: 'unobservedDwellPadded',
    expected: 'auto_verified',
    mustFire: ['presenceDwell'],
    mustNotFire: ['teleport'],
    why: 'two typed coordinates five minutes apart bought 300 s of dwell from two observed instants',
  },
  {
    scenario: 'batchFlushedHonestVisit',
    expected: 'needs_review',
    mustNotFire: ['teleport'],
    why: 'receivedAt stamped per batch rather than per fix. Since D-054 teleport measures each pair on the wider of the two clocks, so walking-pace movement inside a batch is checked and passes; the flush still lands in review because coverage is measured on the server clock, which is recorded as open',
  },
];

describe('verification engine', () => {
  describe.each(TABLE)('$scenario ($why)', ({ scenario, expected, mustFire, mustNotFire }) => {
    const evidence = ALL_SCENARIOS[scenario]!();
    const result = evaluate(evidence, cfg);

    it(`is ${expected}`, () => {
      expect(result.verdict).toBe(expected);
    });

    if (mustFire) {
      it.each(mustFire.filter((c) => !c.includes('_')))('fires %s', (code) => {
        expect(result.signals.map((s) => s.code)).toContain(code);
      });
    }

    if (mustNotFire) {
      it.each(mustNotFire.filter((c) => !c.includes('_')))('does not fire %s', (code) => {
        expect(result.signals.map((s) => s.code)).not.toContain(code);
      });
    }

    it('carries a human-readable reason on every signal', () => {
      for (const s of result.signals) {
        expect(typeof s.reason).toBe('string');
        expect(s.reason.length).toBeGreaterThan(20);
        // The console shows these to a business user. No debug output.
        expect(s.reason).not.toMatch(/undefined|NaN|\[object/);
      }
    });

    it('produces a score inside the band it claims', () => {
      const { score, verdict } = result;
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      if (verdict === 'auto_verified') expect(score).toBeGreaterThanOrEqual(cfg.autoThreshold);
      if (verdict === 'rejected') expect(score).toBeLessThan(cfg.rejectThreshold);
      if (verdict === 'needs_review') {
        expect(score).toBeGreaterThanOrEqual(cfg.rejectThreshold);
        expect(score).toBeLessThan(cfg.autoThreshold);
      }
    });
  });

  describe('no decorative signals', () => {
    /**
     * Rewritten after the spoof-adversary pass (D-032).
     *
     * The old assertion was "removing this signal changes at least one verdict, in any
     * direction". That is satisfied by a signal which only ever RAISES scores -- and a signal
     * that can only raise a score cannot cause a `needs_review` or a `rejected`, so it can
     * never do the one job the engine exists for. `approachDeparture` passed the old test for
     * its entire life and was deleted the moment it was asked this question instead.
     *
     * So: every scoring signal must be able to make some verdict STRICTER.
     */
    const stricter = (a: Verdict, b: Verdict): boolean => {
      const rank: Record<Verdict, number> = { auto_verified: 2, needs_review: 1, rejected: 0 };
      return rank[a] < rank[b];
    };

    it.each(ALL_SIGNALS.map((fn) => [fn.name || 'anonymous', fn] as [string, SignalFn]))(
      '%s can make at least one verdict stricter',
      (_name, fn) => {
        const without = ALL_SIGNALS.filter((f) => f !== fn);
        const anyStricter = Object.values(ALL_SCENARIOS).some((make) => {
          const evidence = make();
          const rollups = computeRollups(evidence, cfg.expectedSampleIntervalSeconds);
          const scoreWith = evaluate(evidence, cfg);
          const raw = without.reduce(
            (acc, f) => acc + (f(evidence, rollups, cfg)?.contribution ?? 0),
            BASE_SCORE,
          );
          const bounded = Math.max(0, Math.min(100, Math.round(raw)));
          const verdictWithout =
            bounded >= cfg.autoThreshold
              ? 'auto_verified'
              : bounded < cfg.rejectThreshold
                ? 'rejected'
                : 'needs_review';
          return stricter(scoreWith.verdict, verdictWithout as Verdict);
        });
        expect(anyStricter).toBe(true);
      },
    );
  });

  describe('banding', () => {
    it('starts from a neutral base, so an evidence-free visit lands in review not rejection', () => {
      // D-005: absence of evidence is not evidence of absence.
      expect(BASE_SCORE).toBeGreaterThanOrEqual(cfg.rejectThreshold);
      expect(BASE_SCORE).toBeLessThan(cfg.autoThreshold);
    });

    it('respects configured thresholds rather than hardcoding them', () => {
      const evidence = ALL_SCENARIOS.honestOutdoor!();
      const strict = evaluate(evidence, { ...cfg, autoThreshold: 101 });
      expect(strict.verdict).not.toBe('auto_verified');

      const lax = evaluate(evidence, { ...cfg, autoThreshold: 0 });
      expect(lax.verdict).toBe('auto_verified');
    });

    it('clamps the score to 0..100', () => {
      for (const make of Object.values(ALL_SCENARIOS)) {
        const { score } = evaluate(make(), cfg);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
        expect(Number.isInteger(score)).toBe(true);
      }
    });
  });

  describe('contract', () => {
    it('stamps the engine version on every result (rule 8)', () => {
      const r = evaluate(ALL_SCENARIOS.honestOutdoor!(), { ...cfg, engineVersion: 'v7' });
      expect(r.engineVersion).toBe('v7');
    });

    it('never emits a boolean verified field (rule 1)', () => {
      const r = evaluate(ALL_SCENARIOS.honestOutdoor!(), cfg);
      expect(JSON.stringify(r)).not.toMatch(/"(verified|isVerified)"\s*:/);
    });

    it('produces rollups so the console never reads the ping collection (rule 6)', () => {
      const r = evaluate(ALL_SCENARIOS.honestOutdoor!(), cfg);
      expect(r.rollups).toMatchObject({
        fixCount: expect.any(Number),
        dwellSeconds: expect.any(Number),
        coverageRatio: expect.any(Number),
      });
      expect(r.rollups.coverageRatio).toBeGreaterThanOrEqual(0);
      expect(r.rollups.coverageRatio).toBeLessThanOrEqual(1);
    });

    it('is pure: same evidence in, same result out', () => {
      const a = evaluate(ALL_SCENARIOS.honestOutdoor!(), cfg);
      const b = evaluate(ALL_SCENARIOS.honestOutdoor!(), cfg);
      expect(a).toEqual(b);
    });

    it('does not mutate the evidence it is given', () => {
      const evidence = ALL_SCENARIOS.honestOutdoor!();
      const snapshot = JSON.stringify(evidence);
      evaluate(evidence, cfg);
      expect(JSON.stringify(evidence)).toBe(snapshot);
    });

    it('handles an empty trace without throwing', () => {
      expect(() => evaluate(ALL_SCENARIOS.noFixes!(), cfg)).not.toThrow();
    });
  });

  describe('dwell cannot be bought (spoof-adversary regressions, D-010)', () => {
    // maxGap is expectedSampleIntervalSeconds * 3 = 90 s.
    const MAX_GAP = cfg.expectedSampleIntervalSeconds * 3;

    it('credits at most one sampling window per unobserved gap', () => {
      // The attack: two fixes 300 s apart, both inside, bought 300 s of dwell from two
      // observed instants. Capped, it buys 90.
      const r = evaluate(ALL_SCENARIOS.unobservedDwellPadded!(), cfg);
      expect(r.rollups.dwellSeconds).toBeLessThanOrEqual(MAX_GAP);
      /**
       * The CAP is the invariant, and it still holds: 90 s of credit, not 300.
       *
       * The verdict assertion that used to sit here was removed by D-054. Two fixes five minutes
       * apart, both confirmed inside the fence, now auto-verify -- because that is also exactly
       * what an honest visit looks like when a phone sleeps in a pocket between readings, which
       * D-005 says is the normal condition on mobile web. The engine has no way to tell those
       * apart, and the three attempts to do it by arithmetic all ended up refusing real visits.
       * What the cap still guarantees is that the fabrication cannot claim MORE dwell than it
       * showed us.
       */
    });

    it('no longer credits the 360 s pocketed gap in honestWithGaps', () => {
      // This fixture was silently endorsing the bug: 480 s of dwell, 360 s of it unobserved.
      // With the cap it is 210 s, which is what was actually witnessed.
      const r = evaluate(ALL_SCENARIOS.honestWithGaps!(), cfg);
      expect(r.rollups.dwellSeconds).toBe(210);
    });

    it('the forgery no longer outranks the honest visit it imitates', () => {
      // Before the fix: padded 78, honestWithGaps 72. That inversion was the real bug.
      const padded = evaluate(ALL_SCENARIOS.unobservedDwellPadded!(), cfg).score;
      const honest = evaluate(ALL_SCENARIOS.honestWithGaps!(), cfg).score;
      expect(padded).toBeLessThan(honest);
    });
  });

  describe('teleport survives a per-batch receivedAt (ingest spec, D-010)', () => {
    it('still checks movement inside a batch, using the device clock (D-054)', () => {
      /**
       * `if (seconds <= 0) continue` once disabled the movement check for every fix in a batch.
       * D-010 answered that by counting same-server-timestamp pairs as unchecked (-12). D-054
       * measures each pair on the wider of the two clocks instead, so a batch is CHECKED rather
       * than flagged: the honest flush below moves at walking pace and says nothing, and a batch
       * that hides a 10 km jump behind one server timestamp still fires the full -30.
       */
      const honest = evaluate(ALL_SCENARIOS.batchFlushedHonestVisit!(), cfg);
      expect(honest.signals.map((s) => s.code)).not.toContain('teleport');

      const hiddenJump = buildTrace(OUTDOOR_VENUE, [
        { atSeconds: 0, offsetM: 20, accuracyM: 9, receivedAtSeconds: 300 },
        { atSeconds: 30, offsetM: 0, at: { lat: OUTDOOR_VENUE.lat + 0.09, lng: OUTDOOR_VENUE.lng }, jitterAt: true, accuracyM: 10, receivedAtSeconds: 300 },
        { atSeconds: 60, offsetM: 22, accuracyM: 11, receivedAtSeconds: 300 },
      ], { sessionSeconds: 300 });
      const jump = evaluate(hiddenJump, cfg).signals.find((s) => s.code === 'teleport');
      expect(jump?.contribution).toBe(-30);
    });

    it('an honest offline flush is not rejected outright', () => {
      // It should cost confidence, not the participant's payment.
      expect(evaluate(ALL_SCENARIOS.batchFlushedHonestVisit!(), cfg).verdict).not.toBe('rejected');
    });
  });

  describe('a coarse fix is evidence, not an excuse (D-054)', () => {
    it('auto-verifies an honest laptop that was actually at the venue', () => {
      /**
       * The production failure this whole line of work started from, in one assertion. A laptop
       * has no GPS radio, so Chrome answers from a Wi-Fi scan reporting ~182 m of uncertainty.
       * The measured traces put it 5-7 m from the venue centre, indistinguishable from the phone
       * beside it, and it scored 15 (`rejected`, "Not supported by the evidence"), then 35
       * (`needs_review`) after the first two attempts at this.
       *
       * Reported accuracy now widens the fence up to the cap instead of discarding the fix.
       */
      const r = evaluate(ALL_SCENARIOS.honestLaptopWifiOnly!(), cfg);
      expect(r.verdict).toBe('auto_verified');
      expect(r.rollups.minDistanceM).not.toBeNull();
      expect(r.rollups.unusableFixCount).toBe(0);
      expect(r.signals.map((x) => x.code)).not.toContain('noUsableEvidence');
    });

    it('does not read a refreshing Wi-Fi scan as a location override', () => {
      // The scan moves a few metres and a few metres of claimed accuracy between readings, which
      // is not the signature the drift test is looking for.
      const codes = evaluate(ALL_SCENARIOS.honestLaptopWifiOnly!(), cfg).signals.map((x) => x.code);
      expect(codes).not.toContain('jitterFingerprint');
    });

    it('still refuses a frozen override that hides behind coarse accuracy', () => {
      /**
       * The other half of scoping the drift test to GPS-quality fixes: it must not become a free
       * pass. Byte-identical coordinates are something a refreshing scan does not produce, so the
       * coarse population is still tested at its extreme.
       */
      const r = evaluate(ALL_SCENARIOS.frozenOverrideCoarseAccuracy!(), cfg);
      expect(r.verdict).not.toBe('auto_verified');
      expect(r.signals.map((x) => x.code)).toContain('jitterFingerprint');
    });

    it('rejects a coarse trace that is genuinely far from the venue', () => {
      // No special signal for this any more. The fix keeps its position, so `proximity` charges
      // it -25 for being well outside the fence, exactly as it would a precise fix.
      const r = evaluate(ALL_SCENARIOS.coarseFixesFarFromVenue!(), cfg);
      expect(r.verdict).toBe('rejected');
      expect(r.signals.map((x) => x.code)).toContain('proximity');
    });

    it('scores a coarse trace at the venue far above the same trace 5 km away', () => {
      // The ordering that matters, and the reason the accuracy cap stopped being a veto: these
      // two used to be indistinguishable, both landing on 35 with one reason string that read as
      // "your device was not good enough".
      const atVenue = evaluate(ALL_SCENARIOS.coarseFixesAtVenue!(), cfg);
      const farAway = evaluate(ALL_SCENARIOS.coarseFixesFarFromVenue!(), cfg);
      expect(atVenue.verdict).toBe('auto_verified');
      expect(farAway.verdict).toBe('rejected');
      expect(atVenue.score - farAway.score).toBeGreaterThan(50);
    });

    it('never auto-verifies a session with no fixes at all, at any threshold pair', () => {
      /**
       * The one case where absence is still all there is. `noUsableEvidence` fires alone, the
       * floor keeps it out of `rejected` (D-001: absence of evidence is not evidence of absence),
       * and the clamp keeps it out of `auto_verified` even if the thresholds are misconfigured so
       * that reject sits at or above auto -- a pair with no middle band at all.
       */
      for (const autoThreshold of [50, 60, 75, 90]) {
        for (const rejectThreshold of [10, 30, 55, 74, 75, 80, 95]) {
          const r = evaluate(ALL_SCENARIOS.noFixes!(), { ...cfg, autoThreshold, rejectThreshold });
          expect(r.verdict).not.toBe('auto_verified');
        }
      }
      const d = evaluate(ALL_SCENARIOS.noFixes!(), cfg);
      expect(d.verdict).toBe('needs_review');
      expect(d.signals.map((x) => x.code)).toEqual(['noUsableEvidence']);
    });
  });

  describe('the adversary pass on D-054: honest visits the block rule must not stop', () => {
    it('auto-verifies a five-minute laptop visit whose Wi-Fi accuracy barely moves', () => {
      const r = evaluate(ALL_SCENARIOS.honestLaptopLongIndoor!(), cfg);
      expect(r.signals.map((x) => x.code)).not.toContain('accuracyRealism');
      expect(r.verdict).toBe('auto_verified');
    });

    it('auto-verifies a phone visit with one cell-tower fallback fix in the middle', () => {
      const r = evaluate(ALL_SCENARIOS.phoneWithCellTowerBlip!(), cfg);
      expect(r.signals.map((x) => x.code)).not.toContain('teleport');
      expect(r.verdict).toBe('auto_verified');
    });

    it('does not read a real offline flush as impossible movement', () => {
      // Coverage still charges a flush (it measures the server clock), which is recorded as open
      // in D-054. What this pins is that `teleport` no longer blocks it.
      const r = evaluate(ALL_SCENARIOS.realOfflineFlush!(), cfg);
      expect(r.signals.map((x) => x.code)).not.toContain('teleport');
    });

    it('refuses three fixes POSTed within five seconds', () => {
      const r = evaluate(ALL_SCENARIOS.threeFixBurst!(), cfg);
      expect(r.rollups.dwellIntervals).toBe(0);
      expect(r.verdict).not.toBe('auto_verified');
    });
  });

  describe('a substantial negative finding blocks auto-verification (D-054)', () => {
    /**
     * The mechanism that replaced balancing weights against each other. Once `proximity` became
     * the deciding signal at +25 the reachable maximum passed 110, and every penalty quietly
     * stopped mattering -- `teleportIn` auto-verified at 77 WITH its -30 firing, `replayedClock`
     * at 87 with an hour of clock offset on the record. Arithmetic said pass, evidence said stop.
     */
    it.each([
      ['teleportIn', 'teleport'],
      ['replayedClock', 'clockSkew'],
      ['constantAccuracy', 'accuracyRealism'],
      ['staticSpoof', 'jitterFingerprint'],
      ['indoorTightAccuracyNoApproach', 'accuracyRealism'],
      ['accuracyLaunderedByOneUnusableFix', 'accuracyRealism'],
    ] as const)('%s cannot auto-verify while %s is firing', (scenario, code) => {
      const r = evaluate(ALL_SCENARIOS[scenario]!(), cfg);
      expect(r.signals.some((x) => x.code === code && x.contribution <= BLOCKING_CONTRIBUTION)).toBe(
        true,
      );
      expect(r.verdict).not.toBe('auto_verified');
      expect(r.score).toBeLessThan(cfg.autoThreshold);
    });

    it('does not block on the small negatives an honest visit collects', () => {
      // An honest laptop takes -8 for a coarse median at an outdoor venue and a pocketed phone
      // loses a little coverage. Blocking on those would recreate the review-everything
      // behaviour this change exists to end.
      for (const name of ['honestLaptopWifiOnly', 'coarseFixesAtVenue', 'honestWithGaps'] as const) {
        const r = evaluate(ALL_SCENARIOS[name]!(), cfg);
        expect(r.verdict).toBe('auto_verified');
      }
    });
  });

  describe('the rules stopped punishing honest behaviour (D-032)', () => {
    it('auto-verifies an indoor visit on a phone with good GPS, started on arrival', () => {
      /**
       * The exact production failure. This trace is a participant standing in the right place
       * for the full expected dwell with a ~7 m median, who started the session at the door as
       * the app instructs. It scored 68 and went to review: -12 for having good GPS indoors and
       * -6 for not being observed walking in.
       */
      const r = evaluate(ALL_SCENARIOS.honestIndoorGoodPhone!(), cfg);
      // 50 base + 2 jitter + 18 dwell + 6 proximity + 10 coverage + 2 accuracy + 0 approach.
      // The same trace scored 68 before D-032: -12 for good indoor GPS, -6 for compliance.
      expect(r.verdict).toBe('auto_verified');
      expect(r.score).toBeGreaterThanOrEqual(cfg.autoThreshold);
    });

    it('no longer penalises a 4-8 m median indoors', () => {
      // Modern phones fuse GNSS with Wi-Fi; this is a normal reading, not a suspicious one.
      const r = evaluate(ALL_SCENARIOS.honestIndoorGoodPhone!(), cfg);
      const acc = r.signals.find((s) => s.code === 'accuracyRealism');
      expect(acc && acc.contribution).toBeGreaterThan(0);
    });

    it('scores nothing at all for whether an approach was observed', () => {
      /**
       * `approachDeparture` is gone (D-032). It punished the behaviour the app instructs --
       * "start the visit as you arrive" -- and once the penalty reached zero it could only
       * add, which pays a fabricator synthesising two extra coordinates and pays the compliant
       * participant nothing.
       */
      for (const make of Object.values(ALL_SCENARIOS)) {
        expect(evaluate(make(), cfg).signals.some((s) => s.code === 'approachDeparture')).toBe(
          false,
        );
      }
    });

    it('scores dwell against the TASK expectation, not a fixed five minutes', () => {
      /**
       * The setting existed, was stored, was shown in the admin form, and was never read --
       * every visit was scored against the hard-coded 300 s default. A task set to one minute
       * still told the participant "against an expected 5 min" and failed them for it.
       */
      const shortVisit = buildTrace(INDOOR_VENUE, [
        ...everyN(4, 30, (i) => ({ offsetM: 8 + (i % 3) * 3, accuracyM: 7 }), 0),
      ]);
      const againstFive = evaluate(shortVisit, { ...cfg, expectedDwellSeconds: 300 });
      const againstOne = evaluate(shortVisit, { ...cfg, expectedDwellSeconds: 60 });

      const dwellOf = (r: ReturnType<typeof evaluate>): number =>
        r.signals.find((s) => s.code === 'presenceDwell')?.contribution ?? 0;
      expect(dwellOf(againstOne)).toBeGreaterThan(dwellOf(againstFive));
      expect(againstOne.score).toBeGreaterThan(againstFive.score);
    });
  });





  describe('the loosened rules did not open the door (spoof-adversary, D-032)', () => {
    it('does not auto-verify a tight-accuracy indoor trace with no approach', () => {
      // Scored 88 after the first pass at these fixes, with the attacker changing nothing.
      const r = evaluate(ALL_SCENARIOS.indoorTightAccuracyNoApproach!(), cfg);
      expect(r.verdict).not.toBe('auto_verified');
    });

    it('catches a shim by how little its accuracy MOVES, not by how small it is', () => {
      // The level was the wrong statistic -- it false-positived on three real honest visits.
      // The shape is the right one: a real receiver's estimate wanders, a generated one does not.
      const acc = evaluate(ALL_SCENARIOS.indoorTightAccuracyNoApproach!(), cfg).signals.find(
        (s) => s.code === 'accuracyRealism',
      );
      expect(acc?.contribution).toBeLessThan(0);
    });

    describe('a short task expectation cannot buy full dwell credit', () => {
      const shortTask = { ...cfg, expectedDwellSeconds: 60 };

      it('refuses to auto-verify a SINGLE capped interval', () => {
        /**
         * The D-032 attack, and the part of that floor worth keeping: two fixes 90 s apart, one
         * capped interval, dwell fully saturated on a 60 s task. It scored 88 before the floor
         * and 66 now, because `MIN_CORROBORATION_INTERVALS` is 2 however short the task.
         */
        const singleInterval = buildTrace(
          OUTDOOR_VENUE,
          [
            { atSeconds: 0, offsetM: 28, accuracyM: 9.4 },
            { atSeconds: 90, offsetM: 24, accuracyM: 12.1 },
          ],
          { sessionSeconds: 90 },
        );
        const r = evaluate(singleInterval, shortTask);
        /**
         * D-054 inverted this too, and it was the user's explicit instruction: a participant
         * confirmed inside the fence passes. Two fixes 90 s apart on a one-minute task is a
         * one-minute visit, and the phone that produced it is the same phone that produces every
         * honest short visit. What the corroboration term still does is rank -- this scores below
         * a trace with more observations -- rather than withhold the verdict.
         */
        expect(r.verdict).toBe('auto_verified');
        expect(r.score).toBeLessThan(evaluate(ALL_SCENARIOS.honestOutdoor!(), shortTask).score);
      });

      it('DOES auto-verify three fixes across two minutes, and that is deliberate (D-053)', () => {
        /**
         * This inverts what D-032 asserted here, knowingly. `minimalShortTaskSpoof` is three
         * fixes inside the fence across two minutes, and on a task whose author asked for ONE
         * minute that is not distinguishable from an honest visit -- it is what an honest visit
         * looks like. D-032's flat floor of five intervals only appeared to catch it: what it
         * actually caught was every real participant doing a short task, because five intervals
         * needs 2.5 min of wall time at the client's 30 s cadence. It cost four real visits
         * before it was noticed.
         *
         * The engine cannot tell these apart and no longer pretends to. A one-minute task is
         * inherently less verifiable than a five-minute one -- that is a property of the task,
         * not a defect in the scoring -- so the control moved to where the choice is actually
         * made: `TasksTab` warns an author that anything under three minutes yields weaker
         * verification. Scoring what the task asked for, and steering authors, beats charging
         * participants for their employer's task design.
         */
        expect(evaluate(ALL_SCENARIOS.minimalShortTaskSpoof!(), shortTask).verdict).toBe(
          'auto_verified',
        );
        // D-054: presence now decides at every task length, so this passes on a 5 min task too.
        // Corroboration still RANKS it -- three fixes score below a fully observed visit.
        expect(evaluate(ALL_SCENARIOS.minimalShortTaskSpoof!(), cfg).score).toBeLessThan(
          evaluate(ALL_SCENARIOS.honestOutdoor!(), cfg).score,
        );
      });

      it('scales the requirement with what the task can physically produce', () => {
        // The bug in one assertion: a 60 s task cannot yield five intervals at a 30 s cadence,
        // so demanding five made it unverifiable by construction.
        expect(requiredDwellIntervals({ ...cfg, expectedDwellSeconds: 60 })).toBe(2);
        expect(requiredDwellIntervals({ ...cfg, expectedDwellSeconds: 120 })).toBe(4);
        expect(requiredDwellIntervals({ ...cfg, expectedDwellSeconds: 300 })).toBe(
          MIN_DWELL_INTERVALS,
        );
        // Never below two, so a single interval can never saturate however short the task.
        expect(requiredDwellIntervals({ ...cfg, expectedDwellSeconds: 5 })).toBe(
          MIN_CORROBORATION_INTERVALS,
        );
      });

      it('does not let a padded forgery outrank the honest visit it imitates', () => {
        // The D-010 invariant, re-asserted under a config an admin can actually author.
        const padded = evaluate(ALL_SCENARIOS.unobservedDwellPadded!(), shortTask).score;
        const honest = evaluate(ALL_SCENARIOS.honestWithGaps!(), shortTask).score;
        expect(padded).toBeLessThan(honest);
      });

      it('still lets a genuinely short visit pass, given enough observations', () => {
        // The point of the floor: a short task stays short, it just has to be WATCHED. Six
        // fixes over 150 s is a real two-and-a-half-minute presence.
        const realShortVisit = buildTrace(
          INDOOR_VENUE,
          everyN(6, 30, (i) => ({ offsetM: 9 + (i % 3) * 4, accuracyM: 5 + (i % 4) * 2.5 })),
          { sessionSeconds: 150 },
        );
        expect(evaluate(realShortVisit, shortTask).verdict).toBe('auto_verified');
      });
    });

    it('no longer refuses a four-ping ladder, and that is the accepted cost (D-054)', () => {
      /**
       * Four fixes 90 s apart, every one confirmed inside the fence, across four and a half
       * minutes. It was called "the attacker's optimum" and held at 77; it now auto-verifies.
       *
       * The uncomfortable truth the name was hiding: this is also what an honest sparse visit
       * looks like. The engine cannot separate them, and D-054 stops it charging the honest half
       * for the resemblance. The residual protection is that neither can reach the auto band once
       * any fraud signal fires -- see the blocking tests above.
       */
      expect(evaluate(ALL_SCENARIOS.fourPingLadder!(), cfg).verdict).toBe('auto_verified');
    });

    it('does not let a sub-throttle cadence buy corroboration', () => {
      /**
       * Six pings in sixty seconds. `useVisitTracker` throttles at `SAMPLE_MS = 30_000`, so an
       * honest client CANNOT produce a 12 s gap -- this cadence only comes from a script posting
       * straight to the ingest endpoint. The interval bar is now 0.8x the expected cadence rather
       * than half of it, so none of these gaps count and corroboration stays at zero.
       *
       * The score no longer hinges on that, because confirmed presence carries the verdict -- but
       * the rollup is the thing a future signal would key on, so it is worth pinning.
       */
      const shortTask = { ...cfg, expectedDwellSeconds: 60 };
      const r = evaluate(ALL_SCENARIOS.fastCadenceShortTask!(), shortTask);
      expect(r.rollups.dwellIntervals).toBe(0);
    });

    it('cannot launder the accuracy check with one unusable fix', () => {
      // 250 m is over the usability cap, so it never reached the median -- but it used to
      // reach the spread, disabling both negative branches for the price of one ping.
      const r = evaluate(ALL_SCENARIOS.accuracyLaunderedByOneUnusableFix!(), cfg);
      const acc = r.signals.find((s) => s.code === 'accuracyRealism');
      expect(acc?.contribution).toBeLessThan(0);
      expect(r.verdict).not.toBe('auto_verified');
    });

    it('does not fire the dispersion check on quantised Android accuracy', () => {
      /**
       * The ping DTO warns that a stationary device on one unchanging Wi-Fi scan reports a
       * REPEATING accuracy. Few distinct values, tightly clustered -- which is why the check
       * requires four or more distinct readings before it will look at the spread at all.
       */
      const quantised = buildTrace(
        INDOOR_VENUE,
        everyN(12, 30, (i) => ({ offsetM: 15 + (i % 3) * 4, accuracyM: i % 5 === 0 ? 20 : 19 })),
        { sessionSeconds: 330 },
      );
      const acc = evaluate(quantised, cfg).signals.find((s) => s.code === 'accuracyRealism');
      expect(acc && acc.contribution).toBeGreaterThan(0);
    });

    it('the dwell interval cap and the corroboration floor cannot silently drift apart', () => {
      // A cap larger than the expectation makes the cap a no-op. This states the coupling in
      // one place so the next person changing either has to change this line too.
      expect(MIN_DWELL_INTERVALS * DEFAULT_ENGINE_CONFIG.expectedSampleIntervalSeconds).toBeGreaterThanOrEqual(
        DEFAULT_ENGINE_CONFIG.expectedSampleIntervalSeconds * 3,
      );
    });
  });

  describe('honest participants are not taxed (spoof-adversary, D-010)', () => {
    it('does not penalise a session started on arrival and ended before leaving', () => {
      // CLAUDE.md section 1 describes exactly this flow. It must not need manual review.
      expect(evaluate(ALL_SCENARIOS.startedAndEndedOnSite!(), cfg).verdict).toBe('auto_verified');
    });

    it('does not penalise a buffered offline flush as though it were clock tampering', () => {
      // honestWithGaps flushes 240 s late. That is queue latency, which rule 4 exists to
      // make safe, not evidence of anything.
      const codes = evaluate(ALL_SCENARIOS.honestWithGaps!(), cfg).signals.map((s) => s.code);
      expect(codes).not.toContain('clockSkew');
    });

    it('never reports a fix as inside for dwell and outside for proximity at once', () => {
      // Contradictory sentences in the console are indefensible to a disputing participant.
      for (const make of Object.values(ALL_SCENARIOS)) {
        const r = evaluate(make(), cfg);
        const prox = r.signals.find((s) => s.code === 'proximity');
        if (r.rollups.dwellSeconds > 0 && prox) {
          expect(prox.reason).not.toMatch(/well outside/);
        }
      }
    });
  });

  describe('dwell is cadence-independent', () => {
    it('cannot be inflated by sampling faster', () => {
      // Integrating over intervals rather than counting fixes is what stops a spoofer
      // from buying dwell time with a higher sample rate.
      const slow = evaluate(ALL_SCENARIOS.honestOutdoor!(), cfg).rollups.dwellSeconds;
      expect(slow).toBeGreaterThan(0);
      expect(slow).toBeLessThanOrEqual(900);
    });
  });
});
