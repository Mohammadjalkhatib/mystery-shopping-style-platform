import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Rating,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useEffect, useState } from 'react';
import type { ParticipantDashboard, ParticipantVisit } from '../api/client.js';
import { useT } from '../i18n/LocaleContext.js';
import type { TranslationKey } from '../i18n/strings.js';
import { OutcomeChip } from './OutcomeChip.js';

/**
 * The participant's own record: what they were given, what they filed, and what came back.
 *
 * This screen answers three questions and refuses a fourth. It answers "what have I been
 * asked to do", "what did I submit" and "what did they say" -- and it deliberately does not
 * answer "why did the engine score me that way", because the signals are the anti-spoof rules
 * and publishing them to the people being checked is a tutorial (D-034). If a participant
 * disputes an outcome, the answer is the reviewer's feedback, written by a person.
 *
 * Rows are accordions rather than a table. A table is the right shape for the console, which
 * is scanned across many visits on a wide screen; this is one person's handful of visits on a
 * phone, where the useful default is a legible summary line that opens into the detail.
 */
export function History({
  data,
  loading,
  error,
  expandSessionId,
}: {
  data: ParticipantDashboard | null;
  loading: boolean;
  error: string | null;
  /** Set when a notification was tapped, so the visit it referred to opens on arrival. */
  expandSessionId: string | null;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (expandSessionId) setExpanded(expandSessionId);
  }, [expandSessionId]);

  if (loading && !data) {
    return (
      <Box sx={{ p: 6, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && !data) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  if (!data || data.visits.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary">{t('participant.history.empty')}</Typography>
      </Box>
    );
  }

  const { summary, visits } = data;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 560, mx: 'auto' }}>
      <Typography variant="h1" sx={{ fontSize: '1.3rem', mb: 1.5 }}>
        {t('participant.history.title')}
      </Typography>

      {/*
        Four tiles, not eight. The participant's questions are "how much have I done", "how
        much is waiting on me", "how much is waiting on them" and "how am I doing" -- anything
        past that is a dashboard for its own sake on a screen the width of a hand.
      */}
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Tile label={t('participant.stats.assigned')} value={String(summary.assigned)} />
        <Tile label={t('participant.stats.openNow')} value={String(summary.openNow)} />
        <Tile label={t('participant.stats.inReview')} value={String(summary.inReview)} />
        <Tile
          label={t('participant.stats.approvalRate')}
          value={
            summary.approvalRate === null
              ? '—'
              : `${Math.round(summary.approvalRate * 100)}%`
          }
          hint={
            summary.approvalRate === null ? t('participant.stats.noRate') : undefined
          }
        />
      </Stack>

      {/*
        Said out loud when it is true, rather than left as a silently wrong total. The tiles
        above `assigned` are computed over the most recent page, so once a participant has more
        visits than that page holds, the two disagree and the screen has to admit it.
      */}
      {summary.countedOver < summary.assigned && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          {t('participant.history.countedOver', { count: summary.countedOver })}
        </Typography>
      )}

      {visits.map((v) => (
        <Accordion
          key={v.sessionId}
          expanded={expanded === v.sessionId}
          onChange={(_, isOpen) => setExpanded(isOpen ? v.sessionId : null)}
          disableGutters
          sx={{ mb: 1, border: 1, borderColor: 'divider', '&:before': { display: 'none' } }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack sx={{ minWidth: 0, flexGrow: 1 }}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Typography sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
                  {v.taskTitle}
                </Typography>
                <OutcomeChip outcome={v.outcome} />
              </Stack>
              <Typography variant="body2" color="text.secondary" noWrap>
                {v.venueName} ·{' '}
                {t('participant.history.assignedOn', { date: shortDate(v.assignedAt) })}
              </Typography>
            </Stack>
          </AccordionSummary>

          <AccordionDetails sx={{ pt: 0 }}>
            <VisitDetail visit={v} timeouts={data.timeouts} />
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card sx={{ flex: '1 1 45%', minWidth: 130 }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="h2" sx={{ fontSize: '1.5rem', fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function VisitDetail({
  visit: v,
  timeouts,
}: {
  visit: ParticipantVisit;
  timeouts: ParticipantDashboard['timeouts'];
}) {
  const t = useT();

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {v.taskBrief}
      </Typography>
      {v.venueAddress && (
        <Typography variant="body2" color="text.secondary">
          {v.venueAddress}
        </Typography>
      )}

      {/*
        The decision, and who made it. "Approved automatically" and "reviewed by a person" are
        different facts and a participant reading feedback deserves to know which they are
        looking at -- silence from a human reviewer is not the same as no human being involved.
      */}
      {(v.outcome === 'approved' || v.outcome === 'not_approved') && (
        <Alert severity={v.outcome === 'approved' ? 'success' : 'warning'}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: v.feedback ? 0.5 : 0 }}>
            {v.decidedByHuman
              ? t('participant.history.reviewedByPerson')
              : t('participant.history.autoApproved')}
          </Typography>
          {v.feedback ? (
            <Typography variant="body2">{v.feedback}</Typography>
          ) : (
            v.decidedByHuman && (
              <Typography variant="body2" color="text.secondary">
                {t('participant.history.noFeedback')}
              </Typography>
            )
          )}
          {v.decidedAt && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {t('participant.history.decidedOn', { date: shortDate(v.decidedAt) })}
            </Typography>
          )}
        </Alert>
      )}

      {v.outcome === 'in_review' && (
        <Alert severity="info">{t('participant.history.pendingExplain')}</Alert>
      )}

      {v.outcome === 'closed' && (
        <Alert severity="warning">{terminalText(t, v, timeouts)}</Alert>
      )}

      {v.report && (
        <>
          <Divider />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              {t('participant.history.yourReport')}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
              {/* Read-only: this is a record of what they filed, not a form. */}
              <Rating value={v.report.rating} readOnly size="small" />
              <Typography variant="caption" color="text.secondary">
                {t('participant.history.yourRating', { rating: v.report.rating })}
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {v.report.notes}
            </Typography>
          </Box>
        </>
      )}

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        {v.submittedAt && (
          <Chip
            size="small"
            variant="outlined"
            label={t('participant.history.submittedOn', { date: shortDate(v.submittedAt) })}
          />
        )}
      </Stack>
    </Stack>
  );
}

/** Locale-aware and short. `toLocaleDateString` already follows the document's language. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Why a closed visit closed, in the participant's own language.
 *
 * The same derivation the live visit screen uses, from `terminalReasonCode` rather than the
 * server's English prose (D-022). Duplicated deliberately in shape but not in strings: both
 * read the same four keys, so a change to the copy reaches both.
 */
function terminalText(
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  v: ParticipantVisit,
  timeouts: ParticipantDashboard['timeouts'],
): string {
  const { abandonMinutes: mins, hardCapHours: hours } = timeouts;
  switch (v.terminalReasonCode) {
    case 'never_started':
      return t('participant.ended.neverStarted', { mins });
    case 'went_quiet':
      return t('participant.ended.wentQuiet', { mins });
    case 'no_report':
      return t('participant.ended.noReport', { mins });
    case 'expired':
      return t('participant.ended.expired', { hours });
    default:
      return t('participant.ended.generic');
  }
}
