import { ThemeProvider } from '@mui/material';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { buildTheme } from '../theme/theme.js';
import { DICTIONARIES, type Locale, type Strings } from './strings.js';

const STORAGE_KEY = 'msp.locale';

interface LocaleValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  toggle: () => void;
  /** Look up a string, substituting {placeholders}. */
  t: (key: keyof Strings, vars?: Record<string, string | number>) => string;
  dir: 'ltr' | 'rtl';
}

const LocaleContext = createContext<LocaleValue | null>(null);

/** English unless the browser says otherwise, and whatever the participant last chose wins. */
function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'ar') return stored;
  } catch {
    // Private mode, or storage disabled. Not a reason to fail to render.
  }
  return typeof navigator !== 'undefined' && navigator.language?.startsWith('ar') ? 'ar' : 'en';
}

/**
 * Language and direction for the participant flow.
 *
 * This owns the theme as well as the strings, because direction is a theme concern in MUI and
 * having two providers that could disagree about which way the page runs is exactly the kind
 * of seam this project keeps getting caught by. One source of truth, one place it is set.
 *
 * `document.dir` is set alongside it. That is what does most of the actual RTL work -- text
 * alignment, flex order and logical properties all follow the document direction natively,
 * which is why this pass needs no RTL style plugin (D-022).
 */
export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const dir: 'ltr' | 'rtl' = locale === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // The choice still applies for this session; it just will not be remembered.
    }
  }, []);

  const t = useCallback(
    (key: keyof Strings, vars?: Record<string, string | number>): string => {
      const raw = DICTIONARIES[locale][key];
      if (!vars) return raw;
      return Object.entries(vars).reduce(
        (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
        raw,
      );
    },
    [locale],
  );

  const theme = useMemo(() => buildTheme(dir), [dir]);

  const value = useMemo<LocaleValue>(
    () => ({ locale, setLocale, toggle: () => setLocale(locale === 'ar' ? 'en' : 'ar'), t, dir }),
    [locale, setLocale, t, dir],
  );

  return (
    <LocaleContext.Provider value={value}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used inside LocaleProvider');
  return ctx;
}

/** The common case: just the lookup function. */
export function useT(): LocaleValue['t'] {
  return useLocale().t;
}
