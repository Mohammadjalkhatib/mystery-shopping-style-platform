import { haversineM, metresToDegrees, presenceFor } from '../../src/geo/haversine.js';
import type { EvidenceFix, VisitEvidence } from '../../src/verification/types.js';

/**
 * Fixture builder for verification engine tests.
 *
 * Reference coordinates are real Kuwait locations (geo-fixtures skill), so distances can be
 * checked against a map and the test data looks like the product rather than a tutorial.
 */

export const KUWAIT_CITY_CENTRE = { lat: 29.3759, lng: 47.9774 }; // outdoor reference
export const AVENUES_MALL = { lat: 29.3028, lng: 47.9383 }; // indoor reference
export const SALMIYA = { lat: 29.3339, lng: 48.0758 }; // ~9.6 km away, for teleports

export const OUTDOOR_VENUE = {
  ...KUWAIT_CITY_CENTRE,
  radiusM: 75,
  nearBufferM: 50,
  indoor: false,
};

export const INDOOR_VENUE = {
  ...AVENUES_MALL,
  radiusM: 120,
  nearBufferM: 80,
  indoor: true,
};

export const T0 = 1_757_000_000_000; // fixed epoch so every fixture is deterministic

/**
 * Deterministic pseudo-random in [-1, 1]. Seeded rather than Math.random so a failing test
 * fails the same way twice.
 */
function seeded(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

export interface FixSpec {
  /** Seconds since session start. */
  atSeconds: number;
  /** Metres from the venue centre, before jitter. */
  offsetM: number;
  accuracyM: number;
  /** Device-clock offset in seconds. Positive means the device clock runs behind. */
  skewSeconds?: number;
  /** Suppress jitter to simulate a spoof. */
  frozen?: boolean;
  /** Place this fix at an explicit coordinate instead (used for teleports). */
  at?: { lat: number; lng: number };
  /** Jitter an explicit `at` too, so a spoof that moves elsewhere still looks like real GPS. */
  jitterAt?: boolean;
  /** Server stamp, when it must differ from atSeconds (simulates a per-BATCH receivedAt). */
  receivedAtSeconds?: number;
}

export function buildTrace(
  venue: typeof OUTDOOR_VENUE,
  specs: FixSpec[],
  opts: { sessionSeconds?: number } = {},
): VisitEvidence {
  const fixes: EvidenceFix[] = specs.map((spec, i) => {
    let lat: number;
    let lng: number;

    if (spec.at) {
      ({ lat, lng } = spec.at);
      if (spec.jitterAt) {
        const j = metresToDegrees(seeded(i + 7) * 4, spec.at.lat);
        lat += j.dLat;
        lng += j.dLng * 0.5;
      }
    } else {
      // Push the fix `offsetM` north of centre, then jitter it a few metres unless frozen.
      const { dLat, dLng } = metresToDegrees(spec.offsetM, venue.lat);
      const jitterM = spec.frozen ? 0 : seeded(i + 1) * 3;
      const j = metresToDegrees(jitterM, venue.lat);
      lat = venue.lat + dLat + j.dLat;
      lng = venue.lng + (spec.frozen ? 0 : j.dLng * 0.5);
      void dLng;
    }

    const receivedAt = T0 + (spec.receivedAtSeconds ?? spec.atSeconds) * 1000;
    const distanceM = haversineM({ lat, lng }, { lat: venue.lat, lng: venue.lng });

    return {
      capturedAt:
        spec.receivedAtSeconds !== undefined
          ? T0 + spec.atSeconds * 1000
          : receivedAt - (spec.skewSeconds ?? 0) * 1000,
      receivedAt,
      lat,
      lng,
      accuracyM: spec.accuracyM,
      distanceM,
      presence: presenceFor(distanceM, spec.accuracyM, venue),
    };
  });

  const last = specs[specs.length - 1];
  return {
    venue,
    session: {
      startedAt: T0,
      endedAt: T0 + (opts.sessionSeconds ?? (last ? last.atSeconds + 30 : 0)) * 1000,
    },
    fixes,
  };
}

/** Evenly spaced specs, the common case. */
export function everyN(
  count: number,
  intervalSeconds: number,
  fn: (i: number) => Omit<FixSpec, 'atSeconds'>,
  startSeconds = 0,
): FixSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    atSeconds: startSeconds + i * intervalSeconds,
    ...fn(i),
  }));
}
