import {
  Alert,
  Snackbar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Rating,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/LocaleContext.js';
import { api, type SessionView } from '../api/client.js';
import { Consent, CONSENT_VERSION } from './Consent.js';
import { DiscreetMode } from './DiscreetMode.js';
import { EvidencePicker } from './EvidencePicker.js';
import { PresenceBanner } from './PresenceBanner.js';
import { qa } from '../theme/theme.js';
import { clearQueue } from './offlineQueue.js';
import { useVisitTracker } from './useVisitTracker.js';

/**
 * The visit RUNNER: consent, capture, end, report. Mobile-first, because this is the screen a
 * reviewer opens on a phone and the only one that has to work one-handed in a shop.
 *
 * Deliberately honest throughout: it never claims to be tracking continuously, it shows the
 * gaps as gaps, and the primary action is always the largest thing on screen.
 *
 * The chrome around it -- the bar, the language toggle, the notification bell and the tab that
 * switches to the history screen -- lives in `ParticipantApp`. This component owns one visit at
 * a time and nothing else, which is what keeps the tracker's lifecycle simple: `useVisitTracker`
 * lives inside `ActiveVisit`, so anything that unmounts this subtree stops capture.
 */
export function VisitPage({
  focusSessionId,
  onChanged,
}: {
  /** A visit to open, set when a notification was tapped. Null means "the newest one". */
  focusSessionId?: string | null;
  /** Called after anything that changes what the history screen or the inbox would show. */
  onChanged?: () => void;
}) {
  const [sessions, setSessions] = useState<SessionView[] | null>(null);
  const [current, setCurrent] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const t = useT();

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

  /**
   * Open the visit a notification pointed at.
   *
   * Reloads once when the id is not in the list yet, because the push arrives before this
   * component has re-read `/sessions/mine` and on the very first assignment the list is
   * genuinely stale -- which is the case the feature exists for.
   *
   * TWO things here are deliberate and were wrong in the first draft:
   *
   * 1. **The lookup happens in the effect, not inside a `setCurrent` updater.** An updater
   *    must be pure. React invokes it twice under StrictMode, so firing `load()` from inside
   *    one issues two requests for every one intended.
   * 2. **The reload is attempted at most once per id** (`reloadedFor`). `sessions` is a
   *    dependency and `load()` replaces it, so an id that is genuinely absent -- a
   *    participant with more live visits than the endpoint's limit returns -- would otherwise
   *    re-enter this effect on every response and fetch forever. A notification pointing at
   *    something that is not there must fail quietly, not spin.
   */
  const reloadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!focusSessionId) return;
    const found = sessions?.find((s) => s.id === focusSessionId);
    if (found) {
      setCurrent((c) => (c?.id === focusSessionId ? c : found));
      return;
    }
    if (reloadedFor.current === focusSessionId) return;
    reloadedFor.current = focusSessionId;
    void load();
  }, [focusSessionId, sessions, load]);

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
    <Box>
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
            setSubmitted(true);
            // The history screen and the inbox both change on a submit.
            onChanged?.();
            /**
             * Advance the local state immediately as well as reloading.
             *
             * The reload is authoritative, but it is a round trip; without this the report
             * form stays on screen for its duration, which is exactly long enough for someone
             * to press submit a second time and be told they already did.
             */
            setCurrent((c) => (c ? { ...c, state: 'submitted' } : c));
            void load();
          }}
        />
      )}

      {/*
        Confirmation the participant cannot miss. The panel below says the same thing, but a
        person who has just pressed a button is looking for an acknowledgement, not a changed
        screen -- and before this there was neither.
      */}
      <Snackbar
        open={submitted}
        autoHideDuration={6000}
        onClose={() => setSubmitted(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" onClose={() => setSubmitted(false)}>
          {t('participant.report.submittedToast')}
        </Alert>
      </Snackbar>

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
    <Box
      sx={{
        p: { xs: 1.5, sm: 2 },
        maxWidth: 560,
        mx: 'auto',
        // The start button sits at the bottom on a phone, under the thumb, rather than
        // wherever the content happens to end. On anything taller it just centres.
        minHeight: { xs: 'calc(100dvh - 120px)', sm: 'auto' },
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      {/*
        The venue name is the headline, not a line inside a card. This is the only screen where
        a participant chooses whether they are in the right place at all, and it used to render
        at 1.3rem inside a bordered box alongside everything else.
      */}
      <Box>
        <Typography variant="h1" sx={{ fontSize: '1.6rem', mb: 0.5 }}>
          {session.venue.name}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {session.venue.indoor
            ? t('participant.ready.venueIndoor')
            : t('participant.ready.venueOutdoor')}{' '}
          · {t('participant.ready.geofence', { radius: session.venue.radiusM })}
        </Typography>
      </Box>

      {/*
        The advice, as a quiet panel rather than a blue info Alert.

        It is the last calm moment before a live session and the only place these rules get
        read, so it should look like something to read rather than something to dismiss — an
        `Alert` is shaped like an interruption and this is not one.
      */}
      <Box sx={{ p: 2, bgcolor: qa.neutral[50], borderRadius: `${qa.radius.lg}px` }}>
        <Typography variant="body2" color="text.secondary">
          {t('participant.ready.advice')}
        </Typography>
      </Box>

      <Box sx={{ flexGrow: 1 }} />

      <Button variant="contained" size="large" fullWidth disabled={busy} onClick={onStart}>
        {busy ? t('participant.ready.starting') : t('participant.ready.start')}
      </Button>
    </Box>
  );
}

/**
 * One line of capture health.
 *
 * `tone` only picks the mark's colour -- every row says its own piece in words, so a participant
 * who cannot separate the three colours loses nothing. `waiting` is amber rather than red on
 * purpose: fixes queued offline and a capture restart are both normal, recoverable and already
 * handled, and colouring them as failures would make a working visit look broken.
 */
function HealthRow({ text, tone }: { text: string; tone: 'good' | 'waiting' | 'idle' }) {
  const colour =
    tone === 'good' ? 'primary.main' : tone === 'waiting' ? 'warning.main' : 'text.disabled';
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start', px: 1.75, py: 1.25 }}>
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: colour,
          flexShrink: 0,
          mt: '7px',
        }}
      />
      <Typography variant="body2" color="text.secondary">
        {text}
      </Typography>
    </Stack>
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

      {/*
        FIRST, above the timer.
        
        The elapsed clock is the thing a participant looks at, so anything below it competes
        with a number that changes every second. "You are not where you think you are" is the
        one message on this screen that is worth interrupting for, and it is only useful while
        the visit is still open — which is exactly the window this screen owns.
      */}
      <PresenceBanner
        presence={t.presence}
        presenceAt={t.presenceAt}
        venueName={session.venue.name}
      />

      {/*
        The elapsed clock, unboxed.

        It used to sit in a Card with the venue name and a capturing chip above it, which meant
        the one number a person on site actually looks at was the third thing in a stack. The
        venue name is already in the presence banner directly above, so repeating it here was
        buying nothing; the capturing state moves to the row under the clock, where it reads as
        a property of the timer rather than a separate badge.
      */}
      <Stack spacing={0.5} sx={{ alignItems: 'center', mb: 2.5 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'baseline', justifyContent: 'center' }}
        >
          <Typography
            variant="h1"
            sx={{ fontSize: '2.75rem', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}
          >
            {mins}:{String(secs).padStart(2, '0')}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {tx('participant.visit.onSite')}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Box
            sx={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              flexShrink: 0,
              bgcolor: t.visible ? 'primary.main' : 'text.disabled',
            }}
          />
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, color: t.visible ? 'primary.main' : 'text.secondary' }}
          >
            {t.visible ? tx('participant.visit.capturing') : tx('participant.visit.paused')}
          </Typography>
        </Stack>
      </Stack>

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

      {/*
        Capture health, as rows rather than one middot-joined sentence.

        Up to five facts were being concatenated into a single line of prose, which on a phone
        wrapped into an unreadable block exactly when it had the most to say — an offline
        participant with a restart behind them is the person least able to parse it. The copy
        keys are unchanged; only the joining is.

        Deliberately quiet and below the fold-line of attention. It reassures; it is not what the
        participant is here to read, and it must not compete with the presence banner.
      */}
      <Card sx={{ mb: 2 }}>
        <Stack divider={<Divider />}>
          {/*
            Count-neutral phrasing ("Locations recorded: 3"), not "3 locations". English
            needs one plural rule, Arabic needs six, and a pass is not the place to build a
            plural engine -- so the copy is written to need none.
          */}
          <HealthRow
            text={tx('participant.visit.locationsRecorded', { count: t.captured })}
            tone={t.captured > 0 ? 'good' : 'idle'}
          />
          {t.lastAccuracyM !== null && (
            <HealthRow
              text={tx('participant.visit.lastAccurate', {
                metres: Math.round(t.lastAccuracyM),
              })}
              tone="idle"
            />
          )}
          {t.pending > 0 && (
            <HealthRow
              text={tx('participant.visit.waitingToSend', { count: t.pending })}
              tone="waiting"
            />
          )}
          {t.wakeLock && <HealthRow text={tx('participant.visit.screenAwake')} tone="idle" />}
          {/*
            Shown rather than hidden. A restart is the only evidence that capture had died
            rather than that the screen was simply off, and after the visit the two are
            otherwise indistinguishable.
          */}
          {t.restarts > 0 && (
            <HealthRow
              text={tx('participant.visit.captureRestarted', { count: t.restarts })}
              tone="waiting"
            />
          )}
          {t.captured === 0 && t.permission === 'granted' && (
            <HealthRow text={tx('participant.visit.waitingFirstFix')} tone="idle" />
          )}
        </Stack>
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
          {/*
            Outlined and neutral, not a filled brand button.

            This was `color="secondary"`, which under the old placeholder palette was a muted
            amber and is now `--qa-purple-500` — a vivid purple, brighter than the primary, sitting
            under the thumb on the one action that stops capture. Ending is not the thing this
            screen wants you to do; it is the thing you do when you are finished. `inherit` keeps
            it legible without competing with "Start visit" on the screen before it.
          */}
          <Button
            variant="outlined"
            size="large"
            fullWidth
            color="inherit"
            sx={{ borderColor: 'divider', color: 'text.primary' }}
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
  const [evidenceKey, setEvidenceKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.submitReport(session.id, notes, rating ?? 3, evidenceKey ?? undefined);
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
          <Divider sx={{ my: 2 }} />
          <EvidencePicker sessionId={session.id} onChange={setEvidenceKey} />
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
