import { createTheme, type ThemeOptions } from '@mui/material/styles';

/**
 * theQA brand theme.
 *
 * IMPORTANT: the hex values below are PLACEHOLDERS. theqa.io is a client-rendered app and
 * its stylesheet could not be read reliably, so these were not extracted from the real site
 * and should not be trusted. Replace them before the first UI commit.
 *
 * To get the real values in about a minute:
 *   1. Open https://theqa.io/en, right click the primary button, Inspect.
 *   2. In the Styles pane read the computed `background-color` and `color`.
 *   3. Do the same for a heading (text colour), the page background, and a link.
 *   4. In the Computed tab read `font-family` on a heading and on body text.
 *   5. Read `border-radius` off the primary button. Kuwaiti product sites tend to run
 *      pill-shaped or heavily rounded, and getting that one value right does more for
 *      "this looks like our product" than the palette does.
 *
 * Also check whether their Arabic type is a different family from their Latin type. Most
 * bilingual Gulf products use two, and `typography.fontFamily` needs both in the stack.
 *
 * Record the extracted values in a comment here with the date, so the reviewer can see
 * this was taken from their site rather than guessed.
 */

const brand = {
  // PLACEHOLDER: replace with the real primary from theqa.io
  primary: '#1F6F5C',
  primaryDark: '#164F41',
  primaryLight: '#4E9A88',

  // PLACEHOLDER
  secondary: '#F2A93B',

  // Neutral scale. Safe to keep as-is, these are not brand-specific.
  ink: '#1A1D1F',
  inkMuted: '#6B7280',
  surface: '#FFFFFF',
  surfaceAlt: '#F7F8F9',
  border: '#E5E7EB',
};

/**
 * Verification verdict colours.
 *
 * These are deliberately NOT green / red. The whole point of D-001 is that the system does
 * not claim certainty, and a green tick undoes that in the UI no matter what the copy says.
 * `auto_verified` reads as a confident neutral, `needs_review` as an amber that invites
 * attention rather than alarm.
 *
 * The strings shown next to these are always "consistent with a genuine visit", never
 * "verified". Do not let the UI overstate what the engine can support.
 */
export const verdictPalette = {
  auto_verified: { main: brand.primary, contrastText: '#FFFFFF' },
  needs_review: { main: '#B7791F', contrastText: '#FFFFFF' },
  rejected: { main: '#9B2C2C', contrastText: '#FFFFFF' },
} as const;

const options: ThemeOptions = {
  direction: 'ltr', // flipped to 'rtl' by the locale provider on the Arabic pass

  palette: {
    mode: 'light',
    primary: {
      main: brand.primary,
      dark: brand.primaryDark,
      light: brand.primaryLight,
      contrastText: '#FFFFFF',
    },
    secondary: { main: brand.secondary },
    background: { default: brand.surfaceAlt, paper: brand.surface },
    text: { primary: brand.ink, secondary: brand.inkMuted },
    divider: brand.border,
  },

  typography: {
    // PLACEHOLDER: replace the first entry with theQA's real family. Keep an Arabic
    // family in the stack, the participant screens get an Arabic pass.
    fontFamily: [
      'Inter',
      '"IBM Plex Sans Arabic"',
      'system-ui',
      '-apple-system',
      'sans-serif',
    ].join(','),
    h1: { fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.01em' },
    h3: { fontSize: '1.25rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },

  shape: {
    // PLACEHOLDER: match theirs. See the note at the top.
    borderRadius: 12,
  },

  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 999, paddingInline: 20, paddingBlock: 10 },
        // The participant's primary action is "start visit" and later "end visit",
        // both of which need to be unmissable on a phone held one-handed in a shop.
        sizeLarge: { minHeight: 56, fontSize: '1rem' },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { border: `1px solid ${brand.border}` },
      },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 600 } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: { borderBottom: `1px solid ${brand.border}` },
      },
    },
  },
};

export const theme = createTheme(options);
export default theme;
