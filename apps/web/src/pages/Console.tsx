import {
  Alert,
  AppBar,
  Badge,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Drawer,
  LinearProgress,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material';
import type { Verdict } from '@msp/shared';
import type { TranslationKey } from '../i18n/strings.js';
import { useCallback, useEffect, useState } from 'react';
import { api, type VisitDetail, type VisitRow } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { VerdictChip } from '../components/VerdictChip.js';
import { useT } from '../i18n/LocaleContext.js';
import { useVisitStream, type VisitEvent } from '../hooks/useVisitStream.js';
import { Dashboard } from './Dashboard.js';
import { People } from './People.js';
import { TasksTab } from './TasksTab.js';

type Filter = 'all' | Verdict;

/** Labels come from the dictionary at render time, so the key is what is stable here. */
const FILTERS: { key: Filter; label: TranslationKey }[] = [
  { key: 'all', label: 'console.filters.all' },
  { key: 'needs_review', label: 'console.filters.needsReview' },
  { key: 'auto_verified', label: 'console.filters.autoVerified' },
  { key: 'rejected', label: 'console.filters.rejected' },
];

export function Console() {
  const { user, logout } = useAuth();
  const t = useT();
  const [tab, setTab] = useState<'overview' | 'visits' | 'people' | 'tasks'>('overview');
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  /** Sessions that arrived over the stream this session, so they can be highlighted. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, c] = await Promise.all([
        api.visits(filter === 'all' ? undefined : filter),
        api.counts(),
      ]);
      setRows(list);
      setCounts(c);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * A visit arriving over SSE.
   *
   * The row is prepended from the event payload rather than triggering a refetch: the event
   * carries everything a row needs, so the list updates with no request at all. That is what
   * "appears automatically, no manual refresh or trigger" actually means (D-004).
   */
  const onVisit = useCallback(
    (e: VisitEvent) => {
      setCounts((c) => ({
        ...c,
        all: (c.all ?? 0) + 1,
        [e.verdict]: (c[e.verdict] ?? 0) + 1,
      }));
      setFresh((s) => new Set(s).add(e.sessionId));
      setRows((prev) => {
        if (filter !== 'all' && filter !== e.verdict) return prev;
        if (prev.some((r) => r.sessionId === e.sessionId)) return prev;
        return [
          {
            sessionId: e.sessionId,
            venueName: e.venueName,
            participantId: e.participantId,
            endedAt: e.endedAt,
            verdict: e.verdict,
            score: e.score,
          },
          ...prev,
        ];
      });
    },
    [filter],
  );

  const status = useVisitStream(onVisit);

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
      <AppBar position="sticky">
        {/*
          The toolbar had five items competing for a 360 px phone: title, status, name and two
          buttons. The name is the one a signed-in user least needs to be told, so it is the
          first thing to go, and the status chip keeps its colour while losing its word.
        */}
        <Toolbar sx={{ gap: { xs: 1, sm: 2 }, minHeight: { xs: 56, sm: 64 } }}>
          <Typography
            variant="h3"
            sx={{ fontSize: { xs: '1rem', sm: '1.1rem' }, flexGrow: 1, minWidth: 0 }}
            noWrap
          >
            {t('console.title')}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            color={status === 'live' ? 'success' : status === 'stopped' ? 'default' : 'warning'}
            label={
              status === 'live'
                ? t('console.live')
                : status === 'reconnecting'
                  ? t('console.reconnecting')
                  : t('console.stopped')
            }
            sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
          />
          {/* On a phone the status survives as a dot rather than disappearing entirely. */}
          <Box
            aria-label={status}
            sx={{
              display: { xs: 'block', sm: 'none' },
              width: 8,
              height: 8,
              borderRadius: '50%',
              flexShrink: 0,
              bgcolor:
                status === 'live'
                  ? 'success.main'
                  : status === 'stopped'
                    ? 'text.disabled'
                    : 'warning.main',
            }}
          />
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ display: { xs: 'none', md: 'block' } }}
            noWrap
          >
            {user?.displayName}
          </Typography>
          <Button size="small" onClick={logout} sx={{ flexShrink: 0 }}>
            {t('common.signOut')}
          </Button>
        </Toolbar>
      </AppBar>

      <Container
        maxWidth="lg"
        sx={{
          px: { xs: 1.5, sm: 3 },
          py: { xs: 2, sm: 3 },
          pb: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
        }}
      >
        {/*
          Two surfaces for the same user: reading verdicts, and authoring the work that
          produces them. Tabs rather than routes, because App.tsx routes by role and there is
          no URL worth sharing -- every screen is scoped to the signed-in account anyway.
        */}
        <Tabs
          value={tab}
          onChange={(_e, v: 'overview' | 'visits' | 'people' | 'tasks') => setTab(v)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ mb: 2 }}
        >
          <Tab value="overview" label={t('console.dashboard.tabOverview')} />
          <Tab value="visits" label={t('console.tabVisits')} />
          <Tab value="people" label={t('console.people.tab')} />
          <Tab value="tasks" label={t('console.tabTasks')} />
        </Tabs>

        {tab === 'overview' && <Dashboard />}
        {tab === 'people' && <People />}
        {tab === 'tasks' && <TasksTab />}

        {tab === 'visits' && (
        <>
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('console.disclaimer')}
        </Alert>

        {/*
          A horizontal scroller on a phone rather than a three-line wrap. Four filter chips with
          badges wrapped to three rows at 360 px and pushed the table below the fold.
        */}
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            mb: 2,
            flexWrap: { xs: 'nowrap', sm: 'wrap' },
            overflowX: { xs: 'auto', sm: 'visible' },
            pb: { xs: 1, sm: 0 },
            alignItems: 'center',
            '&::-webkit-scrollbar': { display: 'none' },
            scrollbarWidth: 'none',
          }}
        >
          {FILTERS.map((f) => (
            <Badge
              key={f.key}
              badgeContent={counts[f.key === 'all' ? 'all' : f.key] ?? 0}
              color="primary"
              showZero
            >
              <Chip
                label={t(f.label)}
                onClick={() => setFilter(f.key)}
                variant={filter === f.key ? 'filled' : 'outlined'}
                color={filter === f.key ? 'primary' : 'default'}
                sx={{ whiteSpace: 'nowrap' }}
              />
            </Badge>
          ))}
          <Box sx={{ flexGrow: 1 }} />
          <Button size="small" onClick={() => void load()}>
            {t('common.refresh')}
          </Button>
        </Stack>

        {loading && <LinearProgress sx={{ mb: 1 }} />}

        {/*
          Two presentations of one list. A four-column table is right on a laptop and unusable
          on a 360 px phone -- the venue name and the verdict, the only two columns anyone scans
          for, end up squeezed to a few characters each or pushed off a horizontal scroll nobody
          discovers. Below `sm` the same rows render as cards.
        */}
        <Box sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('console.table.venue')}</TableCell>
                <TableCell>{t('console.table.participant')}</TableCell>
                <TableCell>{t('console.table.ended')}</TableCell>
                <TableCell>{t('console.table.verdict')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.sessionId}
                  hover
                  onClick={() => setSelected(r.sessionId)}
                  sx={{
                    cursor: 'pointer',
                    bgcolor: fresh.has(r.sessionId) ? 'action.hover' : undefined,
                  }}
                >
                  <TableCell>{r.venueName}</TableCell>
                  <TableCell>{r.participantId}</TableCell>
                  <TableCell>{r.endedAt ? new Date(r.endedAt).toLocaleString() : '—'}</TableCell>
                  <TableCell>
                    <VerdictChip verdict={r.verdict} score={r.score} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>

        <Stack spacing={1} sx={{ display: { xs: 'flex', sm: 'none' } }}>
          {rows.map((r) => (
            <Card
              key={r.sessionId}
              onClick={() => setSelected(r.sessionId)}
              sx={{
                cursor: 'pointer',
                borderColor: fresh.has(r.sessionId) ? 'primary.main' : undefined,
                bgcolor: fresh.has(r.sessionId) ? 'action.hover' : undefined,
              }}
            >
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="h3" sx={{ fontSize: '0.95rem', mb: 0.75 }}>
                  {r.venueName}
                </Typography>
                <Box sx={{ mb: 1 }}>
                  <VerdictChip verdict={r.verdict} score={r.score} />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {r.participantId}
                  {r.endedAt && ` · ${new Date(r.endedAt).toLocaleString()}`}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>

        {!loading && rows.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>
            {t('console.table.empty')}
          </Typography>
        )}

        </>
        )}
      </Container>

      <Drawer
        anchor="right"
        open={selected !== null}
        onClose={() => setSelected(null)}
        // MUI v9 replaced PaperProps with slotProps.paper.
        // Full-bleed on a phone with room for the notch; a panel on anything wider.
        slotProps={{
          paper: {
            sx: {
              width: { xs: '100%', sm: 520 },
              pt: 'env(safe-area-inset-top, 0px)',
              pb: 'env(safe-area-inset-bottom, 0px)',
            },
          },
        }}
      >
        {selected && <VisitDetailPanel sessionId={selected} onDone={() => void load()} />}
      </Drawer>
    </Box>
  );
}

