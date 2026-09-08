import {
  clampLat,
  decimalsForZoom,
  latToTileY,
  lngToTileX,
  MAX_LAT,
  normaliseLng,
  panCentre,
  tileXToLng,
  tileYToLat,
  tilesForViewport,
} from './slippy.js';

/**
 * The projection is the only silent part of the map picker.
 *
 * A wrong pan is visible instantly. A wrong projection puts the pin a few hundred metres from
 * where the user aimed, looks entirely plausible, and produces exactly the class of wrong venue
 * coordinate that D-020 exists to catch. So it gets round-trip tests against known values.
 */
const AMMAN = { lat: 31.9399307, lng: 35.8486227 };

describe('web mercator tiles', () => {
  describe('known reference values', () => {
    it('puts 0,0 at the centre of the world at every zoom', () => {
      for (const z of [0, 1, 5, 12]) {
        expect(lngToTileX(0, z)).toBeCloseTo(2 ** z / 2, 9);
        expect(latToTileY(0, z)).toBeCloseTo(2 ** z / 2, 9);
      }
    });

    it('puts the antimeridian and the poles at the edges', () => {
      expect(lngToTileX(-180, 4)).toBeCloseTo(0, 9);
      expect(lngToTileX(180, 4)).toBeCloseTo(16, 9);
      expect(latToTileY(MAX_LAT, 4)).toBeCloseTo(0, 6);
      expect(latToTileY(-MAX_LAT, 4)).toBeCloseTo(16, 6);
    });

    it('lands on the standard tile for Amman at zoom 12', () => {
      // Computed from the Web Mercator formula, then checked against a slippy tile calculator.
      // My first attempt at this assertion used numbers I had not actually worked out, and the
      // test caught it -- which is the argument for asserting concrete values rather than
      // "it returns a number".
      expect(Math.floor(lngToTileX(AMMAN.lng, 12))).toBe(2455);
      expect(Math.floor(latToTileY(AMMAN.lat, 12))).toBe(1664);
    });

    it('matches the OSM wiki worked example for Berlin at zoom 10', () => {
      // A second, independent reference point. One known value can be a coincidence of a
      // consistently-wrong formula; two at different latitudes and zooms cannot.
      expect(Math.floor(lngToTileX(13.4, 10))).toBe(550);
      expect(Math.floor(latToTileY(52.5, 10))).toBe(335);
    });
  });

  describe('round trips', () => {
    it.each([0, 4, 12, 19])('survives lat/lng -> tile -> lat/lng at zoom %i', (z) => {
      const x = lngToTileX(AMMAN.lng, z);
      const y = latToTileY(AMMAN.lat, z);
      expect(tileXToLng(x, z)).toBeCloseTo(AMMAN.lng, 9);
      expect(tileYToLat(y, z)).toBeCloseTo(AMMAN.lat, 9);
    });

    it('round trips the extremes it is allowed to represent', () => {
      for (const lat of [-MAX_LAT, -45, 0, 45, MAX_LAT]) {
        expect(tileYToLat(latToTileY(lat, 10), 10)).toBeCloseTo(lat, 6);
      }
    });
  });

  describe('clamping', () => {
    it('clamps latitude to where Mercator is finite', () => {
      // Beyond this tan() runs to infinity; there is no answer, not merely a big one.
      expect(clampLat(90)).toBe(MAX_LAT);
      expect(clampLat(-90)).toBe(-MAX_LAT);
      expect(Number.isFinite(latToTileY(90, 10))).toBe(true);
    });

    it('normalises longitude across the date line', () => {
      expect(normaliseLng(190)).toBeCloseTo(-170, 9);
      expect(normaliseLng(-190)).toBeCloseTo(170, 9);
      expect(normaliseLng(35)).toBeCloseTo(35, 9);
    });
  });

  describe('panCentre', () => {
    it('does nothing when nothing moved', () => {
      const c = panCentre(AMMAN, 14, 0, 0);
      expect(c.lat).toBeCloseTo(AMMAN.lat, 9);
      expect(c.lng).toBeCloseTo(AMMAN.lng, 9);
    });

    it('moves west when dragged right, and back again', () => {
      const z = 14;
      const right = panCentre(AMMAN, z, 100, 0);
      expect(right.lng).toBeLessThan(AMMAN.lng);
      expect(panCentre(right, z, -100, 0).lng).toBeCloseTo(AMMAN.lng, 9);
    });

    it('moves the same pixels a smaller distance as zoom increases', () => {
      const near = Math.abs(panCentre(AMMAN, 16, 100, 0).lng - AMMAN.lng);
      const far = Math.abs(panCentre(AMMAN, 10, 100, 0).lng - AMMAN.lng);
      expect(near).toBeLessThan(far);
    });

    it('cannot be dragged past the pole', () => {
      expect(panCentre({ lat: 84, lng: 0 }, 3, 0, 100000).lat).toBeLessThanOrEqual(MAX_LAT);
    });
  });

  describe('tilesForViewport', () => {
    it('covers the viewport with at least one tile past each edge', () => {
      const tiles = tilesForViewport(AMMAN, 14, 600, 300);
      expect(tiles.length).toBeGreaterThanOrEqual(3 * 2);
      expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
      expect(Math.max(...tiles.map((t) => t.left))).toBeGreaterThanOrEqual(600 - 256);
    });

    it('wraps x around the world instead of leaving a gap', () => {
      // Panned to the date line: every x must still be a valid tile index.
      const tiles = tilesForViewport({ lat: 0, lng: 179.99 }, 3, 600, 300);
      const scale = 2 ** 3;
      expect(tiles.every((t) => t.x >= 0 && t.x < scale)).toBe(true);
    });

    it('omits tiles above and below the projection rather than requesting them', () => {
      const tiles = tilesForViewport({ lat: MAX_LAT, lng: 0 }, 2, 600, 600);
      const scale = 2 ** 2;
      expect(tiles.every((t) => t.y >= 0 && t.y < scale)).toBe(true);
    });
  });

  describe('decimalsForZoom', () => {
    it('never claims more precision than the zoom can express', () => {
      expect(decimalsForZoom(2)).toBe(4);
      expect(decimalsForZoom(19)).toBe(6);
    });

    it('always meets the minimum the geofence rule needs', () => {
      // D-020: four decimals is required for the tightest fence the schema allows.
      for (let z = 2; z <= 19; z++) expect(decimalsForZoom(z)).toBeGreaterThanOrEqual(4);
    });
  });
});
