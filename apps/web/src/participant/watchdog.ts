/**
 * When to conclude that location capture has silently died.
 *
 * Pure, and separated from the hook, because this is the one judgement in the capture layer
 * that is non-obvious and fails without a sound. Everything else there is plumbing.
 *
 * The problem it solves, observed rather than imagined: on a 50 minute drive the capture layer
 * produced four fixes at a perfect 30 s cadence and then two isolated fixes in the remaining
 * 48 minutes. `watchPosition` had either been released by the OS or had stopped delivering, and
 * NOTHING NOTICED -- because the design deliberately treats a missing fix as a gap rather than
 * an error, which is right for scoring and blind for diagnosis. A stuck watch and an honest
 * dark screen look identical from the inside.
 *
 * The distinction this makes is between the two:
 *
 * - The screen is off or the tab is backgrounded: capture is SUPPOSED to be stopped. Silence is
 *   correct and the gap is honest evidence. Never restart here -- it would be a lie about what
 *   was observed, and the OS would refuse anyway.
 * - The page is visible and the watch has said nothing at all -- no fix, and no error either --
 *   for longer than any working receiver would go quiet: the watch is presumed dead.
 *
 * "Said nothing AT ALL" is the load-bearing part. A receiver that cannot get a lock still fires
 * the error callback on its timeout, so a live-but-struggling watch keeps proving it is alive.
 * Only a watch that has stopped calling back entirely trips this.
 */

/** Any callback from the geolocation API -- a fix OR an error. Both prove the watch is alive. */
export interface CaptureLiveness {
  /** When the current watch was attached. The reference point before any callback arrives. */
  attachedAt: number;
  /** The last time the watch called back at all, or null if it never has. */
  lastSignalAt: number | null;
  /** Whether the page is visible right now. */
  visible: boolean;
}

/**
 * Three sampling intervals, matching the `maxGap` the verification engine uses for coverage.
 *
 * Not arbitrary: it is the same window the server already treats as "we did not observe this",
 * so the client gives up on a watch at exactly the point the server stops crediting it. A
 * shorter window would restart a watch that is merely slow -- `watchPosition` is given a 20 s
 * timeout, so a struggling receiver can legitimately be quiet for a while.
 */
export const STALE_AFTER_MS = 90_000;

export function isCaptureStale(
  { attachedAt, lastSignalAt, visible }: CaptureLiveness,
  now: number,
  staleAfterMs: number = STALE_AFTER_MS,
): boolean {
  // A backgrounded tab is meant to be silent. Restarting would be both futile and dishonest.
  if (!visible) return false;
  const since = lastSignalAt ?? attachedAt;
  return now - since >= staleAfterMs;
}

/**
 * How long to wait before trusting a freshly restarted watch again.
 *
 * Without this the watchdog can spin: restart, get nothing (because the real problem is that
 * the device has no signal at all), immediately declare it stale again, restart. Each restart
 * resets `attachedAt`, so the interval below is what actually bounds the rate.
 */
export const MIN_RESTART_INTERVAL_MS = 30_000;

export function shouldRestart(
  liveness: CaptureLiveness,
  lastRestartAt: number | null,
  now: number,
  staleAfterMs: number = STALE_AFTER_MS,
): boolean {
  if (!isCaptureStale(liveness, now, staleAfterMs)) return false;
  if (lastRestartAt !== null && now - lastRestartAt < MIN_RESTART_INTERVAL_MS) return false;
  return true;
}