/** The evidence trail. This is what makes a verdict defensible to a disputing participant. */
function VisitDetailPanel({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const [d, setD] = useState<VisitDetail | null>(null);
  const [note, setNote] = useState('');
  /**
   * Written FOR the participant, and the only part of a review they will ever read (D-034).
   *
   * Held separately from `note` all the way through, rather than being one box with a
   * checkbox. The reviewer needs to know which audience they are addressing while they type,
   * not after: `note` is the internal reason and stays candid because it is what makes a
   * review queue useful six months later, and candour is the first thing lost when the subject
   * can read it.
   */
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  const load = useCallback(() => {
    api
      .visit(sessionId)
      .then(setD)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t('common.failedToLoad')));
  }, [sessionId]);

  useEffect(load, [load]);

  const review = async (decision: 'approve' | 'reject'): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.review(sessionId, decision, note, feedback);
      setNote('');
      setFeedback('');
      load();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('console.review.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  if (!d) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h3" sx={{ fontSize: { xs: '1.15rem', sm: '1.25rem' } }} gutterBottom>
        {d.venueName}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} useFlexGap>
        <VerdictChip verdict={d.verdict} score={d.score} />
        {d.engineVersion && (
          <Chip
            size="small"
            variant="outlined"
            label={t('console.detail.engine', { version: d.engineVersion })}
          />
        )}
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {d.participantId} · {d.startedAt ? new Date(d.startedAt).toLocaleString() : '—'} →{' '}
        {d.endedAt ? new Date(d.endedAt).toLocaleTimeString() : '—'}
      </Typography>

      <Divider sx={{ my: 2 }} />

      <Typography variant="h3" sx={{ fontSize: '1rem', mb: 1 }}>
        {t('console.detail.whyTitle')}
      </Typography>
      <Stack spacing={1}>
        {d.signals.map((s) => (
          <Box key={s.code} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
            <Chip
              size="small"
              label={s.contribution > 0 ? `+${s.contribution}` : String(s.contribution)}
              color={s.contribution > 0 ? 'default' : 'warning'}
              variant="outlined"
              sx={{ minWidth: 56, fontVariantNumeric: 'tabular-nums' }}
            />
            <Typography variant="body2">{s.reason}</Typography>
          </Box>
        ))}
        {d.signals.length === 0 && (
          <Typography color="text.secondary" variant="body2">
            {t('console.detail.notVerifiedYet')}
          </Typography>
        )}
      </Stack>

      {d.rollups && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="h3" sx={{ fontSize: '1rem', mb: 1 }}>
            {t('console.detail.observedTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('console.detail.fixes', { count: d.rollups.fixCount })} ·{' '}
            {t('console.detail.minutesInside', {
              minutes: Math.round(d.rollups.dwellSeconds / 60),
            })}{' '}
            · {t('console.detail.observedPercent', {
              percent: Math.round(d.rollups.coverageRatio * 100),
            })}
            {d.rollups.minDistanceM !== null &&
              ` · ${t('console.detail.closest', { metres: Math.round(d.rollups.minDistanceM) })}`}
            {d.rollups.unusableFixCount > 0 &&
              ` · ${t('console.detail.unusable', { count: d.rollups.unusableFixCount })}`}
          </Typography>
        </>
      )}

      {d.report && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="h3" sx={{ fontSize: '1rem', mb: 1 }}>
            {t('console.detail.reportTitle', { rating: d.report.rating })}
          </Typography>
          <Typography variant="body2">{d.report.notes}</Typography>
          <EvidenceImage evidenceKey={d.report.evidenceKey} />
        </>
      )}

      <Divider sx={{ my: 2 }} />
      {d.review ? (
        <Alert severity="info">
          {t('console.review.recorded', {
            decision: d.review.decision,
            reviewer: d.review.reviewerId,
            note: d.review.note,
          })}
          {/*
            Shown back, and labelled as shared. A reviewer returning to a visit needs to be
            able to tell what the participant was told from what stayed internal -- otherwise
            the only way to find out is to ask them.
          */}
          {d.review.feedbackToParticipant && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {t('console.review.feedbackSent')}
              </Typography>
              <Typography variant="body2">{d.review.feedbackToParticipant}</Typography>
            </Box>
          )}
        </Alert>
      ) : (
        <>
          <Typography variant="h3" sx={{ fontSize: '1rem', mb: 1 }}>
            {t('console.review.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t('console.review.explain')}
          </Typography>
          <TextField
            label={t('console.review.note')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            sx={{ mb: 1.5 }}
          />
          {/*
            Optional on purpose. A reviewer with nothing useful to say to the participant should
            leave this empty rather than pad it, which is the opposite of the required note
            above -- an override with no stated internal reason is the thing that makes the
            queue useless later.
          */}
          <TextField
            label={t('console.review.feedback')}
            helperText={t('console.review.feedbackHint')}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            sx={{ mb: 1.5 }}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              variant="contained"
              disabled={busy || note.trim().length < 10}
              onClick={() => void review('approve')}
            >
              {t('console.review.approve')}
            </Button>
            <Button
              variant="outlined"
              color="error"
              disabled={busy || note.trim().length < 10}
              onClick={() => void review('reject')}
            >
              {t('console.review.reject')}
            </Button>
          </Stack>
        </>
      )}
    </Box>
  );
}

