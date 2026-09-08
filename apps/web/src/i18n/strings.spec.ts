import { ar, en, flatten, interpolate, lookup } from './strings.js';

/**
 * The dictionaries are the one part of the i18n layer that fails SILENTLY.
 *
 * The `TranslationKey` type catches a key that does not exist in English. It cannot catch an
 * empty value, an untranslated copy-paste, a `{placeholder}` dropped in translation, or a key
 * present in English and missing from Arabic — and every one of those renders as either nothing
 * or a raw brace in front of a participant, without throwing.
 *
 * These files are meant to be handed to a translator or copied to a dialect (D-024), so the
 * guard has to survive someone editing JSON by hand with no TypeScript in sight.
 */
describe('translation dictionaries', () => {
  const flatEn = flatten(en);
  const flatAr = flatten(ar);
  const keys = Object.keys(flatEn);

  it('covers a meaningful amount of the app', () => {
    // A sanity floor. If this drops sharply, a whole section was deleted rather than edited.
    expect(keys.length).toBeGreaterThan(100);
  });

  it('has exactly the same keys in both languages', () => {
    expect(Object.keys(flatAr).sort()).toEqual(keys.slice().sort());
  });

  it('has no empty values in either language', () => {
    for (const k of keys) {
      expect(flatEn[k]!.trim().length).toBeGreaterThan(0);
      expect(flatAr[k]!.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps every placeholder through translation', () => {
    const placeholders = (s: string): string[] => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    for (const k of keys) {
      expect({ key: k, ph: placeholders(flatAr[k]!) }).toEqual({
        key: k,
        ph: placeholders(flatEn[k]!),
      });
    }
  });

  it('actually translates the prose', () => {
    // Proper nouns and a placeholder-only string are legitimately identical; everything else
    // being byte-identical means a block was copied and never translated.
    const allowedIdentical = new Set([
      'common.language',
      'auth.appName',
      'admin.venueForm.coordinatesPlaceholder',
    ]);
    for (const k of keys.filter((x) => !allowedIdentical.has(x))) {
      expect({ key: k, same: flatAr[k] === flatEn[k] }).toEqual({ key: k, same: false });
    }
  });

  it('contains Arabic script wherever there is prose to translate', () => {
    const arabic = /[؀-ۿ]/;
    const latinOnly = new Set([
      'common.language',
      'auth.appName',
      'admin.venueForm.coordinatesPlaceholder',
    ]);
    for (const k of keys.filter((x) => !latinOnly.has(x))) {
      expect({ key: k, hasArabic: arabic.test(flatAr[k]!) }).toEqual({ key: k, hasArabic: true });
    }
  });

  it('excludes the translator note from the rendered key set', () => {
    // `_readme` is guidance for whoever edits the file, not a string the app shows.
    expect(keys.some((k) => k.includes('_readme'))).toBe(false);
  });

  describe('lookup and interpolate', () => {
    it('resolves a nested path', () => {
      expect(lookup(en, 'participant.consent.title')).toBe('Before you start');
    });

    it('returns undefined for a missing path rather than throwing', () => {
      // A missing string must never blank a screen mid-visit.
      expect(lookup(en, 'participant.nope.missing')).toBeUndefined();
      expect(lookup(en, 'participant')).toBeUndefined();
    });

    it('substitutes every occurrence of a placeholder', () => {
      expect(interpolate('{a} and {a} and {b}', { a: 1, b: 'x' })).toBe('1 and 1 and x');
    });

    it('leaves an unsupplied placeholder visible rather than blanking it', () => {
      expect(interpolate('{mins} minutes', {})).toBe('{mins} minutes');
    });
  });
});
