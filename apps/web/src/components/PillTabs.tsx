import { Tab, Tabs } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { qa } from '../theme/theme.js';

/**
 * The app's section nav: MUI `Tabs`, restyled as tinted pills.
 *
 * Shared by the business console and the participant shell so the two surfaces navigate the
 * same way. It was written inline in `Console.tsx` first and extracted when the participant
 * shell needed the identical thing (D-048) -- a second copy of this `sx` block would have
 * drifted the moment either side was touched.
 *
 * **It stays MUI `Tabs` on purpose.** The pills are cosmetic: the indicator is hidden and the
 * selected state is a tint rather than an underline. What is NOT cosmetic is `role="tablist"`,
 * `aria-selected` and the arrow-key navigation between sections, all of which come free here and
 * would have to be rebuilt by hand on a row of `Button`s. Same call as keeping `Rating` over pill
 * buttons in D-046.
 *
 * `variant="scrollable"` rather than wrapping: a nav that wraps to a second row pushes the
 * content down for the life of the session, and on a 360 px phone that is a whole row of the
 * thing the user came to read.
 */
export function PillTabs<T extends string>({
  value,
  onChange,
  items,
  sx,
}: {
  value: T;
  onChange: (next: T) => void;
  /** `icon` is optional; the console runs label-only, the participant shell shows both. */
  items: { key: T; label: string; icon?: ReactElement }[];
  sx?: SxProps<Theme>;
}) {
  return (
    <Tabs
      value={value}
      onChange={(_e, v: T) => onChange(v)}
      variant="scrollable"
      allowScrollButtonsMobile
      sx={[
        {
          minHeight: 0,
          '& .MuiTabs-indicator': { display: 'none' },
          '& .MuiTabs-flexContainer': { gap: '2px' },
          '& .MuiTab-root': {
            minHeight: 0,
            minWidth: 0,
            px: 1.5,
            py: 0.75,
            borderRadius: `${qa.radius.sm}px`,
            textTransform: 'none',
            fontSize: '0.875rem',
            fontWeight: 500,
            color: 'text.secondary',
            transition: 'background-color 150ms',
            // A tab that carries an icon puts it beside the label rather than above it: the bar
            // is a row, and stacking would make this nav twice the height of the console's.
            '& .MuiTab-iconWrapper': { marginBottom: 0, marginInlineEnd: '6px' },
            flexDirection: 'row',
            '&:hover': { bgcolor: qa.neutral[100] },
            '&.Mui-selected': {
              color: 'primary.main',
              fontWeight: 600,
              bgcolor: qa.teal[100],
            },
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {items.map((x) => (
        <Tab key={x.key} value={x.key} label={x.label} icon={x.icon} iconPosition="start" />
      ))}
    </Tabs>
  );
}
