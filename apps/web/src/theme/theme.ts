import { createTheme, type ThemeOptions } from '@mui/material/styles';

/**
 * theQA brand theme.
 *
 * The values below are theQA's own design tokens, not an approximation. They were read on
 * 2026-09-10 out of the stylesheets theqa.io ships at
 * `/_next/static/chunks/{00pnp7o2lj6qg,180p~f7erl0tb}.css`, where the site publishes a full
 * `--qa-*` custom-property layer on `:root`. theqa.io is a Next.js app and its rendered DOM
 * is not fetchable, but that token layer is static CSS, so it can be read directly.
 *
 * Everything named `qa.*` in this file is a verbatim copy of one of those tokens. Anything
 * this file decides on top of them is marked LOCAL and carries a reason. See D-039.
 */

/**
 * theQA's token layer, transcribed.
 *
 * Only the steps this app actually uses are kept. The site defines a full 50..950 ramp for
 * teal, purple, blue, orange, red, green, yellow, sky and pink; pulling all of them in would
 * be dead weight, and a half-used ramp invites people to reach for an off-brand step. Add a
 * step here when a screen needs it, from the source in the header -- never a value picked to
 * sit between two of these.
 *
 * Exported because the MUI palette cannot carry all of it (D-040). `palette` holds the dozen
 * values MUI itself resolves -- `primary`, `divider`, `text.secondary` -- and a component that
 * needs a specific rung reaches for `qa` directly:
 *
 *     import { qa } from '../theme/theme.js';
 *     <Box sx={{ bgcolor: qa.neutral[100], borderRadius: `${qa.radius.sm}px` }} />
 *
 * Prefer the semantic palette route where one exists: `divider` says what the colour is FOR,
 * `qa.neutral[200]` only says what it is. Reach here for the rungs the palette has no name for.
 */
export const qa = {
  /** `--qa-neutral-*`. 700 really is `#333` in their CSS, not a 6-digit value. */
  neutral: {
    0: '#ffffff',
    50: '#fafafa',
    100: '#f5f5f5',
    200: '#ebebeb',
    300: '#d6d6d6',
    400: '#a8a8a8',
    500: '#7b7b7b',
    600: '#5c5c5c',
    700: '#333333',
    900: '#1f1f1f',
  },

  /**
   * `--qa-teal-*`. This is the brand.
   *
   * 700 is the load-bearing one: theqa.io hardcodes `#15868c` as the accent on its app-shell
   * loading spinner, which is the only colour literal in the served HTML. That is what settles
   * teal as the primary rather than purple -- both ship as full ramps, but only teal is spent
   * on chrome the user sees before the app has booted.
   */
  teal: {
    50: '#e3fbfc',
    100: '#d1f9fb',
    300: '#84e5ea',
    500: '#20cad3',
    600: '#1ea8af',
    700: '#15868c',
    800: '#197075',
    900: '#175f63',
  },

  /** `--qa-purple-*`. The second brand ramp, an accent rather than an action colour. */
  purple: {
    100: '#dcd6ff',
    500: '#7d52f4',
    700: '#5b2dc9',
  },

  /**
   * Status ramps. See `verdictPalette` for why only some of these are reachable.
   *
   * The 50 steps are tinted SURFACES, not text or fills -- a review banner's background, the
   * ground under a rejected row. Nothing legible goes on top of a 700 at that size.
   */
  yellow: { 50: '#fffaea', 500: '#f6b51e', 700: '#c89a2c', 800: '#a77f26' },
  red: { 50: '#ffeaec', 700: '#d02633', 800: '#ad1f2a' },

  /** `--qa-radius-*`. */
  radius: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, full: 9999 },

  /** `--qa-duration-*` and `--qa-ease-*`. */
  motion: {
    fast: '0.15s',
    base: '0.2s',
    slow: '0.3s',
    easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
    easeInOut: 'cubic-bezier(0.45, 0, 0.55, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },

  /** `--qa-shadow-*`. MUI wants a 25-entry array, so these get spliced in by `buildTheme`. */
  shadow: {
    sm: '0 1px 2px 0 #0000000d',
    base: '0 1px 3px 0 #0000001a, 0 1px 2px -1px #0000001a',
    md: '0 4px 6px -1px #0000001a, 0 2px 4px -2px #0000001a',
    lg: '0 10px 15px -3px #0000001a, 0 4px 6px -4px #0000001a',
    xl: '0 20px 25px -5px #0000001a, 0 8px 10px -6px #0000001a',
  },

  /** `--qa-lh-*` and `--qa-ls-*`. */
  lineHeight: { title: 1.1, compact: 1.2, body: 1.5 },
  letterSpacing: { tight: '-0.01em', none: '0', uppercase: '0.08em' },
} as const;

