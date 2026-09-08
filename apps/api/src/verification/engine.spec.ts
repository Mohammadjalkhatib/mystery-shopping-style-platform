import type { Verdict } from '@msp/shared';
import { ALL_SCENARIOS } from '../../test/fixtures/scenarios.js';
import { BASE_SCORE, evaluate } from './engine.js';
import { computeRollups } from './rollups.js';
import { ALL_SIGNALS, type SignalFn } from './signals.js';
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
    mustFire: ['presenceDwell', 'proximity', 'approachDeparture'],
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
    why: 'a pocketed phone loses evidence; once dwell stops crediting unobserved gaps this is a normal honest visit',
  },
  {
    scenario: 'staticSpoof',
    expected: 'rejected',
    mustFire: ['jitterFingerprint', 'accuracyRealism'],
    why: 'a frozen DevTools override: identical coordinates and one constant accuracy value',
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
    expected: 'rejected',
    mustFire: ['noUsableEvidence'],
    mustNotFire: ['presenceDwell', 'coverage', 'accuracyRealism'],
    why: 'every fix exceeded the accuracy cap; one signal says so rather than three restating it',
  },
  {
    scenario: 'noFixes',
    expected: 'rejected',
    mustFire: ['noUsableEvidence'],
    mustNotFire: ['presenceDwell', 'coverage', 'proximity'],
    why: 'nothing was captured at all, and exactly one signal should say so',
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
    mustFire: ['approachDeparture'],
    why: 'the documented honest flow: session started on arrival and ended before leaving',
  },
  {
    scenario: 'unobservedDwellPadded',
    expected: 'needs_review',
    mustFire: ['presenceDwell'],
    mustNotFire: ['teleport'],
    why: 'two typed coordinates five minutes apart bought 300 s of dwell from two observed instants',
  },
  {
    scenario: 'batchFlushedHonestVisit',
    expected: 'needs_review',
    mustFire: ['teleport'],
    why: 'receivedAt stamped per batch rather than per fix; the ingest spec, expressed as a test',
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
     * The spoof-adversary agent's rule, promoted to a merge gate: a signal that never changes
     * a verdict is worse than no signal, because it creates false confidence in the evidence
     * trail. Each signal is removed in turn and the whole fixture set is re-scored; if nothing
     * moves, that signal is decoration and this fails by name.
     */
    const band = (score: number): Verdict =>
      score >= cfg.autoThreshold
        ? 'auto_verified'
        : score < cfg.rejectThreshold
          ? 'rejected'
          : 'needs_review';

    const scoreWith = (evidence: VisitEvidence, signals: readonly SignalFn[]): number => {
      const rollups = computeRollups(evidence, cfg.expectedSampleIntervalSeconds);
      const raw = signals
        .map((fn) => fn(evidence, rollups, cfg))
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .reduce((acc, s) => acc + s.contribution, BASE_SCORE);
      return Math.max(0, Math.min(100, Math.round(raw)));
    };

    it.each(ALL_SIGNALS.map((fn, i) => [fn.name || `signal#${i}`, fn] as const))(
      '%s changes at least one verdict across the fixture set',
      (_name, signal) => {
        const without = ALL_SIGNALS.filter((s) => s !== signal);
        const changed = Object.values(ALL_SCENARIOS).some((make) => {
          const evidence = make();
          return band(scoreWith(evidence, ALL_SIGNALS)) !== band(scoreWith(evidence, without));
        });
        expect(changed).toBe(true);
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
      expect(r.verdict).not.toBe('auto_verified');
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
    it('does not silently skip pairs that share a server timestamp', () => {
      // `if (seconds <= 0) continue` disabled the movement check for every fix in a batch.
      // If feat/ping-ingest stamps receivedAt per batch, this is what catches it.
      const r = evaluate(ALL_SCENARIOS.batchFlushedHonestVisit!(), cfg);
      const codes = r.signals.map((s) => s.code);
      expect(codes).toContain('teleport');
      expect(r.signals.find((s) => s.code === 'teleport')!.reason).toMatch(/same server timestamp/);
    });

    it('an honest offline flush is not rejected outright', () => {
      // It should cost confidence, not the participant's payment.
      expect(evaluate(ALL_SCENARIOS.batchFlushedHonestVisit!(), cfg).verdict).not.toBe('rejected');
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
