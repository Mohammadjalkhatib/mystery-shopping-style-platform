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
import { DiscreetMode } from './DiscreetMode.js';
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
    <Box
      sx={{
        minHeight: '100dvh',
        bgcolor: 'background.default',
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 48px)',
      }}
    >
      <AppBar position="sticky">
        <Toolbar sx={{ gap: 1, minHeight: { xs: 56, sm: 64 } }}>
          <Typography
            variant="h3"
            sx={{ fontSize: { xs: '1rem', sm: '1.05rem' }, flexGrow: 1, minWidth: 0 }}
            noWrap
          >
            {t('participant.yourVisit')}
          </Typography>
          {/* The name is what a signed-in participant least needs told; it goes first. */}
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ display: { xs: 'none', sm: 'block' } }}
            noWrap
          >
            {user?.displayName}
          </Typography>
          {/*
            The language toggle lives here because this is the only screen a participant is
            guaranteed to reach, and it shows the language it switches TO, not the current one
            -- a button reading "العربية" while the page is already Arabic is a coin flip.
          */}
          <Button size="small" onClick={toggle}>
            {t('common.language')}
          </Button>
          <Button size="small" onClick={logout}>
            {t('common.signOut')}
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
          <Typography color="text.secondary">{t('participant.noVisits')}</Typography>
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
            {current.state === 'submitted' ? t('participant.report.submitted') : terminalText(t, current)}
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
    <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 560, mx: 'auto' }}>
      <Card>
        <CardContent>
          <Typography variant="h1" sx={{ fontSize: '1.3rem', mb: 0.5 }}>
            {session.venue.name}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {session.venue.indoor ? t('participant.ready.venueIndoor') : t('participant.ready.venueOutdoor')} ·{' '}
            {t('participant.ready.geofence', { radius: session.venue.radiusM })}
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('participant.ready.advice')}
          </Alert>
          <Button variant="contained" size="large" fullWidth disabled={busy} onClick={onStart}>
            {busy ? t('participant.ready.starting') : t('participant.ready.start')}
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
  const [discreet, setDiscreet] = useState(false);

  const started = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(i);
  }, [started]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 560, mx: 'auto' }}>
      {/*
        Rendered as a sibling overlay, never as a replacement for this subtree. `useVisitTracker`
        lives in THIS component, so unmounting it to show a cover would tear down the watch and
        stop capture — the exact opposite of what the feature is for.
      */}
      {discreet && <DiscreetMode onExit={() => setDiscreet(false)} />}

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
              label={t.visible ? tx('participant.visit.capturing') : tx('participant.visit.paused')}
            />
          </Stack>
          <Typography variant="h1" sx={{ fontSize: '2.2rem', fontVariantNumeric: 'tabular-nums' }}>
            {mins}:{String(secs).padStart(2, '0')}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {tx('participant.visit.onSite')}
          </Typography>
        </CardContent>
      </Card>

      {/* Honest status. Each of these is a real condition, not a decorative badge. */}
      {t.permission === 'denied' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {tx('participant.visit.permDenied')}
        </Alert>
      )}
      {t.permission === 'unsupported' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {tx('participant.visit.permUnsupported')}
        </Alert>
      )}
      {!t.visible && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {tx('participant.visit.backgroundNotice')}
        </Alert>
      )}
      {!t.online && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {tx('participant.visit.offlineNotice')}{' '}
          {t.pending > 0 && tx('participant.visit.offlineWaiting', { count: t.pending })}
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
            {tx('participant.visit.locationsRecorded', { count: t.captured })}
            {t.lastAccuracyM !== null &&
              ` · ${tx('participant.visit.lastAccurate', { metres: Math.round(t.lastAccuracyM) })}`}
            {t.pending > 0 && ` · ${tx('participant.visit.waitingToSend', { count: t.pending })}`}
            {t.wakeLock && ` · ${tx('participant.visit.screenAwake')}`}
            {/*
              Shown rather than hidden. A restart is the only evidence that capture had died
              rather than that the screen was simply off, and after the visit the two are
              otherwise indistinguishable.
            */}
            {t.restarts > 0 && ` · ${tx('participant.visit.captureRestarted', { count: t.restarts })}`}
          </Typography>
          {t.captured === 0 && t.permission === 'granted' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {tx('participant.visit.waitingFirstFix')}
            </Typography>
          )}
        </CardContent>
      </Card>

      {confirming ? (
        <Stack spacing={1.5}>
          <Alert severity="info">
            {tx('participant.visit.endingNotice')}
          </Alert>
          <Button variant="contained" size="large" fullWidth disabled={busy} onClick={onEnd}>
            {busy ? tx('participant.visit.ending') : tx('participant.visit.endingConfirm')}
          </Button>
          <Button onClick={() => setConfirming(false)}>{tx('participant.visit.notYet')}</Button>
        </Stack>
      ) : (
        <Stack spacing={1.5}>
          <Button
            variant="outlined"
            size="large"
            fullWidth
            onClick={() => setDiscreet(true)}
          >
            {tx('participant.discreet.button')}
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            {tx('participant.discreet.explain')}
          </Typography>
          <Button
            variant="contained"
            size="large"
            fullWidth
            color="secondary"
            onClick={() => setConfirming(true)}
          >
            {tx('participant.visit.end')}
          </Button>
        </Stack>
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
    <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 560, mx: 'auto' }}>
      <Typography variant="h1" sx={{ fontSize: '1.3rem', mb: 0.5 }}>
        {t('participant.report.title')}
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
            {t('participant.report.rating')}
          </Typography>
          <Rating value={rating} onChange={(_, v) => setRating(v)} size="large" sx={{ mb: 2 }} />
          <Divider sx={{ mb: 2 }} />
          <TextField
            label={t('participant.report.notes')}
            placeholder={t('participant.report.notesHint')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={5}
            fullWidth
            helperText={t('participant.report.notesCounter', { count: notes.trim().length })}
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
        {busy ? t('participant.report.submitting') : t('participant.report.submit')}
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
      return t('participant.ended.neverStarted', { mins });
    case 'went_quiet':
      return t('participant.ended.wentQuiet', { mins });
    case 'no_report':
      return t('participant.ended.noReport', { mins });
    case 'expired':
      return t('participant.ended.expired', { hours });
    default:
      return session.terminalReason ?? t('participant.ended.generic');
  }
}
