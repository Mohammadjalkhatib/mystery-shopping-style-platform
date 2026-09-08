import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { drainQueue, enqueue, queueSize, type QueuedFix } from './offlineQueue.js';

export type PermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported';

export interface TrackerState {
  permission: PermissionState;
  /** Fixes captured this session, whether or not they have been sent yet. */
  captured: number;
  /** Fixes still waiting in the offline buffer. */
  pending: number;
  lastFixAt: number | null;
  lastAccuracyM: number | null;
  visible: boolean;
  online: boolean;
  wakeLock: boolean;
  error: string | null;
}

const SAMPLE_MS = 30_000;

/**
 * Location capture for one visit. This is D-005 in code.
 *
 * The honest framing, which the UI repeats to the participant: **this does not track you
 * continuously and cannot.** `watchPosition` stops delivering when the screen locks or the
 * tab is backgrounded, and browsers suspend background tabs outright after a few minutes.
 * So the app captures what it can while the page is visible, buffers when offline, and the
 * verification engine scores the gaps rather than pretending they did not happen.
 *
 * Everything here is best-effort by design. A failure to get a fix is a gap, not an error.
 */
export function useVisitTracker(sessionId: string, active: boolean): TrackerState {
  const [state, setState] = useState<TrackerState>({
    permission: 'prompt',
    captured: 0,
    pending: 0,
    lastFixAt: null,
    lastAccuracyM: null,
    visible: typeof document === 'undefined' ? true : !document.hidden,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    wakeLock: false,
    error: null,
  });

  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const flushing = useRef(false);

  /* --------------------------------------------------------------- flushing */

  const flush = useCallback(async () => {
    if (flushing.current || !navigator.onLine) return;
    flushing.current = true;
    try {
      await drainQueue(sessionId, async (batch) => {
        await api.postPings(sessionId, batch);
      });
      setState((s) => ({ ...s, pending: 0 }));
    } catch {
      // Left in the queue. Rule 4 makes a retry safe: the clientPingId is generated once,
      // stored with the fix, and the server upsert is first-write-wins, so flushing the same
      // batch twice cannot duplicate or move a fix.
      setState((s) => ({ ...s, pending: queueSize(sessionId) }));
    } finally {
      flushing.current = false;
    }
  }, [sessionId]);

  /* ---------------------------------------------------------------- capture */

  const record = useCallback(
    (pos: GeolocationPosition) => {
      const now = Date.now();
      // Throttle to the sampling cadence. watchPosition fires on movement, not on a timer,
      // so without this a walking participant would burn the per-session ping budget.
      if (now - lastSent.current < SAMPLE_MS) return;
      lastSent.current = now;

      const fix: QueuedFix = {
        // Generated on the client, once, and stored with the fix. This is the idempotency
        // key (rule 4) and it is the ONLY field the client is supposed to own.
        clientPingId: crypto.randomUUID(),
        capturedAt: new Date(pos.timestamp).toISOString(),
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        // Never rounded: Android reports quantised repeats and rounding would trip the
        // engine's constant-accuracy spoof branch on an honest trace (D-010).
        accuracyM: pos.coords.accuracy,
      };
      enqueue(sessionId, fix);

      setState((s) => ({
        ...s,
        captured: s.captured + 1,
        pending: queueSize(sessionId),
        lastFixAt: now,
        lastAccuracyM: fix.accuracyM,
      }));
      void flush();
    },
    [sessionId, flush],
  );

  /* ------------------------------------------------------------ the watcher */

  useEffect(() => {
    if (!active) return;
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, permission: 'unsupported' }));
      return;
    }

    const start = (): void => {
      if (watchId.current !== null) return;
      watchId.current = navigator.geolocation.watchPosition(
        (pos) => {
          setState((s) => (s.permission === 'granted' ? s : { ...s, permission: 'granted', error: null }));
          record(pos);
        },
        (err) => {
          setState((s) => ({
            ...s,
            permission: err.code === err.PERMISSION_DENIED ? 'denied' : s.permission,
            // A timeout or unavailable fix is a GAP, not a failure of the visit.
            error:
              err.code === err.PERMISSION_DENIED
                ? 'Location permission is off. The visit cannot be verified without it.'
                : null,
          }));
        },
        // enableHighAccuracy asks for GPS rather than a coarse network fix, which is the
        // difference between a usable fix and one above the 100 m cap.
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
      );
    };

    const stop = (): void => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };

    /**
     * Stop watching when the page is hidden.
     *
     * Not an optimisation -- an honesty measure. A backgrounded tab is throttled or suspended,
     * so fixes captured then are stale or absent anyway. Releasing the watch makes the gap
     * explicit in the trace, which is what `coverageRatio` is there to score.
     */
    const onVisibility = (): void => {
      const visible = !document.hidden;
      setState((s) => ({ ...s, visible }));
      if (visible) {
        start();
        void requestWakeLock();
        void flush();
      } else {
        stop();
      }
    };

    /**
     * Screen Wake Lock.
     *
     * Opportunistic, never required. It holds only while the tab is visible and releases the
     * moment it is not, so it keeps a fix from being lost mid-interaction -- it is NOT an
     * instruction to brandish a lit phone in a shop, which would defeat the point of a
     * mystery visit (D-005, and the clarification in D-010).
     */
    const requestWakeLock = async (): Promise<void> => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
        };
        if (!nav.wakeLock || document.hidden) return;
        wakeLockRef.current = await nav.wakeLock.request('screen');
        setState((s) => ({ ...s, wakeLock: true }));
      } catch {
        // Denied, unsupported, or the tab lost focus. Never fatal.
        setState((s) => ({ ...s, wakeLock: false }));
      }
    };

    const onOnline = (): void => {
      setState((s) => ({ ...s, online: true }));
      void flush();
    };
    const onOffline = (): void => setState((s) => ({ ...s, online: false }));

    start();
    void requestWakeLock();
    void flush();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const flushTimer = setInterval(() => void flush(), 20_000);

    return () => {
      stop();
      clearInterval(flushTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      void wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [active, record, flush]);

  useEffect(() => {
    setState((s) => ({ ...s, pending: queueSize(sessionId) }));
  }, [sessionId]);

  return state;
}
