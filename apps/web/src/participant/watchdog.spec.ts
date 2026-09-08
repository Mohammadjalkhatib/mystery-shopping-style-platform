import {
  isCaptureStale,
  MIN_RESTART_INTERVAL_MS,
  shouldRestart,
  STALE_AFTER_MS,
} from './watchdog.js';

const T0 = 1_700_000_000_000;

describe('capture watchdog', () => {
  describe('isCaptureStale', () => {
    it('is never stale while the page is hidden', () => {
      // The whole point. A backgrounded tab is SUPPOSED to be silent, the gap is honest
      // evidence, and restarting there would claim observation that did not happen.
      expect(
        isCaptureStale(
          { attachedAt: T0, lastSignalAt: T0, visible: false },
          T0 + STALE_AFTER_MS * 10,
        ),
      ).toBe(false);
    });

    it('is stale when a visible page has heard nothing for the whole window', () => {
      expect(
        isCaptureStale(
          { attachedAt: T0, lastSignalAt: T0, visible: true },
          T0 + STALE_AFTER_MS,
        ),
      ).toBe(true);
    });

    it('is not stale one millisecond early', () => {
      expect(
        isCaptureStale(
          { attachedAt: T0, lastSignalAt: T0, visible: true },
          T0 + STALE_AFTER_MS - 1,
        ),
      ).toBe(false);
    });

    it('counts from the last callback, not from when the watch was attached', () => {
      // A watch that has been alive for an hour and called back a second ago is healthy.
      expect(
        isCaptureStale(
          { attachedAt: T0, lastSignalAt: T0 + 3_600_000, visible: true },
          T0 + 3_600_001,
        ),
      ).toBe(false);
    });

    it('counts from attach when the watch has never called back at all', () => {
      // The iOS case: attached, never delivered, never errored. There is no lastSignalAt to
      // measure from, and this is exactly the failure worth catching.
      expect(
        isCaptureStale({ attachedAt: T0, lastSignalAt: null, visible: true }, T0 + STALE_AFTER_MS),
      ).toBe(true);
    });

    it('gives a freshly attached watch the full window before judging it', () => {
      expect(
        isCaptureStale({ attachedAt: T0, lastSignalAt: null, visible: true }, T0 + 1_000),
      ).toBe(false);
    });

    it('tolerates a struggling receiver that is still reporting errors', () => {
      // A receiver that cannot get a lock still fires the error callback on its timeout, so it
      // keeps proving it is alive. Only total silence trips this.
      const errorEvery20s = [20_000, 40_000, 60_000, 80_000, 100_000, 120_000];
      for (const t of errorEvery20s) {
        expect(
          isCaptureStale(
            { attachedAt: T0, lastSignalAt: T0 + t, visible: true },
            T0 + t + 19_000,
          ),
        ).toBe(false);
      }
    });
  });

  describe('shouldRestart', () => {
    const stale = { attachedAt: T0, lastSignalAt: T0, visible: true };

    it('restarts a stale watch that has never been restarted', () => {
      expect(shouldRestart(stale, null, T0 + STALE_AFTER_MS)).toBe(true);
    });

    it('does not restart a healthy watch', () => {
      expect(shouldRestart(stale, null, T0 + 1_000)).toBe(false);
    });

    it('refuses to spin when the device simply has no signal', () => {
      // Restart, hear nothing because there is genuinely nothing to hear, declare stale again.
      // Without the floor this loops as fast as the poll runs.
      const now = T0 + STALE_AFTER_MS;
      expect(shouldRestart(stale, now - 1_000, now)).toBe(false);
      expect(shouldRestart(stale, now - MIN_RESTART_INTERVAL_MS, now)).toBe(true);
    });

    it('never restarts a hidden page however long it has been quiet', () => {
      expect(
        shouldRestart(
          { ...stale, visible: false },
          null,
          T0 + STALE_AFTER_MS * 100,
        ),
      ).toBe(false);
    });
  });

  it('gives up on a watch at the same point the server stops crediting coverage', () => {
    // coverageRatio caps an unobserved gap at three sampling intervals. The client abandoning a
    // watch at a different threshold than the server abandons the evidence would be two numbers
    // free to disagree about the same thing.
    const SAMPLE_MS = 30_000;
    expect(STALE_AFTER_MS).toBe(SAMPLE_MS * 3);
  });
});
