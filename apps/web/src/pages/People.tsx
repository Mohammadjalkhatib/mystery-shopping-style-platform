import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { api, type ParticipantStats } from '../api/client.js';
import { useT } from '../i18n/LocaleContext.js';
import { verdictChartPalette } from '../theme/theme.js';

/**
 * Results per participant, worst pass rate first.
 *
 * The question this answers is "who needs looking at", and the banner says so — because the
 * question people actually ask is "who is cheating", and this system cannot answer that
 * (D-001). A run of rejections is equally consistent with a participant inventing visits, a
 * venue saved at the wrong coordinate (which has happened here — D-020), and a phone whose GPS
 * is poor indoors. The `topSignal` column is the part that separates those: `proximity`
 * failing every time is a different investigation from `coverage` failing every time.
 */
export function People() {
  const t = useT();
  const [rows, setRows] = useState<ParticipantStats[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api.participantStats(30));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !rows) {
    return (
      <Box sx={{ p: 6, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!rows) return null;

  return (
    <Stack spacing={{ xs: 2, sm: 3 }}>
      <Box>
        <Typography variant="h3" sx={{ fontSize: '1.05rem' }}>
          {t('console.people.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('console.people.subtitle')}
        </Typography>
      </Box>

      {/*
        Not a disclaimer for its own sake. Handing someone a ranked list of people and a column
        called "rejected" invites exactly one conclusion, and the system does not support it.
      */}
      <Alert severity="info">{t('console.people.notCheating')}</Alert>

      {rows.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">{t('console.people.empty')}</Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('console.people.participant')}</TableCell>
                  <TableCell align="right">{t('console.people.visits')}</TableCell>
                  <TableCell sx={{ minWidth: 160 }}>{t('console.people.outcomes')}</TableCell>
                  <TableCell align="right">{t('console.people.passRate')}</TableCell>
                  <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    {t('console.people.medianScore')}
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                    {t('console.people.topIssue')}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.participantId}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {r.displayName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {r.participantId}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.visits}
                    </TableCell>
                    <TableCell>
                      <OutcomeBar row={r} />
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                    >
                      {Math.round(r.passRate * 100)}%
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        display: { xs: 'none', md: 'table-cell' },
                      }}
                    >
                      {r.medianScore === null ? '—' : Math.round(r.medianScore)}
                    </TableCell>
                    <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                      {r.topSignal ? (
                        <Tooltip
                          title={t('console.people.topIssueHint', { count: r.topSignal.visits })}
                          arrow
                        >
                          <Chip size="small" variant="outlined" label={r.topSignal.code} />
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}
    </Stack>
  );
}

/**
 * The three outcomes as one bar.
 *
 * A stacked proportion rather than three numbers: the useful comparison between two people is
 * the SHAPE of their results, and three columns of integers make that arithmetic the reader's
 * job. Segments are separated by a 2px gap so adjacent colours never touch, which is what keeps
 * the boundary readable without relying on hue.
 */
function OutcomeBar({ row }: { row: ParticipantStats }) {
  const t = useT();
  const total = Math.max(1, row.visits);
  const parts = [
    { key: 'auto_verified' as const, n: row.auto_verified, label: t('console.dashboard.autoVerified') },
    { key: 'needs_review' as const, n: row.needs_review, label: t('console.dashboard.needsReview') },
    { key: 'rejected' as const, n: row.rejected, label: t('console.dashboard.rejected') },
  ];

  return (
    <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', minWidth: 140 }}>
      {parts.map((p) =>
        p.n === 0 ? null : (
          <Tooltip key={p.key} title={`${p.label}: ${p.n}`} arrow>
            <Box
              sx={{
                flexGrow: p.n / total,
                height: 10,
                borderRadius: '5px',
                bgcolor: verdictChartPalette[p.key],
                minWidth: 6,
              }}
            />
          </Tooltip>
        ),
      )}
    </Stack>
  );
}