/**
 * The attached photo, if there is one.
 *
 * Fetched with the token and turned into an object URL rather than pointed at with `<img src>`:
 * the read route is role- and tenancy-guarded, and a bare URL carries no Authorization header.
 * That is also why the image cannot leak by someone sharing the link.
 */
function EvidenceImage({ evidenceKey }: { evidenceKey: string | null }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    if (!evidenceKey) return;
    let revoked = false;
    let objectUrl: string | null = null;
    setState('loading');
    api
      .evidenceObjectUrl(evidenceKey)
      .then((u) => {
        objectUrl = u;
        // The drawer can close mid-flight; without this the URL is created and never revoked.
        if (revoked) {
          URL.revokeObjectURL(u);
          return;
        }
        setUrl(u);
        setState('idle');
      })
      .catch(() => setState('error'));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [evidenceKey]);

  if (!evidenceKey) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        {t('console.detail.noEvidence')}
      </Typography>
    );
  }
  if (state === 'error') {
    return (
      <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
        {t('console.detail.evidenceFailed')}
      </Typography>
    );
  }
  if (!url) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        {t('console.detail.evidenceLoading')}
      </Typography>
    );
  }
  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {t('console.detail.evidenceTitle')}
      </Typography>
      <Box
        component="img"
        src={url}
        alt=""
        sx={{ display: 'block', width: '100%', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
      />
    </Box>
  );
}
