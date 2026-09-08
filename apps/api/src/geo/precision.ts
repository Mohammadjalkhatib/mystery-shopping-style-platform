/**
 * How precise a coordinate actually is, as written.
 *
 * This exists because of a real failure, not a hypothetical one. A venue was created at
 * `31.98, 35.83` with a 25 m geofence. Two decimal places pin a location to within about
 * 557 m, so that fence could not be satisfied from anywhere -- the participant stood in the
 * right shop, 4.8 km from the point the system had been told to measure against, and the
 * engine correctly rejected the visit. Nothing in the stack was wrong except the number, and
 * nothing in the stack objected to it.
 *
 * A geofence is only ever as good as the centre it is measured from. Accepting a coordinate
 * coarser than the radius it defines is accepting a fence that cannot be entered.
 */

const M_PER_DEGREE_LAT = 111_320;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Decimal places actually carried by a number, ignoring binary floating point noise.
 *
 * The noise is not theoretical: a venue seeded at 35.9137 reads back as
 * 35.913700000000006, and counting the digits in that string would claim fifteen decimal
 * places of precision for a four decimal place value. Rounding back and comparing within a
 * tolerance is what makes this honest.
 */
export function decimalPlaces(n: number): number {
  if (!Number.isFinite(n)) return 0;
  for (let d = 0; d < MAX_MEANINGFUL_DECIMALS; d++) {
    const factor = 10 ** d;
    if (Math.abs(Math.round(n * factor) / factor - n) < 1e-9) return d;
  }
  return MAX_MEANINGFUL_DECIMALS;
}

/** Beyond this, decimal places describe sub-millimetre distances and stop meaning anything. */
const MAX_MEANINGFUL_DECIMALS = 8;

/**
 * The worst-case distance error implied by how the coordinate was written, in metres.
 *
 * A value rounded to `d` decimals sits anywhere within half a unit of the last place. The
 * latitude and longitude halves are computed separately and the worse one wins, because they
 * can be written to different precisions -- and a degree of longitude shrinks with the cosine
 * of the latitude, which is the same reason distance is haversine and not Euclidean.
 */
export function impliedPrecisionM(lat: number, lng: number): number {
  const latErrorM = 0.5 * 10 ** -decimalPlaces(lat) * M_PER_DEGREE_LAT;
  const lngErrorM =
    0.5 * 10 ** -decimalPlaces(lng) * M_PER_DEGREE_LAT * Math.cos(toRad(lat));
  return Math.max(latErrorM, lngErrorM);
}

/**
 * How precise a coordinate must be to define a fence of this radius.
 *
 * Half the radius. The centre should be materially more certain than the boundary it
 * describes, and half is a judgement call rather than a derived constant -- it is the
 * loosest ratio at which the centre's own error cannot dominate the geofence. What would
 * make it principled is data on how far real venue coordinates sit from where participants
 * actually stand, which is exactly the labelled data this project does not have yet.
 *
 * In practice it means three decimals for a wide fence and four for a tight one:
 *
 * | decimals | implied error | smallest usable radius |
 * |---|---|---|
 * | 2 | ~557 m | none -- the maximum radius is 500 m |
 * | 3 | ~56 m  | 112 m |
 * | 4 | ~5.6 m | 12 m, so any radius the schema allows |
 */
export function requiredPrecisionM(radiusM: number): number {
  return radiusM / 2;
}

export interface PrecisionVerdict {
  ok: boolean;
  impliedM: number;
  requiredM: number;
  decimals: number;
}

export function checkCoordinatePrecision(
  lat: number,
  lng: number,
  radiusM: number,
): PrecisionVerdict {
  const impliedM = impliedPrecisionM(lat, lng);
  const requiredM = requiredPrecisionM(radiusM);
  return {
    ok: impliedM <= requiredM,
    impliedM,
    requiredM,
    decimals: Math.min(decimalPlaces(lat), decimalPlaces(lng)),
  };
}
