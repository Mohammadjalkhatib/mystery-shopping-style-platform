import { Chip } from '@mui/material';
import type { VisitOutcome } from '@msp/shared';
import { useT } from '../i18n/LocaleContext.js';
import type { TranslationKey } from '../i18n/strings.js';
import { verdictPalette } from '../theme/theme.js';

/**
 * What the participant is told about one visit.
 *
 * A different component from `VerdictChip`, and it must stay different. That one renders the
 * ENGINE's verdict for the business and carries a score; this one renders the RELEASED outcome
 * for the person who did the work and carries nothing else (D-034). Collapsing them would be
 * the shortest possible route to putting a score on a participant's screen.
 *
 * The same restraint as D-001 applies to the colours. `approved` uses the brand's confident
 * neutral rather than a green tick, and `not_approved` is a muted red that reads as a decision
 * rather than an accusation. The three in-flight states are outlined, not filled: they are
 * positions in a process, and filling them would give a waiting participant something that
 * looks like a result.
 */
const LABEL: Record<VisitOutcome, TranslationKey> = {
  not_started: 'participant.outcome.not_started',
  in_progress: 'participant.outcome.in_progress',
  awaiting_report: 'participant.outcome.awaiting_report',
  in_review: 'participant.outcome.in_review',
  approved: 'participant.outcome.approved',
  not_approved: 'participant.outcome.not_approved',
  closed: 'participant.outcome.closed',
};

export function OutcomeChip({ outcome, size = 'small' }: { outcome: VisitOutcome; size?: 'small' | 'medium' }) {
  const t = useT();
  const label = t(LABEL[outcome]);

  if (outcome === 'approved') {
    return (
      <Chip
        size={size}
        label={label}
        sx={{ bgcolor: verdictPalette.auto_verified.main, color: '#FFFFFF' }}
      />
    );
  }
  if (outcome === 'not_approved') {
    return (
      <Chip
        size={size}
        label={label}
        sx={{ bgcolor: verdictPalette.rejected.main, color: '#FFFFFF' }}
      />
    );
  }
  return <Chip size={size} label={label} variant="outlined" />;
}
