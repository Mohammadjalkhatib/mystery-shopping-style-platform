import type { Presence, Verdict } from '@msp/shared';

/**
 * The contract between the evaluator and the engine.
 *
 * This file is also the spec `feat/ping-ingest` has to satisfy: every field here is either
 * server-computed or explicitly labelled untrusted. Nothing in this shape may be supplied by
 * a client (CLAUDE.md rule 2).
 */

/** One location fix, after the server has done the maths on it. */
export interface EvidenceFix {
  /** Device clock. UNTRUSTED. Kept because the delta to receivedAt is a signal (rule 3). */
  capturedAt: number;
  /** Server clock, stamped on arrival. Trusted. */
  receivedAt: number;
  lat: number;
  lng: number;
  /** As reported by the browser. Untrusted but useful -- a spoof rarely models it well. */
  accuracyM: number;
  /** Server-computed haversine to the venue centre. Never client-supplied. */
  distanceM: number;
  /** Server-computed. Never a client "I am here" assertion. */
  presence: Presence;
}

export interface EvidenceVenue {
  lat: number;
  lng: number;
  radiusM: number;
  nearBufferM: number;
  /** Indoor venues legitimately produce worse accuracy; the engine must not punish that. */
  indoor: boolean;
}

export interface EvidenceSession {
  /** Server clock. */
  startedAt: number;
  /** Server clock. */
  endedAt: number;
}

export interface VisitEvidence {
  venue: EvidenceVenue;
  session: EvidenceSession;
  /** Ordered by receivedAt ascending. May be empty -- that is a normal condition (D-005). */
  fixes: EvidenceFix[];
}

/* ------------------------------------------------------------------ config */

export interface EngineConfig {
  /** Score at or above which a visit auto-verifies. VERIFY_AUTO_THRESHOLD. */
  autoThreshold: number;
  /** Score below which a visit is rejected. VERIFY_REJECT_THRESHOLD. */
  rejectThreshold: number;
  /** Stamped onto every result. Results are append-only (rule 8). */
  engineVersion: string;
  /** Minimum time inside the fence for a visit to look like a real shop, in seconds. */
  expectedDwellSeconds: number;
  /** Sampling cadence the client aims for, in seconds. Drives coverageRatio. */
  expectedSampleIntervalSeconds: number;
  /** Device/server clock delta beyond which we start discounting, in seconds. */
  clockSkewToleranceSeconds: number;
  /** Speed above which movement between two fixes is not physically plausible, m/s. */
  implausibleSpeedMps: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  autoThreshold: 75,
  rejectThreshold: 30,
  engineVersion: 'v1',
  expectedDwellSeconds: 300, // 5 min. Arbitrary placeholder -- see D-009.
  expectedSampleIntervalSeconds: 30,
  clockSkewToleranceSeconds: 120,
  implausibleSpeedMps: 60, // ~216 km/h. Above a car, below a plane.
};

/* ----------------------------------------------------------------- rollups */

/**
 * Denormalised numbers the business console reads instead of touching the ping collection
 * (CLAUDE.md rule 6). Written by the evaluator alongside the result.
 */
export interface VisitRollups {
  fixCount: number;
  /** Seconds with presence `inside`, integrated over the trace. */
  dwellSeconds: number;
  /** 0..1. Fraction of the session for which we have usable evidence. */
  coverageRatio: number;
  /** Closest the participant provably got. Null when no fix was usable. */
  minDistanceM: number | null;
  medianAccuracyM: number | null;
  /** Fixes whose accuracy exceeded the cap, so they proved nothing either way. */
  unusableFixCount: number;
}

export interface EngineOutput {
  score: number;
  verdict: Verdict;
  signals: import('@msp/shared').Signal[];
  engineVersion: string;
  rollups: VisitRollups;
}
