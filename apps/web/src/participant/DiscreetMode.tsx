import { Box, LinearProgress, Typography } from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/LocaleContext.js';

/** How long the participant must hold to come back. Long enough to survive a pocket. */
const HOLD_MS = 800;

/**
 * A dim, quiet screen the participant can put up while they are in the shop.
 *
 * The problem it solves is real and specific to mystery shopping: the visit needs the tab
 * OPEN and VISIBLE to keep capturing (D-005 — a backgrounded tab is throttled and the watch is
 * released), but a shopper standing in a store holding a bright page titled "Your visit /
 * Capturing / 12:04 on site" is conspicuous in exactly the way a mystery shopper must not be.
 * Before this, the honest advice was "keep the page in front of you", which is advice to look
 * like an auditor.
 *
 * Three deliberate limits, because this is a screen designed to be misread by a bystander and
 * that is worth being careful about:
 *
 * 1. **It does not imitate a phone lock screen.** No carrier row, no OS wallpaper, no slide to
 *    unlock, no notification stack. Cloning system UI is a phishing pattern, it breaks the
 *    moment the OS restyles, and it is not needed — a dark screen with a clock reads as an idle
 *    phone to anyone glancing at it, which is the whole requirement.
 * 2. **It never lies to the PARTICIPANT.** A small line says the visit is still running and
 *    location is still being recorded. The person it conceals things from is a bystander; the
 *    person using it must always know exactly what their phone is doing.
 * 3. **It changes nothing about capture.** No timers are paused, no fixes are suppressed, no
 *    state is touched. It is a `position: fixed` overlay and nothing else, so it cannot alter
 *    what the evidence says. Dwell and coverage are identical whether it is up or not.
 *
 * Hold-to-dismiss rather than tap: a tap is what a phone in a pocket does by accident.
 */
export function DiscreetMode({ onExit }: { onExit: () => void }) {
  const t = useT();
  const [now, setNow] = useState(() => new Date());
  const [holdMs, setHoldMs] = useState(0);
  const holdStart = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(i);
  }, []);

  const tick = useCallback(() => {
    if (holdStart.current === null) return;
    const held = Date.now() - holdStart.current;
    setHoldMs(held);
    if (held >= HOLD_MS) {
      holdStart.current = null;
      setHoldMs(0);
      onExit();
      return;
    }
    raf.current = requestAnimationFrame(tick);
  }, [onExit]);

  const begin = useCallback(() => {
    if (holdStart.current !== null) return;
    holdStart.current = Date.now();
    raf.current = requestAnimationFrame(tick);
  }, [tick]);

  const end = useCallback(() => {
    holdStart.current = null;
    setHoldMs(0);
    if (raf.current !== null) cancelAnimationFrame(raf.current);
  }, []);

  useEffect(() => end, [end]);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');

  return (
    <Box
      onPointerDown={begin}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
      // `dir="ltr"` regardless of locale: a clock is not a sentence, and 14:05 does not mirror.
      dir="ltr"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: (th) => th.zIndex.modal + 10,
        bgcolor: '#000',
        color: 'rgba(255,255,255,0.92)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        // Stops the long-press turning into a text selection or an iOS callout.
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'none',
        cursor: 'pointer',
      }}
    >
      <Typography
        sx={{
          fontSize: 'clamp(3.5rem, 22vw, 7rem)',
          fontWeight: 200,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
        }}
      >
        {hh}:{mm}
      </Typography>
      <Typography sx={{ opacity: 0.55, fontSize: '0.95rem' }}>
        {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </Typography>

      {/*
        The honesty line. Dim enough not to draw a bystander's eye, never absent: the
        participant must always be able to tell that their phone is still recording.
      */}
      <Box sx={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)', textAlign: 'center', px: 3 }}>
        <Typography sx={{ opacity: 0.4, fontSize: '0.8rem', mb: 0.5 }}>
          • {t('participant.discreet.stillRecording')}
        </Typography>
        <Typography sx={{ opacity: 0.3, fontSize: '0.75rem' }}>
          {holdMs > 0 ? t('participant.discreet.holdProgress') : t('participant.discreet.tapToReturn')}
        </Typography>
        {holdMs > 0 && (
          <LinearProgress
            variant="determinate"
            value={Math.min(100, (holdMs / HOLD_MS) * 100)}
            sx={{
              mt: 1,
              height: 2,
              bgcolor: 'rgba(255,255,255,0.12)',
              '& .MuiLinearProgress-bar': { bgcolor: 'rgba(255,255,255,0.5)' },
            }}
          />
        )}
      </Box>
    </Box>
  );
}
