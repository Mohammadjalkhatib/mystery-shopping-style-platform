import type { Presence } from '@msp/shared';

/**
 * The one and only distance implementation in this repo. Do not inline a second copy.
 * See the geo-fixtures skill.
 *
 * Haversine, never Euclidean on raw lat/lng: a degree of longitude is 111 km at the equator
 * and 97 km at Kuwait's latitude, so Euclidean is wrong everywhere and wrong by more the
 * further you get from the equator.
 */

export const EARTH_RADIUS_M = 6_371_000;

/**
 * Accuracy values above this are not evidence of presence OR of absence.
 * An indoor Wi-Fi fix reporting 400 m would otherwise let anyone within half a kilometre
 * appear inside the fence.
 */
export const ACCURACY_CAP_M = 100;

export interface LatLng {
  lat: number;
  lng: number;
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Geofence {
  radiusM: number;
  /** Extra ring outside the fence that counts as `near` rather than `outside`. */
  nearBufferM: number;
}

/**
 * Presence for a single fix, per the geo-fixtures skill.
 *
 * A fix counts as `inside` when `distanceM <= radiusM + min(accuracyM, ACCURACY_CAP_M)`.
 * Above the cap the fix tells us nothing either way and presence is `unknown` -- that is a
 * first-class outcome, not an error, and the verification engine scores it as missing
 * evidence rather than as absence.
 */
export function presenceFor(distanceM: number, accuracyM: number, fence: Geofence): Presence {
  if (!Number.isFinite(accuracyM) || accuracyM > ACCURACY_CAP_M) return 'unknown';

  const tolerance = Math.min(accuracyM, ACCURACY_CAP_M);
  if (distanceM <= fence.radiusM + tolerance) return 'inside';
  if (distanceM <= fence.radiusM + fence.nearBufferM + tolerance) return 'near';
  return 'outside';
}

/** Metres to degrees, used only for generating test traces. */
export function metresToDegrees(metres: number, atLat: number): { dLat: number; dLng: number } {
  return {
    dLat: metres / 111_320,
    dLng: metres / (111_320 * Math.cos(toRad(atLat))),
  };
}
