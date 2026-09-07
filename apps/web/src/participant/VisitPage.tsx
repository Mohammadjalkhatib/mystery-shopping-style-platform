import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Rating,
  Stack,
  TextField,
  Toolbar,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { api, type SessionView } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { Consent, CONSENT_VERSION } from './Consent.js';
import { clearQueue } from './offlineQueue.js';
import { useVisitTracker } from './useVisitTracker.js';

/**
 * The participant surface. Mobile-first, because this is the screen a reviewer opens on a
 * phone and the only one that has to work one-handed in a shop.
 *
 * Deliberately honest throughout: it never claims to be tracking continuously, it shows the
 * gaps as gaps, and the primary action is always the largest thing on screen.
 */
export function VisitPage() {
  const { user, logout } = useAuth();
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [current, setCurrent] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.mySessions();
      setSessions(list);
      setCurrent((c) => (c ? (list.find((s) => s.id === c.id) ?? c) : (list[0] ?? null)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your visits');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<SessionView>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setCurrent(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (!sessions) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', pb: 6 }}>
      <AppBar position="sticky">
        <Toolbar sx={{ gap: 1 }}>
          <Typography variant="h3" sx={{ fontSize: '1.05rem', flexGrow: 1 }}>
            My visit
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {user?.displayName}
          </Typography>
          <Button size="small" onClick={logout}>
            Sign out
          </Button>
        </Toolbar>
      </AppBar>

      {error && (
        <Alert severity="error" sx={{ m: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!current && (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="text.secondary">
            You have no visits assigned right now.
          </Typography>
        </Box>
      )}

      {current && !current.consentedAt && (
        <Consent
          venueName={current.venue.name}
          busy={busy}
          onAgree={() =>
            void act(async () => {
              await api.consent(current.id, CONSENT_VERSION);
              return api.session(current.id);
            })
          }
        />
      )}

      {current?.consentedAt && current.state === 'pending' && (
        <ReadyToStart
          session={current}
          busy={busy}
          onStart={() => void act(() => api.startVisit(current.id))}
        />
      )}

      {current?.state === 'active' && (
        <ActiveVisit
          session={current}
          busy={busy}
          onEnd={() => void act(() => api.endVisit(current.id))}
        />
      )}

      {current?.state === 'ended' && (
        <ReportForm
          session={current}
          onSubmitted={() => {
            clearQueue(current.id);
            void load();
          }}
        />
      )}

      {current && ['submitted', 'abandoned', 'expired'].includes(current.state) && (
        <Box sx={{ p: 3 }}>
          <Alert severity={current.state === 'submitted' ? 'success' : 'warning'}>
            {current.state === 'submitted'
              ? 'Report submitted. It is being reviewed — you do not need to do anything else.'
              : `This visit is ${current.state} and can no longer be continued.`}
          </Alert>
        </Box>
      )}
    </Box>
  );
}

function ReadyToStart({
  session,
  busy,
  onStart,
}: {
  session: SessionView;
  busy: boolean;
  onStart: () => void;
}) {
  return (
    <Box sx={{ p: 2, maxWidth: 560, mx: 'auto' }}>
      <Card>
        <CardContent>
          <Typography variant="h1" sx={{ fontSize: '1.3rem', mb: 0.5 }}>
            {session.venue.name}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {session.venue.indoor ? 'Indoor venue' : 'Outdoor venue'} · {session.venue.radiusM} m
            geofence
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            Start the visit <strong>as you arrive</strong>, and keep this page open and in
            front of you while you are inside. Your phone can go back in your pocket between
            interactions — the gaps are expected.
          </Alert>
          <Button variant="contained" size="large" fullWidth disabled={busy} onClick={onStart}>
            {busy ? 'Starting…' : 'Start visit'}
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}

/** The screen that is open while the participant is on site. */
function ActiveVisit({
  session,
  busy,
  onEnd,
}: {
  session: SessionView;
  busy: boolean;
  onEnd: () => void;
}) {
  const t = useVisitTracker(session.id, true);
  const [confirming, setConfirming] = useState(false);

  const started = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(i);
  }, [started]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <Box sx={{ p: 2, maxWidth: 560, mx: 'auto' }}>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack
            direction="row"
            sx={{ mb: 1, justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Typography variant="h3" sx={{ fontSize: '1.1rem' }}>
              {session.venue.name}
            </Typography>
            <Chip
              size="small"
              color={t.visible ? 'primary' : 'default'}
              label={t.visible ? 'Capturing' : 'Paused'}
            />
          </Stack>
          <Typography variant="h1" sx={{ fontSize: '2.2rem', fontVariantNumeric: 'tabular-nums' }}>
            {mins}:{String(secs).padStart(2, '0')}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            on site
          </Typography>
        </CardContent>
      </Card>

      {/* Honest status. Each of these is a real condition, not a decorative badge. */}
      {t.permission === 'denied' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Location permission is off, so nothing is being recorded. Turn it on in your browser
          settings — without it this visit cannot be verified.
        </Alert>
      )}
      {t.permission === 'unsupported' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          This browser does not provide location. Try Chrome or Safari.
        </Alert>
      )}
      {!t.visible && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This page is in the background, so your location is not being recorded right now.
          That is normal and the gap is expected — bring the page back when you can.
        </Alert>
      )}
      {!t.online && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          You are offline. Fixes are being saved on your phone and will send themselves when
          you reconnect. {t.pending > 0 && `${t.pending} waiting.`}
        </Alert>
      )}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            {t.captured} location{t.captured === 1 ? '' : 's'} recorded
            {t.lastAccuracyM !== null && ` · last accurate to ~${Math.round(t.lastAccuracyM)} m`}
            {t.pending > 0 && ` · ${t.pending} waiting to send`}
            {t.wakeLock && ' · screen kept awake while this page is open'}
          </Typography>
          {t.captured === 0 && t.permission === 'granted' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Waiting for a first fix. This can take a few seconds outdoors and longer inside.
            </Typography>
          )}
        </CardContent>
      </Card>

      {confirming ? (
        <Stack spacing={1.5}>
          <Alert severity="info">
            Ending the visit stops location capture. You will write your report next.
          </Alert>
          <Button variant="contained" size="large" fullWidth disabled={busy} onClick={onEnd}>
            {busy ? 'Ending…' : 'Yes, end the visit'}
          </Button>
          <Button onClick={() => setConfirming(false)}>Not yet</Button>
        </Stack>
      ) : (
        <Button
          variant="contained"
          size="large"
          fullWidth
          color="secondary"
          onClick={() => setConfirming(true)}
        >
          End visit
        </Button>
      )}
    </Box>
  );
}

