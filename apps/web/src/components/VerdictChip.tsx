import { Chip, Tooltip } from '@mui/material';
import type { Verdict } from '@msp/shared';
import { useT } from '../i18n/LocaleContext.js';
import type { TranslationKey } from '../i18n/strings.js';
import { verdictPalette } from '../theme/theme.js';

/**
 * Deliberately not green/red, and deliberately not the word "verified".
 *
 * D-001 is that the system does not claim to prove presence. A green tick undoes that in the
 * UI no matter what the copy says, so `auto_verified` reads as a confident neutral and the
 * label says "consistent with a genuine visit" rather than "verified".
 */
const LABEL: Record<Verdict, TranslationKey> = {
  auto_verified: 'verdict.auto_verified',
  needs_review: 'verdict.needs_review',
  rejected: 'verdict.rejected',
};

const EXPLAIN: Record<Verdict, TranslationKey> = {
  auto_verified: 'verdict.explainAuto',
  needs_review: 'verdict.explainReview',
  rejected: 'verdict.explainRejected',
};

export function VerdictChip({ verdict, score }: { verdict: Verdict | null; score?: number | null }) {
  const t = useT();
  if (!verdict) {
    return <Chip size="small" label={t('verdict.pending')} variant="outlined" />;
  }
  const c = verdictPalette[verdict];
  return (
    <Tooltip title={t(EXPLAIN[verdict])}>
      <Chip
        size="small"
        label={score == null ? t(LABEL[verdict]) : `${t(LABEL[verdict])} · ${score}`}
        sx={{ bgcolor: c.main, color: c.contrastText }}
      />
    </Tooltip>
  );
}
