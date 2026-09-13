import { ACCURACY_CAP_M, haversineM, presenceFor } from './haversine.js';

const KUWAIT_CITY_CENTRE = { lat: 29.3759, lng: 47.9774 };
const AVENUES_MALL = { lat: 29.3028, lng: 47.9383 };
const SALMIYA = { lat: 29.3339, lng: 48.0758 };

describe('haversine', () => {
  it('matches the known reference pair from the geo-fixtures skill (10.62 km)', () => {
    // Asserted against a real, map-checkable pair rather than a synthetic one.
    // The skill originally said 9.6 km; that was wrong and this test is what caught it.
    // Verified two ways: haversine and an equirectangular approximation both give 10.619 km,
    // and the components (4.64 km N-S, 9.55 km E-W) add up. See docs/AI-NOTES.md.
    const d = haversineM(KUWAIT_CITY_CENTRE, SALMIYA);
    expect(d / 1000).toBeCloseTo(10.62, 1);
  });

  it('is zero for identical points', () => {
    expect(haversineM(KUWAIT_CITY_CENTRE, { ...KUWAIT_CITY_CENTRE })).toBeCloseTo(0, 6);
  });

  it('is symmetric', () => {
    expect(haversineM(KUWAIT_CITY_CENTRE, AVENUES_MALL)).toBeCloseTo(
      haversineM(AVENUES_MALL, KUWAIT_CITY_CENTRE),
      6,
    );
  });

  it('is not Euclidean: longitude degrees are shorter than latitude degrees at this latitude', () => {
    // The bug this guards against is using sqrt(dLat^2 + dLng^2), which would make these equal.
    const oneDegLat = haversineM({ lat: 29, lng: 48 }, { lat: 30, lng: 48 });
    const oneDegLng = haversineM({ lat: 29, lng: 48 }, { lat: 29, lng: 49 });
    expect(oneDegLat).toBeGreaterThan(oneDegLng);
    // At ~29 degrees N the ratio is cos(29) ~ 0.874.
    expect(oneDegLng / oneDegLat).toBeCloseTo(0.874, 2);
  });

  it('handles the antimeridian without going the long way round', () => {
    const d = haversineM({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
    expect(d).toBeLessThan(30_000);
  });
});

describe('presence rule', () => {
  const fence = { radiusM: 100, nearBufferM: 50 };

  it('counts a fix inside when distance is within radius plus its own accuracy', () => {
    expect(presenceFor(110, 20, fence)).toBe('inside'); // 110 <= 100 + 20
  });

  it('does not let accuracy beyond the cap manufacture presence', () => {
    // The cap bounds the TOLERANCE, so 400 m of claimed accuracy still only widens a 50 m fence
    // to 150 m. A fix 400 m out therefore reads outside, not inside -- which is the thing the cap
    // exists to prevent.
    expect(presenceFor(400, 400, fence)).toBe('outside');
  });

  it('treats a fix at exactly the accuracy cap as usable', () => {
    expect(presenceFor(100, ACCURACY_CAP_M, fence)).toBe('inside');
  });

  it('keeps using a fix whose accuracy is past the cap, rather than discarding it (D-054)', () => {
    /**
     * The cap bounds how much the fence may widen. It is NOT a veto on the fix.
     *
     * Discarding was the single worst bug this engine has had: a laptop has no GPS radio, so
     * Chrome answers from a Wi-Fi scan and reports 100-500 m of uncertainty routinely. The
     * measured traces put the laptop 5-7 m from the venue centre -- indistinguishable from the
     * phone beside it -- and every visit scored as "no usable evidence" while the server held a
     * 7 m distance. Where a fix says you are and how sure the browser claims to be are different
     * facts, and only the second one was ever in doubt.
     */
    expect(presenceFor(7, 182, fence)).toBe('inside');
    // Tolerance is still capped, so a coarse fix cannot claim the whole distance it is out by.
    expect(presenceFor(100, ACCURACY_CAP_M + 1, fence)).toBe('inside'); // 100 <= 50 + 50
    // The cafe case: a coarse laptop fix well past the fence edge does not get pulled inside.
    expect(presenceFor(170, 182, fence)).not.toBe('inside');
    expect(presenceFor(500, 5000, fence)).toBe('outside'); // not 50 + 5000
  });

  it('reports unknown only when there is no usable accuracy number at all', () => {
    expect(presenceFor(7, Number.NaN, fence)).toBe('unknown');
    expect(presenceFor(7, Number.POSITIVE_INFINITY, fence)).toBe('unknown');
    expect(presenceFor(7, -1, fence)).toBe('unknown');
  });

  it('reports near inside the buffer ring', () => {
    expect(presenceFor(140, 5, fence)).toBe('near'); // >100+5, <=100+50+5
  });

  it('reports outside beyond the buffer', () => {
    expect(presenceFor(400, 5, fence)).toBe('outside');
  });

  it('is exact at the radius boundary', () => {
    expect(presenceFor(100, 0, fence)).toBe('inside');
    expect(presenceFor(100.1, 0, fence)).toBe('near');
  });

  it('treats a non-finite accuracy as unknown rather than trusting it', () => {
    expect(presenceFor(10, Number.NaN, fence)).toBe('unknown');
    expect(presenceFor(10, Number.POSITIVE_INFINITY, fence)).toBe('unknown');
  });
});
