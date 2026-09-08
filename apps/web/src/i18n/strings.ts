import arJson from './ar.json';
import enJson from './en.json';

/**
 * The dictionaries, loaded from JSON so they can be handed to a translator or copied to a
 * dialect without touching TypeScript. `en.json` is the source of truth: `TranslationKey` is
 * derived from it, so a key that exists in Arabic and not in English is a compile error, and
 * `strings.spec.ts` catches the reverse plus everything types cannot see.
 *
 * Nested by area rather than flat, because a flat file of two hundred keys stops being
 * editable at about eighty. See D-024.
 */

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends object
      ? Leaves<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

/** Every dotted path that resolves to a string, e.g. `participant.consent.title`. */
export type TranslationKey = Exclude<Leaves<typeof enJson>, `_readme${string}`>;

export type Dictionary = Record<string, unknown>;

export const en = enJson as Dictionary;
export const ar = arJson as Dictionary;

export const DICTIONARIES = { en, ar } as const;
export type Locale = keyof typeof DICTIONARIES;

/**
 * Resolve a dotted path.
 *
 * Returns `undefined` rather than throwing on a miss: a missing string must never blank a
 * screen mid-visit. The caller falls back to English and then to the key itself, so the worst
 * case a participant sees is an untranslated sentence rather than nothing.
 */
export function lookup(dict: Dictionary, path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<unknown>((acc, part) => (acc as Dictionary | undefined)?.[part], dict);
  return typeof value === 'string' ? value : undefined;
}

/** Substitute `{placeholders}`. Anything not supplied is left visible rather than blanked. */
export function interpolate(raw: string, vars?: Record<string, string | number>): string {
  if (!vars) return raw;
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
    raw,
  );
}

/**
 * Every dotted key in a dictionary, for the parity tests. `_readme` is editor guidance for
 * whoever translates this, not a string the app renders, so it is excluded everywhere.
 */
export function flatten(dict: Dictionary, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dict)) {
    if (k === '_readme') continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else if (v && typeof v === 'object') Object.assign(out, flatten(v as Dictionary, key));
  }
  return out;
}
