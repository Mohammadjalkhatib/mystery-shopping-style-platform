import {
  isUsableQuery,
  mapResults,
  MAX_RESULTS,
  normaliseQuery,
  searchUrl,
  zoomForKind,
} from './nominatim.js';

/**
 * Everything Nominatim returns is untrusted external data, and the parsing is where a mistake
 * is silent: a coordinate that survives as `NaN`, or a string latitude read as a number, puts
 * a venue nowhere and still looks like a venue. That is the same failure class as D-020, from
 * a different direction.
 */
describe('nominatim', () => {
  describe('query handling', () => {
    it('collapses whitespace and trims', () => {
      expect(normaliseQuery('  Mecca   Street ,  Amman ')).toBe('Mecca Street , Amman');
    });

    it('caps a pathological query rather than forwarding it', () => {
      expect(normaliseQuery('x'.repeat(500)).length).toBe(120);
    });

    it('refuses queries too short to mean anything', () => {
      expect(isUsableQuery('am')).toBe(false);
      expect(isUsableQuery('  a  ')).toBe(false);
      expect(isUsableQuery('amman')).toBe(true);
    });
  });

  describe('searchUrl', () => {
    it('encodes the query rather than concatenating it', () => {
      const url = new URL(searchUrl('Mecca Street, Amman'));
      expect(url.origin).toBe('https://nominatim.openstreetmap.org');
      expect(url.searchParams.get('q')).toBe('Mecca Street, Amman');
      expect(url.searchParams.get('format')).toBe('jsonv2');
    });

    it('clamps the limit both ways', () => {
      expect(new URL(searchUrl('amman', 99)).searchParams.get('limit')).toBe(String(MAX_RESULTS));
      expect(new URL(searchUrl('amman', 0)).searchParams.get('limit')).toBe('1');
    });

    it('survives a query full of URL metacharacters', () => {
      const url = new URL(searchUrl('a&b=c?d#e'));
      expect(url.searchParams.get('q')).toBe('a&b=c?d#e');
      expect(url.searchParams.get('format')).toBe('jsonv2');
    });
  });

  describe('mapResults', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      lat: '31.9399307',
      lon: '35.8486227',
      display_name: 'Mecca Street, Amman, Jordan',
      type: 'residential',
      ...over,
    });

    it('parses string coordinates into numbers', () => {
      // The trap: Nominatim sends lat/lon as STRINGS.
      const [r] = mapResults([row()]);
      expect(r!.lat).toBeCloseTo(31.9399307, 7);
      expect(r!.lng).toBeCloseTo(35.8486227, 7);
      expect(typeof r!.lat).toBe('number');
    });

    it('drops rows whose coordinates are missing or unparseable', () => {
      // NaN sails through a naive `typeof === number` check into a venue that is nowhere.
      expect(mapResults([row({ lat: undefined })])).toHaveLength(0);
      expect(mapResults([row({ lon: 'not-a-number' })])).toHaveLength(0);
      expect(mapResults([row({ lat: null })])).toHaveLength(0);
      // Number(null), Number('') and Number([]) are all 0, not NaN — a bare Number() here
      // yields a venue at 0 degrees that looks entirely ordinary.
      expect(mapResults([row({ lat: '' })])).toHaveLength(0);
      expect(mapResults([row({ lon: [] })])).toHaveLength(0);
      expect(mapResults([row({ lat: false })])).toHaveLength(0);
    });

    it('drops rows outside the possible range', () => {
      expect(mapResults([row({ lat: '931.9' })])).toHaveLength(0);
      expect(mapResults([row({ lon: '-999' })])).toHaveLength(0);
    });

    it('drops rows with no display name', () => {
      expect(mapResults([row({ display_name: '' })])).toHaveLength(0);
      expect(mapResults([row({ display_name: 42 })])).toHaveLength(0);
    });

    it('truncates an unreasonably long label', () => {
      const [r] = mapResults([row({ display_name: 'x'.repeat(500) })]);
      expect(r!.label.length).toBeLessThanOrEqual(160);
      expect(r!.label.endsWith('…')).toBe(true);
    });

    it('survives anything that is not an array', () => {
      // A rate-limit page or an error object must not throw on the way through.
      expect(mapResults(null)).toEqual([]);
      expect(mapResults({ error: 'rate limited' })).toEqual([]);
      expect(mapResults('<html>blocked</html>')).toEqual([]);
      expect(mapResults([null, 5, 'x'])).toEqual([]);
    });

    it('keeps the good rows when some are bad', () => {
      const out = mapResults([row({ lat: 'bad' }), row(), row({ display_name: '' })]);
      expect(out).toHaveLength(1);
    });

    it('never returns more than the cap', () => {
      expect(mapResults(Array.from({ length: 50 }, () => row()))).toHaveLength(MAX_RESULTS);
    });
  });

  describe('zoomForKind', () => {
    it('zooms out for large places and in for small ones', () => {
      // Dropping street-level on a country is as unhelpful as a province for a shop.
      expect(zoomForKind('country')).toBeLessThan(zoomForKind('city'));
      expect(zoomForKind('city')).toBeLessThan(zoomForKind('suburb'));
      expect(zoomForKind('suburb')).toBeLessThan(zoomForKind('cafe'));
    });

    it('has a sensible default for an unknown kind', () => {
      expect(zoomForKind('something-nominatim-invented')).toBe(17);
    });
  });
});
