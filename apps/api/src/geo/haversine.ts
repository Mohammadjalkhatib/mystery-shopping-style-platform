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
 * Ceiling on how much a fix's reported accuracy may WIDEN the geofence.
 *
 * A fix reporting 400 m must not let anyone within half a kilometre appear inside, so the
 * tolerance it earns is capped here. What this is deliberately NOT any more is a veto: it used
 * to discard a fix entirely once its accuracy passed 100 m, which threw away the position as
 * well as the uncertainty. See `presenceFor`.
 *
 * 50 m, lowered from 100 by D-054 once coarse fixes stopped being discarded. At 100 m, a laptop
 * reporting 182 m of accuracy from a cafe 170 m away counted as inside a 75 m venue -- "sat in the
 * car park" is the fraud a mystery-shopping product exists to catch, and it needed no spoofing at
 * all. At 50 m the measured laptop (5-7 m from centre) still passes and the cafe does not. An
 * honest phone reports 3-25 m, so its tolerance is its own accuracy and nothing changes for it.
 */
export const ACCURACY_CAP_M = 50;

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
 * Reported accuracy WIDENS the fence, up to the cap. It never discards the fix.
 *
 * **That last sentence is the fix for the worst bug this engine has had.** The old rule returned
 * `unknown` as soon as `accuracyM > ACCURACY_CAP_M`, which throws away *where the fix says you
 * are* along with *how sure the browser claims to be*. Those are different facts and only the
 * second one is doubtful. A laptop has no GPS radio, so Chrome answers from a Wi-Fi scan and
 * reports 100-500 m of uncertainty as a matter of routine -- and the measured traces behind this
 * change put the laptop **5 to 7 metres from the venue centre**, indistinguishable from the phone
 * sitting next to it, and still scored every visit as "no usable evidence". The participant was
 * told their location could not be determined while the server held a 7 m distance for them.
 *
 * The cap still does its real job: a 400 m fix earns 50 m of tolerance, not 400 m, so nobody
 * half a kilometre away appears inside. And a coarse fix that is genuinely far away is now
 * scored on that distance -- `proximity` charges it -- instead of landing in the "unreadable"
 * bucket, which had become a safe harbour an attacker could reach from anywhere on earth.
 *
 * `unknown` survives only for a fix with no usable accuracy number at all.
 */
export function presenceFor(distanceM: number, accuracyM: number, fence: Geofence): Presence {
  if (!Number.isFinite(accuracyM) || accuracyM < 0) return 'unknown';

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
