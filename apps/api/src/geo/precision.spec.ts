import {
  checkCoordinatePrecision,
  decimalPlaces,
  impliedPrecisionM,
} from './precision.js';

describe('coordinate precision', () => {
  describe('decimalPlaces', () => {
    it.each([
      [31.98, 2],
      [31.9399307, 7],
      [35.83, 2],
      [32, 0],
      [31.9539, 4],
    ])('counts %p as %i decimals', (value, expected) => {
      expect(decimalPlaces(value)).toBe(expected);
    });

    it('ignores binary floating point noise', () => {
      // This is the value the seeded venue reads back as. Counting digits in the string
      // would claim fifteen decimals of precision for a four decimal value, and then this
      // whole guard would wave through exactly the coordinates it exists to catch.
      expect(decimalPlaces(35.913700000000006)).toBe(4);
    });
  });

  describe('impliedPrecisionM', () => {
    it('puts two decimal places at roughly half a kilometre', () => {
      // The number behind the real failure: 31.98, 35.83 could be anywhere in a ~557 m band.
      expect(impliedPrecisionM(31.98, 35.83)).toBeGreaterThan(500);
      expect(impliedPrecisionM(31.98, 35.83)).toBeLessThan(600);
    });

    it('puts four decimal places within about six metres', () => {
      expect(impliedPrecisionM(31.9399, 35.8486)).toBeLessThan(7);
    });

    it('takes the worse of the two, when they are written differently', () => {
      // Latitude to four places, longitude to two. The longitude is what makes this useless.
      const mixed = impliedPrecisionM(31.9399, 35.83);
      expect(mixed).toBeGreaterThan(400);
    });
  });

  describe('checkCoordinatePrecision', () => {
    it('rejects the coordinate that caused this: 2 decimals against a 25 m fence', () => {
      const v = checkCoordinatePrecision(31.98, 35.83, 25);
      expect(v.ok).toBe(false);
      expect(Math.round(v.impliedM)).toBeGreaterThan(500);
      expect(v.requiredM).toBe(12.5);
    });

    it('accepts the coordinates the participant actually stood on', () => {
      expect(checkCoordinatePrecision(31.9399307, 35.8486227, 25).ok).toBe(true);
    });

    it('accepts both seeded venues, so this guard does not invalidate existing data', () => {
      expect(checkCoordinatePrecision(31.9539, 35.9106, 75).ok).toBe(true);
      expect(checkCoordinatePrecision(31.957, 35.913700000000006, 120).ok).toBe(true);
    });

    it('is scaled by the radius, not a fixed digit count', () => {
      // Three decimals is ~56 m: useless for a 25 m fence, fine for a 500 m one.
      expect(checkCoordinatePrecision(31.939, 35.848, 25).ok).toBe(false);
      expect(checkCoordinatePrecision(31.939, 35.848, 500).ok).toBe(true);
    });

    it('rejects a whole-number coordinate at every radius the schema allows', () => {
      expect(checkCoordinatePrecision(32, 36, 500).ok).toBe(false);
      expect(checkCoordinatePrecision(32, 36, 25).ok).toBe(false);
    });
  });
});
