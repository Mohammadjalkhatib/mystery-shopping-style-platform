/**
 * Web Mercator tile maths, the small part of a map library that this actually needs.
 *
 * Pure, and separated for the same reason the verification engine is: it is the only part of
 * the picker where a mistake is silent. A wrong pan or a wrong zoom is visible immediately; a
 * wrong projection puts the pin a few hundred metres from where the user clicked, which looks
 * fine and produces exactly the class of bug D-020 exists to prevent.
 *
 * Latitude is clamped to ±85.0511°, the point where Mercator's tan() runs to infinity. Not a
 * stylistic limit — beyond it the projection has no finite answer.
 */

export const TILE_SIZE = 256;
export const MAX_LAT = 85.05112878;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 19;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export const clampLat = (lat: number): number => clamp(lat, -MAX_LAT, MAX_LAT);
export const clampZoom = (z: number): number => clamp(Math.round(z), MIN_ZOOM, MAX_ZOOM);

/** Longitude to fractional tile x. */
export function lngToTileX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * 2 ** zoom;
}

/** Latitude to fractional tile y, through the Mercator projection. */
export function latToTileY(lat: number, zoom: number): number {
  const rad = (clampLat(lat) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom;
}

export function tileXToLng(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

export function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - 2 * Math.PI * (y / 2 ** zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Move a centre by a pixel offset and return the new centre.
 *
 * This is what dragging does. Doing it in tile space rather than degrees is the whole point:
 * a pixel is a constant distance in tile space at a given zoom, and a wildly varying number of
 * degrees of longitude depending on latitude.
 */
export function panCentre(
  centre: { lat: number; lng: number },
  zoom: number,
  dxPixels: number,
  dyPixels: number,
): { lat: number; lng: number } {
  const x = lngToTileX(centre.lng, zoom) - dxPixels / TILE_SIZE;
  const y = latToTileY(centre.lat, zoom) - dyPixels / TILE_SIZE;
  return { lat: clampLat(tileYToLat(y, zoom)), lng: normaliseLng(tileXToLng(x, zoom)) };
}

/** Keep longitude in −180..180 so a pan across the date line does not produce 200°. */
export function normaliseLng(lng: number): number {
  let x = ((lng + 180) % 360) - 180;
  if (x < -180) x += 360;
  return x;
}

export interface TileRef {
  x: number;
  y: number;
  z: number;
  /** Pixel offset of this tile's top-left corner within the viewport. */
  left: number;
  top: number;
}

/**
 * Every tile needed to cover a viewport, with where to put each one.
 *
 * Wraps x around the world so panning past the date line shows map rather than blank space.
 * Tiles above or below the projection are simply omitted — there is nothing there.
 */
export function tilesForViewport(
  centre: { lat: number; lng: number },
  zoom: number,
  width: number,
  height: number,
): TileRef[] {
  const scale = 2 ** zoom;
  const centreX = lngToTileX(centre.lng, zoom);
  const centreY = latToTileY(centre.lat, zoom);

  // Tile coordinate of the viewport's top-left corner.
  const originX = centreX - width / 2 / TILE_SIZE;
  const originY = centreY - height / 2 / TILE_SIZE;

  const firstX = Math.floor(originX);
  const firstY = Math.floor(originY);
  const cols = Math.ceil(width / TILE_SIZE) + 1;
  const rows = Math.ceil(height / TILE_SIZE) + 1;

  const out: TileRef[] = [];
  for (let dy = 0; dy < rows; dy++) {
    for (let dx = 0; dx < cols; dx++) {
      const tx = firstX + dx;
      const ty = firstY + dy;
      if (ty < 0 || ty >= scale) continue;
      out.push({
        x: ((tx % scale) + scale) % scale,
        y: ty,
        z: zoom,
        left: Math.round((tx - originX) * TILE_SIZE),
        top: Math.round((ty - originY) * TILE_SIZE),
      });
    }
  }
  return out;
}

/**
 * How many decimal places to show at a given zoom.
 *
 * Reporting more precision than the zoom level can express is a lie the user cannot see: at
 * zoom 12 one pixel is roughly 38 m, so six decimals would claim a millimetre. Six is the cap
 * because that is where decimals stop meaning anything on the ground.
 */
export function decimalsForZoom(zoom: number): number {
  return clamp(Math.round(zoom / 3) + 1, 4, 6);
}

/**
 * Ground distance covered by one screen pixel, at a latitude and zoom.
 *
 * The `cos(lat)` is the whole of Mercator's distortion: a pixel at 60 degrees north covers half
 * the ground a pixel at the equator does. Dropping it is the classic way to get a scale that is
 * right in Jordan and wrong in Norway.
 */
export function metresPerPixel(lat: number, zoom: number): number {
  return (EQUATORIAL_M_PER_PX * Math.cos((clampLat(lat) * Math.PI) / 180)) / 2 ** zoom;
}

/** One pixel at zoom 0 on the equator, in metres. The earth's circumference over 256 px. */
const EQUATORIAL_M_PER_PX = 156543.03392;

/**
 * The zoom at which a fix of this reported accuracy fills a viewport of this height.
 *
 * This is the honest half of "use my location". A browser fix carries an accuracy radius that
 * runs from about 5 m on GPS to several kilometres on an IP lookup, and dropping the pin at
 * street zoom in both cases draws a guess and a measurement identically. Framing the uncertainty
 * instead means a coarse fix visibly lands on a whole district, which is itself the prompt to
 * drag the pin somewhere better.
 *
 * Capped at 17 rather than MAX_ZOOM: a 5 m fix is still not a doorway, and zooming past the
 * point where the surrounding streets are visible removes the context needed to correct it.
 */
export function zoomForAccuracy(accuracyM: number, lat: number, viewportPx: number): number {
  // Accuracy is a radius, so the diameter is what has to fit, and it is fitted to half the
  // viewport rather than all of it so there is map left around the circle to drag against.
  const needed = (2 * Math.max(accuracyM, 1)) / Math.max(viewportPx / 2, 1);
  const z = Math.log2((EQUATORIAL_M_PER_PX * Math.cos((clampLat(lat) * Math.PI) / 180)) / needed);
  return clamp(Math.round(z), MIN_ZOOM, 17);
}
