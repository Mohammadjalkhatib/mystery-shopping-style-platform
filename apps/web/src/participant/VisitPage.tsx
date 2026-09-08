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
import { useLocale, useT } from '../i18n/LocaleContext.js';
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
  const t = useT();
  const { toggle } = useLocale();

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
            {t('yourVisit')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {user?.displayName}
          </Typography>
          {/*
            The language toggle lives here because this is the only screen a participant is
            guaranteed to reach, and it shows the language it switches TO, not the current one
            -- a button reading "العربية" while the page is already Arabic is a coin flip.
          */}
          <Button size="small" onClick={toggle}>
            {t('language')}
          </Button>
          <Button size="small" onClick={logout}>
            {t('signOut')}
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
          <Typography color="text.secondary">{t('noVisits')}</Typography>
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
          {/*
            A closed visit says WHICH timer closed it, not just that it is closed. The server
            distinguishes never-started, went-quiet and no-report-filed, and a participant
            reading "this visit is abandoned" has no way to tell which happened to them or
            whether it was their fault (D-019).
          */}
          <Alert severity={current.state === 'submitted' ? 'success' : 'warning'}>
            {current.state === 'submitted' ? t('reportSubmitted') : terminalText(t, current)}
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
  const t = useT();
  return (
    <Box sx={{ p: 2, maxWidth: 560, mx: 'auto' }}>
      <Card>
        <CardContent>
          <Typography variant="h1" sx={{ fontSize: '1.3rem', mb: 0.5 }}>
            {session.venue.name}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {session.venue.indoor ? t('venueIndoor') : t('venueOutdoor')} ·{' '}
            {t('geofence', { radius: session.venue.radiusM })}
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('readyAdvice')}
          </Alert>
          <Button variant="contained" size="large" fullWidth disabled={busy} onClick={onStart}>
            {busy ? t('starting') : t('startVisit')}
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
  // `t` is the tracker in this component, so the translator is `tx` rather than shadowing it.
  const tx = useT();
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
              label={t.visible ? tx('capturing') : tx('paused')}
            />
          </Stack>
          <Typography variant="h1" sx={{ fontSize: '2.2rem', fontVariantNumeric: 'tabular-nums' }}>
            {mins}:{String(secs).padStart(2, '0')}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {tx('onSite')}
          </Typography>
        </CardContent>
      </Card>

      {/* Honest status. Each of these is a real condition, not a decorative badge. */}
      {t.permission === 'denied' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {tx('permDenied')}
        </Alert>
      )}
      {t.permission === 'unsupported' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {tx('permUnsupported')}
        </Alert>
      )}
      {!t.visible && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {tx('backgroundNotice')}
        </Alert>
      )}
      {!t.online && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {tx('offlineNotice')}{' '}
          {t.pending > 0 && tx('offlineWaiting', { count: t.pending })}
        </Alert>
      )}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            {/*
              Count-neutral phrasing ("Locations recorded: 3"), not "3 locations". English
              needs one plural rule, Arabic needs six, and a pass is not the place to build a
              plural engine -- so the copy is written to need none.
            */}
            {tx('locationsRecorded', { count: t.captured })}
            {t.lastAccuracyM !== null &&
              ` · ${tx('lastAccurate', { metres: Math.round(t.lastAccuracyM) })}`}
            {t.pending > 0 && ` · ${tx('waitingToSend', { count: t.pending })}`}
            {t.wakeLock && ` · ${tx('screenAwake')}`}
          </Typography>
          {t.captured === 0 && t.permission === 'granted' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {tx('waitingFirstFix')}
            </Typography>
          )}
        </CardContent>
      </Card>

      {confirming ? (
        <Stack spacing={1.5}>
          <Alert severity="info">
            {tx('endingNotice')}
          </Alert>
          <Button variant="contained" size="large" fullWidth disabled={busy} onClick={onEnd}>
            {busy ? tx('ending') : tx('endingConfirm')}
          </Button>
          <Button onClick={() => setConfirming(false)}>{tx('notYet')}</Button>
        </Stack>
      ) : (
        <Button
          variant="contained"
          size="large"
          fullWidth
          color="secondary"
          onClick={() => setConfirming(true)}
        >
          {tx('endVisit')}
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
  const t = useT();

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
        {t('reportTitle')}
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
            {t('reportRating')}
          </Typography>
          <Rating value={rating} onChange={(_, v) => setRating(v)} size="large" sx={{ mb: 2 }} />
          <Divider sx={{ mb: 2 }} />
          <TextField
            label={t('reportNotes')}
            placeholder={t('reportNotesHint')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={5}
            fullWidth
            helperText={t('reportNotesCounter', { count: notes.trim().length })}
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
        {busy ? t('submitting') : t('submitReport')}
      </Button>
    </Box>
  );
}

/**
 * The end-of-visit message, in the participant's language.
 *
 * Renders from `terminalReasonCode` rather than the server's English `terminalReason`, which
 * is the only server-composed sentence a participant ever sees. Without the code this screen
 * would be Arabic everywhere except the one line explaining what went wrong (D-022). The
 * English text is still the fallback if a future code arrives that this build does not know.
 */
function terminalText(
  t: (key: Parameters<ReturnType<typeof useT>>[0], vars?: Record<string, string | number>) => string,
  session: SessionView,
): string {
  const { abandonMinutes: mins, hardCapHours: hours } = session.timeouts;
  switch (session.terminalReasonCode) {
    case 'never_started':
      return t('endedNeverStarted', { mins });
    case 'went_quiet':
      return t('endedWentQuiet', { mins });
    case 'no_report':
      return t('endedNoReport', { mins });
    case 'expired':
      return t('endedExpired', { hours });
    default:
      return session.terminalReason ?? t('endedGeneric');
  }
}
