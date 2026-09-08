import { ar, en } from './strings.js';

/**
 * The dictionary is the one part of the Arabic pass that fails SILENTLY.
 *
 * A missing key renders as nothing, a stale key lingers for ever, and a translated string that
 * dropped its `{placeholder}` shows a participant a raw brace or, worse, a sentence missing the
 * number it was about. None of that throws, and none of it is caught by the type system — the
 * `Strings` type catches a MISSING key, but not an empty string, an untranslated one, or a lost
 * placeholder.
 *
 * Per the testing policy this is not UI rendering; it is data with an invariant, and the
 * invariant is invisible when it breaks.
 */
describe('participant dictionary', () => {
  const keys = Object.keys(en) as (keyof typeof en)[];

  it('has an Arabic entry for every English key', () => {
    expect(Object.keys(ar).sort()).toEqual(keys.slice().sort());
  });

  it('has no empty strings in either language', () => {
    for (const k of keys) {
      expect(en[k].trim().length).toBeGreaterThan(0);
      expect(ar[k].trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps every placeholder through translation', () => {
    const placeholders = (s: string): string[] => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    for (const k of keys) {
      expect({ key: k, ph: placeholders(ar[k]) }).toEqual({
        key: k,
        ph: placeholders(en[k]),
      });
    }
  });

  it('actually translates: no Arabic value is a copy of its English one', () => {
    // `language` is the deliberate exception -- it holds the name of the OTHER language, so
    // the English entry is Arabic script and vice versa.
    for (const k of keys.filter((x) => x !== 'language')) {
      // A value that is byte-identical is almost certainly an untranslated placeholder left
      // behind while copying the block across.
      expect(ar[k]).not.toBe(en[k]);
    }
  });

  it('contains Arabic script in the Arabic dictionary', () => {
    const arabic = /[؀-ۿ]/;
    for (const k of keys.filter((x) => x !== 'language')) {
      expect(arabic.test(ar[k])).toBe(true);
    }
  });
});
