import type { SessionEvent, SessionState } from '@msp/shared';

/**
 * Pure session state machine. CLAUDE.md section 4: no Mongoose, no I/O, no implicit clock.
 *
 * Every state change in the system goes through `transition`. It never silently no-ops: an
 * illegal transition returns a typed rejection carrying the current state, which the HTTP
 * layer maps to a 409 (CLAUDE.md rule 5).
 *
 * Time is passed in, never read. `Date.now()` does not appear in this file, which is what
 * makes the timer rules testable without faking timers.
 */

/* --------------------------------------------------------------- the states */

/**
 * - `pending`   consent given and assignment accepted, not yet on site
 * - `active`    on site, sampling location
 * - `ended`     participant pressed "end visit"; the report is not written yet
 * - `submitted` report written. Terminal. This is what enqueues verification
 * - `abandoned` reaped after inactivity. Terminal
 * - `expired`   hit the hard cap on session duration. Terminal
 */
const TERMINAL: ReadonlySet<SessionState> = new Set<SessionState>([
  'submitted',
  'abandoned',
  'expired',
]);

export function isTerminal(state: SessionState): boolean {
  return TERMINAL.has(state);
}

/* ---------------------------------------------------------- the transitions */

/**
 * The allowlist. Anything not written here is illegal, including every self-transition.
 *
 * Deliberate omissions worth stating, because "why is this not here" is the question a
 * reviewer will ask:
 *
 * - `ended -> expired`. The hard cap bounds how long we *track* someone. Once they have
 *   ended the visit we are no longer tracking, so an unsubmitted report is `abandon`,
 *   not `expire`. Keeping both would make two timers race for the same document.
 * - anything out of a terminal state. Verification results are append-only (rule 8) and a
 *   verdict that could be reopened by a state change would break that.
 * - `pending -> expired`. A session that never started has nothing to cap.
 */
const ALLOWED: ReadonlyMap<SessionState, ReadonlyMap<SessionEvent, SessionState>> = new Map([
  [
    'pending',
    new Map<SessionEvent, SessionState>([
      ['start', 'active'],
      // accepted but never showed up inside the window
      ['abandon', 'abandoned'],
    ]),
  ],
  [
    'active',
    new Map<SessionEvent, SessionState>([
      ['end', 'ended'],
      // no usable fix for SESSION_ABANDON_AFTER_SECONDS
      ['abandon', 'abandoned'],
      // SESSION_HARD_CAP_SECONDS reached while still on site
      ['expire', 'expired'],
    ]),
  ],
  [
    'ended',
    new Map<SessionEvent, SessionState>([
      ['submit', 'submitted'],
      // ended the visit but never wrote the report
      ['abandon', 'abandoned'],
    ]),
  ],
  ['submitted', new Map<SessionEvent, SessionState>()],
  ['abandoned', new Map<SessionEvent, SessionState>()],
  ['expired', new Map<SessionEvent, SessionState>()],
]);

export type TransitionResult =
  | { ok: true; from: SessionState; event: SessionEvent; to: SessionState }
  | {
      ok: false;
      code: 'ILLEGAL_TRANSITION';
      from: SessionState;
      event: SessionEvent;
      /** What the caller could legally have sent instead. Goes into the 409 body. */
      allowed: SessionEvent[];
      reason: string;
    };

export function canTransition(from: SessionState, event: SessionEvent): boolean {
  return ALLOWED.get(from)?.has(event) ?? false;
}

/** Every event this state will currently accept. Empty for terminal states. */
export function allowedEvents(from: SessionState): SessionEvent[] {
  return [...(ALLOWED.get(from)?.keys() ?? [])];
}

export function transition(from: SessionState, event: SessionEvent): TransitionResult {
  const to = ALLOWED.get(from)?.get(event);
  if (to === undefined) {
    const allowed = allowedEvents(from);
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      from,
      event,
      allowed,
      reason: isTerminal(from)
        ? `Session is already ${from}, which is terminal. No further transitions are possible.`
        : `Cannot ${event} a session in state ${from}. Allowed here: ${
            allowed.length ? allowed.join(', ') : 'nothing'
          }.`,
    };
  }
  return { ok: true, from, event, to };
}

/* -------------------------------------------------------------- the timers */

export interface SessionTimings {
  /** Server clock, set when the session entered `pending`. */
  createdAt: number;
  /** Server clock, set on `start`. Null while pending. */
  startedAt: number | null;
  /**
   * Server clock of the last thing we heard from this session -- a ping, or the `end` call.
   * Never a client-supplied timestamp (CLAUDE.md rule 2 and rule 3).
   */
  lastSeenAt: number;
}

export interface SessionTimeoutConfig {
  /** Inactivity before a session is reaped. SESSION_ABANDON_AFTER_SECONDS. */
  abandonAfterSeconds: number;
  /** Maximum wall-clock life of an active session. SESSION_HARD_CAP_SECONDS. */
  hardCapSeconds: number;
}

/**
 * Which timer, if any, has fired for this session as of `now`.
 *
 * Returns the event the reaper should apply, or null. The reaper is the only caller, and it
 * still has to push the result through `transition`, so an illegal combination cannot slip
 * past just because a timer says so.
 *
 * Expiry is checked before abandonment: a session that has blown the hard cap has usually
 * also gone quiet, and "you were tracked for the maximum time" is a more accurate reason to
 * show a participant than "you went quiet".
 */
export function dueEvent(
  state: SessionState,
  timings: SessionTimings,
  config: SessionTimeoutConfig,
  now: number,
): SessionEvent | null {
  if (isTerminal(state)) return null;

  if (state === 'active' && timings.startedAt !== null) {
    if (now - timings.startedAt >= config.hardCapSeconds * 1000) return 'expire';
  }

  const idleSince = state === 'pending' ? timings.createdAt : timings.lastSeenAt;
  if (now - idleSince >= config.abandonAfterSeconds * 1000) return 'abandon';

  return null;
}
