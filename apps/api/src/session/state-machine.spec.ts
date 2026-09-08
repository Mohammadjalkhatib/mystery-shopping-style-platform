import { SESSION_EVENTS, SESSION_STATES, type SessionEvent, type SessionState } from '@msp/shared';
import {
  allowedEvents,
  canTransition,
  dueEvent,
  isTerminal,
  transition,
  type SessionTimeoutConfig,
  type SessionTimings,
} from './state-machine.js';

/**
 * The state machine is one of the two places where being wrong is expensive and silent, so
 * the illegal transitions are enumerated exhaustively over the full state x event product
 * rather than sampled. A hand-picked list of rejections is exactly how a transition gets
 * quietly added later without anyone noticing.
 */

/** The complete legal set. Every other pair in the product must be rejected. */
const LEGAL: ReadonlyArray<[SessionState, SessionEvent, SessionState]> = [
  ['pending', 'start', 'active'],
  ['pending', 'abandon', 'abandoned'],
  ['active', 'end', 'ended'],
  ['active', 'abandon', 'abandoned'],
  ['active', 'expire', 'expired'],
  ['ended', 'submit', 'submitted'],
  ['ended', 'abandon', 'abandoned'],
];

const isLegal = (from: SessionState, event: SessionEvent): boolean =>
  LEGAL.some(([f, e]) => f === from && e === event);

