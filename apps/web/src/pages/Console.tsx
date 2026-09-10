import {
  Alert,
  AppBar,
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
  ToggleButton,
  ToggleButtonGroup,
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
import { qa, verdictPalette } from '../theme/theme.js';
import { Dashboard } from './Dashboard.js';
import { People } from './People.js';
import { AccountsTab } from './AccountsTab.js';
import { TasksTab } from './TasksTab.js';

type Filter = 'all' | Verdict;

/** Labels come from the dictionary at render time, so the key is what is stable here. */
const FILTERS: { key: Filter; label: TranslationKey }[] = [
  { key: 'all', label: 'console.filters.all' },
  { key: 'needs_review', label: 'console.filters.needsReview' },
  { key: 'auto_verified', label: 'console.filters.autoVerified' },
  { key: 'rejected', label: 'console.filters.rejected' },
];

/**
 * The verdict, in as few words as a table column can carry.
 *
 * Deliberately the SAME strings as the filters rather than new keys. `verdict.auto_verified` is
 * a whole sentence — "Consistent with a genuine visit" — which is right on a chip with a tooltip
 * and wrong in a column the eye scans vertically. The filter labels are already the short form
 * of exactly these three states, and giving them a second set of keys would mean two places to
 * keep a translation honest.
 */
const SHORT_LABEL: Record<Verdict, TranslationKey> = {
  auto_verified: 'console.filters.autoVerified',
  needs_review: 'console.filters.needsReview',
  rejected: 'console.filters.rejected',
};

/**
 * The verdict as a dot and a word, for the table.
 *
 * A filled chip per row turned the column into a stack of coloured blocks that read as a bar
 * chart of nothing. The dot carries the same three colours at a size that does not compete with
 * the venue name.
 *
 * `null` is not a fourth verdict, it is the absence of one — a session the evaluator has not
 * reached yet — so it renders hollow. Filling it in any colour would make "we have not looked"
 * look like an answer.
 */
function VerdictDot({ verdict }: { verdict: Verdict | null }) {
  const t = useT();
  const colour = verdict ? verdictPalette[verdict].main : null;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box
        sx={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          flexShrink: 0,
          bgcolor: colour ?? 'transparent',
          border: colour ? undefined : `1.5px solid ${qa.neutral[400]}`,
        }}
      />
      <Typography
        variant="body2"
        noWrap
        sx={{
          fontWeight: verdict ? 500 : 400,
          color: verdict ? 'text.primary' : 'text.secondary',
        }}
      >
        {t(verdict ? SHORT_LABEL[verdict] : 'verdict.pending')}
      </Typography>
    </Stack>
  );
}

/**
 * The one question this screen answers before any other: is anything waiting on me?
 *
 * This replaces a permanent info `Alert` that restated the disclaimer on every single load. A
 * standing caveat is not news, and putting it where the day's work should be meant the screen
 * opened with four filter chips, five tabs and a paragraph, all at the same weight, and no
 * answer. The review queue is the only thing here that is genuinely addressed to the reader.
 *
 * It renders in the cleared state too rather than disappearing. A band that vanishes when the
 * queue empties leaves the reader unsure whether they are done or whether it failed to load.
 */