function ReportForm({ session, onSubmitted }: { session: SessionView; onSubmitted: () => void }) {
  const [notes, setNotes] = useState('');
  const [rating, setRating] = useState<number | null>(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.submitReport(session.id, notes, rating ?? 3);
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ p: 2, maxWidth: 560, mx: 'auto' }}>
      <Typography variant="h1" sx={{ fontSize: '1.3rem', mb: 0.5 }}>
        Your report
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {session.venue.name}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Typography component="legend" variant="body2" sx={{ mb: 0.5 }}>
            Overall experience
          </Typography>
          <Rating value={rating} onChange={(_, v) => setRating(v)} size="large" sx={{ mb: 2 }} />
          <Divider sx={{ mb: 2 }} />
          <TextField
            label="What did you observe?"
            placeholder="Greeting time, staff helpfulness, queue length, cleanliness…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={5}
            fullWidth
            helperText={`${notes.trim().length}/10 characters minimum`}
            error={notes.length > 0 && notes.trim().length < 10}
          />
        </CardContent>
      </Card>

      <Button
        variant="contained"
        size="large"
        fullWidth
        sx={{ mt: 2 }}
        disabled={busy || notes.trim().length < 10}
        onClick={() => void submit()}
      >
        {busy ? 'Submitting…' : 'Submit report'}
      </Button>
    </Box>
  );
}