/**
 * `--font-primary`, verbatim.
 *
 * One family covers both scripts. theqa.io sets IBM Plex Sans Arabic as its only text face and
 * typesets its Latin copy in it too, so matching them means dropping the Inter that used to sit
 * at the front of this stack. That also unblocks the Arabic pass: with Inter first, Arabic only
 * reached Plex by falling through, which is not the same thing as being set in it.
 */
const fontFamily = [
  '"IBM Plex Sans Arabic"',
  'ui-sans-serif',
  'system-ui',
  '-apple-system',
  'sans-serif',
].join(',');

/**
 * Verification verdict colours.
 *
 * These are deliberately not a green tick and a red cross. The whole point of D-001 is that the
 * system does not claim certainty, and a green tick undoes that in the UI no matter what the
 * copy says. theQA's palette does contain `--qa-green-700`, and this is the one place the brand
 * ramp is deliberately left unused.
 *
 * `auto_verified` is the brand teal, which reads as a confident neutral rather than a pass mark.
 * `needs_review` is `--qa-yellow-700`, an amber that invites attention rather than alarm.
 * `rejected` is `--qa-red-800`; a rejection is a real negative and is allowed to look like one.
 *
 * The strings shown next to these are always "consistent with a genuine visit", never
 * "verified". Do not let the UI overstate what the engine can support.
 */
export const verdictPalette = {
  auto_verified: { main: qa.teal[700], contrastText: '#FFFFFF' },
  needs_review: { main: qa.yellow[700], contrastText: '#FFFFFF' },
  rejected: { main: qa.red[800], contrastText: '#FFFFFF' },
} as const;

/**
 * The same three states, re-stepped for charts. Re-validated 2026-09-10 (D-043).
 *
 * Chrome and data have different jobs, so these are not the same steps as `verdictPalette`. A
 * colour that is right for a 20 px chip on white is not automatically right for a bar segment
 * that has to stay distinguishable under simulated colour-vision deficiency.
 *
 * `auto_verified` is `--qa-teal-600`, one step lighter than the brand primary. The primary
 * itself, `--qa-teal-700`, FAILS the chroma floor at 0.092 — it reads as gray in a chart. That
 * is the same failure the old green had for the same reason: a colour chosen to sit quietly
 * behind UI chrome is chosen to be low-chroma, which is exactly wrong for a data mark.
 *
 * `needs_review` is `--qa-yellow-800` rather than the 700 the chip uses, for adjacent-pair
 * separation against the red.
 *
 * Verified with `dataviz/scripts/validate_palette.js --mode light`: lightness band PASS, chroma
 * floor PASS, CVD separation PASS (worst adjacent pair ΔE 13.1 deutan, 16.7 tritan),
 * normal-vision floor PASS (worst ΔE 19.5). Contrast against the chart surface is a WARN for the
 * teal at 2.81:1 — that is not dismissable, and the relief it requires is already in place:
 * `Dashboard` renders a labelled legend and labelled stat tiles, so no series is identified by
 * colour alone. If a chart is ever added WITHOUT visible labels, this palette is not licensed
 * for it.
 *
 * No dark-mode steps: `palette.mode` is `light` and there is no dark surface to validate against.
 *
 * Do not hand-edit these. Re-run the validator.
 */
export const verdictChartPalette = {
  auto_verified: qa.teal[600],
  needs_review: qa.yellow[800],
  rejected: qa.red[800],
} as const;