function AttentionBand({ count, onReview }: { count: number; onReview: () => void }) {
  const t = useT();
  const clear = count === 0;

  return (
    <Card
      sx={{
        mb: 2,
        borderLeft: `3px solid ${clear ? verdictPalette.auto_verified.main : verdictPalette.needs_review.main}`,
        bgcolor: clear ? qa.teal[50] : qa.yellow[50],
      }}
    >
      <CardContent
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          flexDirection: { xs: 'column', sm: 'row' },
          gap: 2,
          p: { xs: 1.75, sm: 2.25 },
          '&:last-child': { pb: { xs: 1.75, sm: 2.25 } },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.25 }}>
            {clear
              ? t('console.attention.clearTitle')
              : count === 1
                ? t('console.attention.one')
                : t('console.attention.many', { count })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {clear ? t('console.attention.clearHint') : t('console.attention.hint')}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        {!clear && (
          <Button variant="contained" onClick={onReview} sx={{ flexShrink: 0 }}>
            {t('console.attention.action')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function Console() {
  const { user, logout } = useAuth();
  const t = useT();
  const [tab, setTab] = useState<'overview' | 'visits' | 'people' | 'tasks' | 'accounts'>(
    'overview',
  );
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
          onChange={(_e, v: 'overview' | 'visits' | 'people' | 'tasks' | 'accounts') => setTab(v)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ mb: 2 }}
        >
          <Tab value="overview" label={t('console.dashboard.tabOverview')} />
          <Tab value="visits" label={t('console.tabVisits')} />
          <Tab value="people" label={t('console.people.tab')} />
          <Tab value="tasks" label={t('console.tabTasks')} />
          {/*
            Last, because it is the least-used tab: accounts are created once and then not
            looked at, whereas the visit feed is read every day. "Accounts" and not "People" --
            the People tab answers a different question (who needs looking at) and merging the
            two would put results and sign-ins on one screen.
          */}
          <Tab value="accounts" label={t('console.accounts.tab')} />
        </Tabs>

        {tab === 'overview' && <Dashboard />}
        {tab === 'people' && <People />}
        {tab === 'tasks' && <TasksTab />}
        {tab === 'accounts' && <AccountsTab />}

        {tab === 'visits' && (
        <>
        <AttentionBand
          count={counts['needs_review'] ?? 0}
          onReview={() => setFilter('needs_review')}
        />

        {/*
          A segmented control rather than four badged chips.

          The badges were the problem: a count bubble on every option made four things shout when
          only one of them is a queue anybody acts on, and at 360 px they wrapped to three rows
          and pushed the table below the fold. The counts are still here, inline and quiet, and
          the group still scrolls sideways on a phone rather than wrapping.
        */}
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{
            mb: 2,
            alignItems: 'center',
            overflowX: { xs: 'auto', sm: 'visible' },
            pb: { xs: 1, sm: 0 },
            '&::-webkit-scrollbar': { display: 'none' },
            scrollbarWidth: 'none',
          }}
        >
          <ToggleButtonGroup
            exclusive
            size="small"
            value={filter}
            // `null` arrives when the active button is clicked again. Clearing the filter that
            // way would leave no button selected and the table showing everything, which is a
            // state the segmented control cannot represent.
            onChange={(_e, v: Filter | null) => v !== null && setFilter(v)}
            sx={{
              flexShrink: 0,
              bgcolor: qa.neutral[100],
              borderRadius: `${qa.radius.sm + 2}px`,
              p: '3px',
              gap: '2px',
              '& .MuiToggleButtonGroup-grouped': {
                border: 0,
                borderRadius: `${qa.radius.sm}px !important`,
                textTransform: 'none',
                fontWeight: 500,
                color: 'text.secondary',
                px: 1.75,
                py: 0.75,
                whiteSpace: 'nowrap',
                '&.Mui-selected': {
                  bgcolor: 'background.paper',
                  color: 'text.primary',
                  fontWeight: 600,
                  boxShadow: 1,
                  '&:hover': { bgcolor: 'background.paper' },
                },
              },
            }}
          >
            {FILTERS.map((f) => (
              <ToggleButton key={f.key} value={f.key}>
                {t(f.label)}
                <Box
                  component="span"
                  sx={{
                    ml: 0.75,
                    fontVariantNumeric: 'tabular-nums',
                    // The queue's own count keeps its colour when it is not the active tab --
                    // it is the one number worth noticing from across the row.
                    color:
                      f.key === 'needs_review' && (counts[f.key] ?? 0) > 0
                        ? verdictPalette.needs_review.main
                        : 'text.disabled',
                    fontWeight: f.key === 'needs_review' && (counts[f.key] ?? 0) > 0 ? 600 : 500,
                  }}
                >
                  {counts[f.key] ?? 0}
                </Box>
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Box sx={{ flexGrow: 1 }} />
          <Button size="small" onClick={() => void load()} sx={{ flexShrink: 0 }}>
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
        {/*
          Hidden entirely when there is nothing in it. A framed table showing a header row and a
          disclaimer over empty space reads as broken, where the empty-state sentence below reads
          as an answer.
        */}
        {rows.length > 0 && (
        <Card sx={{ display: { xs: 'none', sm: 'block' }, overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {/* Empty header over the verdict rail. It is a colour, not a column. */}
                  <TableCell sx={{ width: 3, p: 0, border: 0 }} />
                  <TableCell>{t('console.table.venue')}</TableCell>
                  <TableCell>{t('console.table.participant')}</TableCell>
                  <TableCell>{t('console.table.ended')}</TableCell>
                  <TableCell>{t('console.table.verdict')}</TableCell>
                  <TableCell align="right">{t('console.table.score')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.sessionId}
                    hover
                    onClick={() => setSelected(r.sessionId)}
                    selected={selected === r.sessionId}
                    sx={{ cursor: 'pointer' }}
                  >
                    {/*
                      The verdict as a rail on the row's leading edge. `borderLeft` on the row
                      itself is dropped by MUI's collapsed borders, so it lives on the first
                      cell — which is why that cell exists at all.
                    */}
                    <TableCell
                      sx={{
                        width: 3,
                        p: 0,
                        borderBottom: 0,
                        bgcolor: r.verdict ? verdictPalette[r.verdict].main : qa.neutral[200],
                      }}
                    />
                    <TableCell sx={{ fontWeight: 600 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Box component="span" sx={{ minWidth: 0 }}>
                          {r.venueName}
                        </Box>
                        {/*
                          Arrived over the stream while this screen was open. A ring and a word
                          rather than a filled row: "new" is about when it got here, and the row
                          already spends colour on saying what the verdict is.
                        */}
                        {fresh.has(r.sessionId) && (
                          <Chip
                            size="small"
                            label={t('console.table.new')}
                            sx={{
                              height: 18,
                              fontSize: '0.65rem',
                              bgcolor: qa.teal[100],
                              color: 'primary.main',
                            }}
                          />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{r.participantId}</TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                      {r.endedAt ? (
                        new Date(r.endedAt).toLocaleString()
                      ) : (
                        // A session with no end is still running, which is a different thing
                        // from a missing value. An em dash here read as "we lost it".
                        <Box component="span" sx={{ color: 'text.disabled' }}>
                          {t('console.table.running')}
                        </Box>
                      )}
                    </TableCell>
                    <TableCell>
                      <VerdictDot verdict={r.verdict} />
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 600,
                        fontSize: '0.95rem',
                        color: r.verdict ? verdictPalette[r.verdict].main : 'text.disabled',
                      }}
                    >
                      {r.score ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          {/*
            The disclaimer, demoted from a full-width Alert above the fold to a footnote under
            the thing it qualifies. It is a standing caveat about how to read this table, not
            news, and it was costing the top of the screen on every load.
          */}
          <Box
            sx={{
              px: 2.5,
              py: 1.5,
              borderTop: `1px solid ${qa.neutral[100]}`,
              bgcolor: 'background.default',
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {t('console.disclaimer')}
            </Typography>
          </Box>
        </Card>
        )}

        <Stack spacing={1} sx={{ display: { xs: 'flex', sm: 'none' } }}>
          {rows.map((r) => (
            <Card
              key={r.sessionId}
              onClick={() => setSelected(r.sessionId)}
              sx={{
                cursor: 'pointer',
                // Same rail as the table, on the card's leading edge. `borderInlineStart` and
                // not `borderLeft`, because these screens flip under the Arabic pass (D-022).
                borderInlineStart: `3px solid ${
                  r.verdict ? verdictPalette[r.verdict].main : qa.neutral[200]
                }`,
                borderColor: fresh.has(r.sessionId) ? 'primary.main' : undefined,
              }}
            >
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', mb: 0.75 }}>
                  <Typography variant="h3" sx={{ fontSize: '0.95rem', flexGrow: 1, minWidth: 0 }}>
                    {r.venueName}
                  </Typography>
                  {/* The score keeps the verdict's colour, so the card reads at a glance. */}
                  {r.score !== null && (
                    <Typography
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 700,
                        fontSize: '1.05rem',
                        lineHeight: 1.2,
                        flexShrink: 0,
                        color: r.verdict ? verdictPalette[r.verdict].main : 'text.disabled',
                      }}
                    >
                      {r.score}
                    </Typography>
                  )}
                </Stack>
                {/*
                  The chip survives here, unlike in the table. A card has room for the full
                  sentence and no column of siblings for a filled block to compete with.
                */}
                <Box sx={{ mb: 1 }}>
                  <VerdictChip verdict={r.verdict} />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {r.participantId}
                  {r.endedAt
                    ? ` · ${new Date(r.endedAt).toLocaleString()}`
                    : ` · ${t('console.table.running')}`}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>

        {/* The desktop footnote lives inside the table Card, which a phone never renders. */}
        {rows.length > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: { xs: 'block', sm: 'none' }, mt: 2 }}
          >
            {t('console.disclaimer')}
          </Typography>
        )}

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
