import { Chip, Tooltip } from '@mui/material';
import type { Verdict } from '@msp/shared';
import { verdictPalette } from '../theme/theme.js';

/**
 * Deliberately not green/red, and deliberately not the word "verified".
 *
 * D-001 is that the system does not claim to prove presence. A green tick undoes that in the
 * UI no matter what the copy says, so `auto_verified` reads as a confident neutral and the
 * label says "consistent with a genuine visit" rather than "verified".
 */
const LABEL: Record<Verdict, string> = {
  auto_verified: 'Consistent with a genuine visit',
  needs_review: 'Needs review',
  rejected: 'Not supported by the evidence',
};

const EXPLAIN: Record<Verdict, string> = {
  auto_verified: 'The evidence is consistent with a real visit. This is not proof of presence.',
  needs_review: 'The evidence is ambiguous. A human decides.',
  rejected: 'The evidence does not support this visit having taken place as described.',
};

export function VerdictChip({ verdict, score }: { verdict: Verdict | null; score?: number | null }) {
  if (!verdict) {
    return <Chip size="small" label="Awaiting verification" variant="outlined" />;
  }
  const c = verdictPalette[verdict];
  return (
    <Tooltip title={EXPLAIN[verdict]}>
      <Chip
        size="small"
        label={score == null ? LABEL[verdict] : `${LABEL[verdict]} · ${score}`}
        sx={{ bgcolor: c.main, color: c.contrastText }}
      />
    </Tooltip>
  );
}