describe('session state machine', () => {
  describe('legal transitions', () => {
    it.each(LEGAL)('%s + %s -> %s', (from, event, expected) => {
      const result = transition(from, event);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.to).toBe(expected);
        expect(result.from).toBe(from);
        expect(result.event).toBe(event);
      }
    });

    it('covers every legal pair exactly once, with no duplicates', () => {
      const keys = LEGAL.map(([f, e]) => `${f}+${e}`);
      expect(new Set(keys).size).toBe(LEGAL.length);
    });
  });

  describe('illegal transitions, exhaustively', () => {
    // The full product. 6 states x 5 events = 30 pairs, 7 legal, 23 that must be rejected.
    const product: Array<[SessionState, SessionEvent]> = SESSION_STATES.flatMap((s) =>
      SESSION_EVENTS.map((e) => [s, e] as [SessionState, SessionEvent]),
    );

    const illegal = product.filter(([s, e]) => !isLegal(s, e));

    it('the product is fully partitioned into legal and illegal', () => {
      expect(product).toHaveLength(SESSION_STATES.length * SESSION_EVENTS.length);
      expect(illegal).toHaveLength(product.length - LEGAL.length);
      // Guard against the vocabulary drifting without this test being updated.
      expect(product).toHaveLength(30);
      expect(illegal).toHaveLength(23);
    });

    it.each(illegal)('rejects %s + %s', (from, event) => {
      const result = transition(from, event);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('ILLEGAL_TRANSITION');
        // Rule 5: the rejection carries the current state so the 409 can report it.
        expect(result.from).toBe(from);
        expect(result.event).toBe(event);
        expect(result.reason).toBeTruthy();
        expect(result.allowed).not.toContain(event);
      }
    });

    it('never silently no-ops: every illegal pair returns ok:false, none return the same state', () => {
      for (const [from, event] of illegal) {
        const result = transition(from, event);
        expect(result).not.toMatchObject({ ok: true, to: from });
      }
    });
  });

  describe('self-transitions', () => {
    // Called out separately because "end an already-ended session" is the double-tap a
    // participant on a flaky phone connection will actually produce.
    it.each(SESSION_STATES)('no event returns %s to itself', (state) => {
      for (const event of SESSION_EVENTS) {
        const result = transition(state, event);
        if (result.ok) expect(result.to).not.toBe(state);
      }
    });
  });

  describe('terminal states', () => {
    const terminals: SessionState[] = ['submitted', 'abandoned', 'expired'];
    const nonTerminals: SessionState[] = ['pending', 'active', 'ended'];

    it.each(terminals)('%s is terminal', (s) => {
      expect(isTerminal(s)).toBe(true);
      expect(allowedEvents(s)).toEqual([]);
    });

    it.each(nonTerminals)('%s is not terminal', (s) => {
      expect(isTerminal(s)).toBe(false);
      expect(allowedEvents(s).length).toBeGreaterThan(0);
    });

    it.each(terminals)('%s rejects every event with a terminal-specific reason', (s) => {
      for (const event of SESSION_EVENTS) {
        const result = transition(s, event);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain('terminal');
      }
    });
  });

  describe('canTransition agrees with transition', () => {
    it.each(
      SESSION_STATES.flatMap((s) => SESSION_EVENTS.map((e) => [s, e] as [SessionState, SessionEvent])),
    )('%s + %s', (from, event) => {
      expect(canTransition(from, event)).toBe(transition(from, event).ok);
    });
  });

  describe('timers', () => {
    const config: SessionTimeoutConfig = {
      abandonAfterSeconds: 900, // 15 min, matches SESSION_ABANDON_AFTER_SECONDS
      hardCapSeconds: 10800, // 3 h, matches SESSION_HARD_CAP_SECONDS
    };
    const T0 = 1_700_000_000_000;
    const timings = (over: Partial<SessionTimings> = {}): SessionTimings => ({
      createdAt: T0,
      startedAt: T0,
      lastSeenAt: T0,
      ...over,
    });

    it('fires nothing while the session is fresh', () => {
      expect(dueEvent('active', timings(), config, T0 + 60_000)).toBeNull();
    });

    it('abandons an active session that has gone quiet past the window', () => {
      expect(dueEvent('active', timings(), config, T0 + 900_000)).toBe('abandon');
    });

    it('does not abandon one second before the window', () => {
      expect(dueEvent('active', timings(), config, T0 + 899_000)).toBeNull();
    });

    it('measures pending sessions from createdAt, not lastSeenAt', () => {
      // A pending session has never pinged, so lastSeenAt is meaningless for it.
      const t = timings({ createdAt: T0, lastSeenAt: T0 + 10_000_000, startedAt: null });
      expect(dueEvent('pending', t, config, T0 + 900_000)).toBe('abandon');
    });

    it('expires an active session at the hard cap', () => {
      // Still pinging, so not idle -- only the hard cap can fire here.
      const t = timings({ startedAt: T0, lastSeenAt: T0 + 10_800_000 });
      expect(dueEvent('active', t, config, T0 + 10_800_000)).toBe('expire');
    });

    it('prefers expire over abandon when both have fired', () => {
      // Quiet AND over the cap. Expiry is the more accurate reason to show the participant.
      expect(dueEvent('active', timings(), config, T0 + 20_000_000)).toBe('expire');
    });

    it('never fires the hard cap on a session that never started', () => {
      const t = timings({ startedAt: null });
      expect(dueEvent('pending', t, config, T0 + 20_000_000)).toBe('abandon');
    });

    it('abandons an ended session that was never submitted', () => {
      expect(dueEvent('ended', timings(), config, T0 + 900_000)).toBe('abandon');
    });

    it('never expires an ended session, because tracking has stopped', () => {
      const t = timings({ startedAt: T0, lastSeenAt: T0 + 20_000_000 });
      expect(dueEvent('ended', t, config, T0 + 20_000_000)).toBeNull();
    });

    it.each(['submitted', 'abandoned', 'expired'] as SessionState[])(
      'fires nothing for terminal state %s',
      (state) => {
        expect(dueEvent(state, timings(), config, T0 + 100_000_000)).toBeNull();
      },
    );

    it('every event a timer can produce is legal in the state that produced it', () => {
      // The reaper still routes through transition(); this guards against a timer that
      // fires an event the state machine would then reject.
      const cases: Array<[SessionState, SessionTimings, number]> = [
        ['pending', timings({ startedAt: null }), T0 + 20_000_000],
        ['active', timings(), T0 + 900_000],
        ['active', timings({ lastSeenAt: T0 + 10_800_000 }), T0 + 10_800_000],
        ['ended', timings(), T0 + 900_000],
      ];
      for (const [state, t, now] of cases) {
        const event = dueEvent(state, t, config, now);
        expect(event).not.toBeNull();
        if (event) expect(canTransition(state, event)).toBe(true);
      }
    });
  });

  describe('purity', () => {
    it('is a function of its arguments only -- same input, same output', () => {
      const a = transition('active', 'end');
      const b = transition('active', 'end');
      expect(a).toEqual(b);
    });

    it('does not mutate the caller timings object', () => {
      const t: SessionTimings = { createdAt: 1, startedAt: 1, lastSeenAt: 1 };
      const snapshot = { ...t };
      dueEvent('active', t, { abandonAfterSeconds: 1, hardCapSeconds: 1 }, 999_999);
      expect(t).toEqual(snapshot);
    });
  });
});