const options: ThemeOptions = {
  direction: 'ltr', // flipped to 'rtl' by the locale provider on the Arabic pass

  palette: {
    mode: 'light',
    primary: {
      main: qa.teal[700],
      dark: qa.teal[900],
      light: qa.teal[500],
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: qa.purple[500],
      dark: qa.purple[700],
      light: qa.purple[100],
      contrastText: '#FFFFFF',
    },
    warning: { main: qa.yellow[700], light: qa.yellow[500] },
    error: { main: qa.red[800], light: qa.red[700] },
    background: { default: qa.neutral[50], paper: qa.neutral[0] },
    text: {
      primary: qa.neutral[900],
      secondary: qa.neutral[600],
      disabled: qa.neutral[400],
    },
    divider: qa.neutral[200],
    action: { hover: qa.neutral[100], selected: qa.teal[100] },
  },

  typography: {
    fontFamily,
    fontWeightRegular: 400,
    fontWeightMedium: 500,

    /**
     * LOCAL: their heading steps, entered one rung down.
     *
     * theQA's scale runs `--qa-h1-size: 3.5rem` down to `--qa-h6-size: 1.25rem`, which is sized
     * for a marketing page. A console screen opening at 3.5rem would be absurd, so h1 here takes
     * their h4 step, h2 their h5, h3 their h6. The ratios and the line-heights are theirs; only
     * the entry point into the scale is ours.
     */
    h1: {
      fontSize: '2rem',
      fontWeight: 700,
      lineHeight: qa.lineHeight.title,
      letterSpacing: qa.letterSpacing.tight,
    },
    h2: {
      fontSize: '1.5rem',
      fontWeight: 700,
      lineHeight: qa.lineHeight.compact,
      letterSpacing: qa.letterSpacing.tight,
    },
    h3: {
      fontSize: '1.25rem',
      fontWeight: 600,
      lineHeight: qa.lineHeight.compact,
    },
    body1: { fontSize: '1rem', lineHeight: qa.lineHeight.body },
    body2: { fontSize: '0.875rem', lineHeight: qa.lineHeight.body },
    caption: { fontSize: '0.75rem', lineHeight: qa.lineHeight.body },
    overline: {
      fontSize: '0.75rem',
      fontWeight: 500,
      letterSpacing: qa.letterSpacing.uppercase,
    },
    button: { textTransform: 'none', fontWeight: 600 },
  },

  shape: {
    borderRadius: qa.radius.md,
  },

  transitions: {
    duration: {
      shortest: 150,
      shorter: 150,
      short: 200,
      standard: 200,
      complex: 300,
      enteringScreen: 200,
      leavingScreen: 150,
    },
    easing: {
      easeInOut: qa.motion.easeInOut,
      easeOut: qa.motion.easeOut,
      easeIn: qa.motion.easeInOut,
      sharp: qa.motion.easeOut,
    },
  },

  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: qa.radius.full,
          paddingInline: 20,
          paddingBlock: 10,
          transition: `background-color ${qa.motion.base} ${qa.motion.easeOut}`,
        },
        // The participant's primary action is "start visit" and later "end visit",
        // both of which need to be unmissable on a phone held one-handed in a shop.
        sizeLarge: { minHeight: 56, fontSize: '1rem' },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: `1px solid ${qa.neutral[200]}`,
          borderRadius: qa.radius.lg,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: qa.radius.sm },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: { borderBottom: `1px solid ${qa.neutral[200]}` },
      },
    },
    MuiPaper: {
      styleOverrides: {
        rounded: { borderRadius: qa.radius.lg },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: qa.neutral[200] },
        head: { fontWeight: 600, color: qa.neutral[600], backgroundColor: qa.neutral[50] },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: qa.neutral[900], borderRadius: qa.radius.sm },
      },
    },
  },
};

/**
 * theQA's shadow scale, mapped onto MUI's 25 elevation slots.
 *
 * MUI indexes shadows by elevation number and expects exactly 25 entries. theQA publishes six
 * named steps, so the named ones are pinned to the elevations MUI actually reaches for and the
 * tail repeats the largest. Anything above elevation 8 in this app is a menu or a dialog, and
 * those can all share one shadow.
 */
const shadows = [
  'none',
  qa.shadow.sm,
  qa.shadow.sm,
  qa.shadow.base,
  qa.shadow.base,
  qa.shadow.md,
  qa.shadow.md,
  qa.shadow.md,
  qa.shadow.lg,
  ...Array<string>(16).fill(qa.shadow.xl),
] as ThemeOptions['shadows'];

/**
 * The theme, for a given text direction.
 *
 * Direction lives in the theme because MUI reads it from there, and it is set from exactly one
 * place -- the locale provider -- so the strings and the layout cannot disagree about which way
 * the page runs. `document.dir` is set alongside it and does most of the real work (D-022).
 */
export function buildTheme(direction: 'ltr' | 'rtl' = 'ltr') {
  return createTheme({ ...options, direction, shadows });
}

/** The default LTR theme, for anything outside the participant flow. */
export const theme = buildTheme('ltr');
export default theme;
