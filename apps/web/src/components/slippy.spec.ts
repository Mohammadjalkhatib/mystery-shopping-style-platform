import {
  clampLat,
  decimalsForZoom,
  latToTileY,
  lngToTileX,
  MAX_LAT,
  metresPerPixel,
  MIN_ZOOM,
  normaliseLng,
  panCentre,
  tileXToLng,
  tileYToLat,
  tilesForViewport,
  zoomForAccuracy,
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
  describe('metresPerPixel', () => {
    it('matches the known equatorial scale at zoom 0', () => {
      expect(metresPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
    });

    it('halves with every zoom level', () => {
      expect(metresPerPixel(31.95, 13)).toBeCloseTo(metresPerPixel(31.95, 12) / 2, 6);
    });

    it('shrinks away from the equator', () => {
      // Mercator's distortion. A pixel at 60 degrees covers half the ground a pixel at 0 does.
      expect(metresPerPixel(60, 12)).toBeCloseTo(metresPerPixel(0, 12) / 2, 2);
    });
  });

  describe('zoomForAccuracy', () => {
    const H = 260;

    it('frames a coarse fix wider than a sharp one', () => {
      // The whole point of the function: a 3 km IP lookup must not be drawn at the same zoom as
      // a 6 m GPS fix, because that shows a guess and a measurement as the same picture.
      expect(zoomForAccuracy(3000, AMMAN.lat, H)).toBeLessThan(zoomForAccuracy(6, AMMAN.lat, H));
    });

    it('actually fits the accuracy circle in the viewport', () => {
      for (const accuracy of [8, 40, 150, 900, 4000]) {
        const z = zoomForAccuracy(accuracy, AMMAN.lat, H);
        const spanM = metresPerPixel(AMMAN.lat, z) * H;
        expect({ accuracy, fits: spanM >= 2 * accuracy }).toEqual({ accuracy, fits: true });
        // ...and no wider than it needs to be, except where the zoom cap deliberately holds back.
        if (z < 17) expect(spanM).toBeLessThan(2 * accuracy * 8);
      }
    });

    it('stops short of maximum zoom even for an implausibly sharp fix', () => {
      // A 1 m fix is still not a doorway, and zooming past the surrounding streets removes the
      // context the user needs to correct it.
      expect(zoomForAccuracy(1, AMMAN.lat, H)).toBe(17);
      expect(zoomForAccuracy(0, AMMAN.lat, H)).toBe(17);
    });

    it('never returns a zoom the picker cannot render', () => {
      for (const accuracy of [1, 50, 1e4, 1e7]) {
        const z = zoomForAccuracy(accuracy, AMMAN.lat, H);
        expect(z).toBeGreaterThanOrEqual(MIN_ZOOM);
        expect(z).toBeLessThanOrEqual(17);
        expect(Number.isInteger(z)).toBe(true);
      }
    });
  });
});
