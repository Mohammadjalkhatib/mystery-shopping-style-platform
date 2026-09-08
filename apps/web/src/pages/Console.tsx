import {
  Alert,
  AppBar,
  Badge,
  Box,
  Button,
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
import { useCallback, useEffect, useState } from 'react';
import { api, type VisitDetail, type VisitRow } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { VerdictChip } from '../components/VerdictChip.js';
import { useVisitStream, type VisitEvent } from '../hooks/useVisitStream.js';
import { TasksTab } from './TasksTab.js';

type Filter = 'all' | Verdict;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All visits' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'auto_verified', label: 'Consistent' },
  { key: 'rejected', label: 'Not supported' },
];

export function Console() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<'visits' | 'tasks'>('visits');
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
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h3" sx={{ fontSize: '1.1rem', flexGrow: 1 }}>
            Visit console
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            color={status === 'live' ? 'success' : status === 'stopped' ? 'default' : 'warning'}
            label={status === 'live' ? 'Live' : status === 'reconnecting' ? 'Reconnecting…' : status}
          />
          <Typography variant="body2" color="text.secondary">
            {user?.displayName}
          </Typography>
          <Button size="small" onClick={logout}>
            Sign out
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        {/*
          Two surfaces for the same user: reading verdicts, and authoring the work that
          produces them. Tabs rather than routes, because App.tsx routes by role and there is
          no URL worth sharing -- every screen is scoped to the signed-in account anyway.
        */}
        <Tabs value={tab} onChange={(_e, v: 'visits' | 'tasks') => setTab(v)} sx={{ mb: 2 }}>
          <Tab value="visits" label="Visits" />
          <Tab value="tasks" label="Tasks" />
        </Tabs>

        {tab === 'tasks' && <TasksTab />}

        {tab === 'visits' && (
        <>
        <Alert severity="info" sx={{ mb: 2 }}>
          Verdicts describe how much the evidence supports a visit. They are not proof of
          presence — see the reasons on each visit.
        </Alert>

        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
          {FILTERS.map((f) => (
            <Badge
              key={f.key}
              badgeContent={counts[f.key === 'all' ? 'all' : f.key] ?? 0}
              color="primary"
              showZero
            >
              <Chip
                label={f.label}
                onClick={() => setFilter(f.key)}
                variant={filter === f.key ? 'filled' : 'outlined'}
                color={filter === f.key ? 'primary' : 'default'}
              />
            </Badge>
          ))}
          <Box sx={{ flexGrow: 1 }} />
          <Button size="small" onClick={() => void load()}>
            Refresh
          </Button>
        </Stack>

        {loading && <LinearProgress sx={{ mb: 1 }} />}

        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Venue</TableCell>
                <TableCell>Participant</TableCell>
                <TableCell>Ended</TableCell>
                <TableCell>Verdict</TableCell>
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
                    // A visit that arrived live is marked, so a reviewer can see that the
                    // list changed without them doing anything.
                    bgcolor: fresh.has(r.sessionId) ? 'action.hover' : undefined,
                  }}
                >
                  <TableCell>{r.venueName}</TableCell>
                  <TableCell>{r.participantId}</TableCell>
                  <TableCell>
                    {r.endedAt ? new Date(r.endedAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <VerdictChip verdict={r.verdict} score={r.score} />
                  </TableCell>
                </TableRow>
              ))}
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      No visits yet. Completed visits appear here on their own.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
        </>
        )}
      </Container>

      <Drawer
        anchor="right"
        open={selected !== null}
        onClose={() => setSelected(null)}
        // MUI v9 replaced PaperProps with slotProps.paper.
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 } } } }}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .visit(sessionId)
      .then(setD)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [sessionId]);

  useEffect(load, [load]);

  const review = async (decision: 'approve' | 'reject'): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.review(sessionId, decision, note);
      setNote('');
      load();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  if (!d) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h3" gutterBottom>
        {d.venueName}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} useFlexGap>
        <VerdictChip verdict={d.verdict} score={d.score} />
        {d.engineVersion && <Chip size="small" variant="outlined" label={`engine ${d.engineVersion}`} />}
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {d.participantId} · {d.startedAt ? new Date(d.startedAt).toLocaleString() : '—'} →{' '}
        {d.endedAt ? new Date(d.endedAt).toLocaleTimeString() : '—'}
      </Typography>

      <Divider sx={{ my: 2 }} />

      <Typography variant="h3" sx={{ fontSize: '1rem', mb: 1 }}>
        Why this verdict
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
            Not verified yet.
          </Typography>
        )}
      </Stack>

      {d.rollups && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="h3" sx={{ fontSize: '1rem', mb: 1 }}>
            What was observed
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {d.rollups.fixCount} fixes · {Math.round(d.rollups.dwellSeconds / 60)} min inside ·{' '}
            {Math.round(d.rollups.coverageRatio * 100)}% of the session observed
            {d.rollups.minDistanceM !== null && ` · closest ${Math.round(d.rollups.minDistanceM)} m`}
            {d.rollups.unusableFixCount > 0 &&
              ` · ${d.rollups.unusableFixCount} fixes too imprecise to use`}
          </Typography>
        </>
      )}

      {d.report && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="h3" sx={{ fontSize: '1rem', mb: 1 }}>
            Participant report · {d.report.rating}/5
          </Typography>
          <Typography variant="body2">{d.report.notes}</Typography>
        </>
      )}

      <Divider sx={{ my: 2 }} />
      {d.review ? (
        <Alert severity="info">
          <strong>{d.review.decision}</strong> by {d.review.reviewerId} —{' '}
          {d.review.note}
        </Alert>
      ) : (
        <>
          <Typography variant="h3" sx={{ fontSize: '1rem', mb: 1 }}>
            Override
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            A decision here is recorded alongside the engine&apos;s verdict, never instead of
            it.
          </Typography>
          <TextField
            label="Why (required)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            sx={{ mb: 1.5 }}
          />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              disabled={busy || note.trim().length < 10}
              onClick={() => void review('approve')}
            >
              Approve
            </Button>
            <Button
              variant="outlined"
              color="error"
              disabled={busy || note.trim().length < 10}
              onClick={() => void review('reject')}
            >
              Reject
            </Button>
          </Stack>
        </>
      )}
    </Box>
  );
}
