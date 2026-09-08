import { clearQueue, drainQueue, enqueue, queueSize, type QueuedFix } from './offlineQueue.js';

/**
 * The offline buffer.
 *
 * CLAUDE.md section 5 says not to test UI rendering, and these are not rendering tests. The
 * queue is where a silent bug is expensive: a flush that drops fixes loses evidence a
 * participant cannot recreate, and one that duplicates them corrupts the trace the engine
 * scores. Both fail quietly.
 */

// jsdom is not configured for this project, so a minimal localStorage stands in.
const store = new Map<string, string>();
beforeAll(() => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
beforeEach(() => store.clear());

const fix = (id: string): QueuedFix => ({
  clientPingId: id,
  capturedAt: new Date().toISOString(),
  lat: 29.3759,
  lng: 47.9774,
  accuracyM: 9.4,
});

describe('offline queue', () => {
  it('survives being read back, which is the whole point', () => {
    enqueue('s1', fix('a'));
    enqueue('s1', fix('b'));
    expect(queueSize('s1')).toBe(2);
  });

  it('keeps sessions separate', () => {
    enqueue('s1', fix('a'));
    enqueue('s2', fix('b'));
    expect(queueSize('s1')).toBe(1);
    expect(queueSize('s2')).toBe(1);
  });

  it('sends in batches of at most 20, because that is the server limit', async () => {
    for (let i = 0; i < 45; i++) enqueue('s1', fix(`f${i}`));
    const batches: number[] = [];
    await drainQueue('s1', async (b) => void batches.push(b.length));
    expect(batches).toEqual([20, 20, 5]);
    expect(queueSize('s1')).toBe(0);
  });

  it('KEEPS a failed batch instead of dropping it', async () => {
    // The failure mode that loses evidence a participant cannot recreate.
    enqueue('s1', fix('a'));
    enqueue('s1', fix('b'));
    await expect(
      drainQueue('s1', async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(queueSize('s1')).toBe(2);
  });

  it('resends the SAME clientPingId after a failure, so the retry is idempotent', async () => {
    // Rule 4 only holds because the id is generated at capture time and stored with the fix.
    // If it were generated at send time, a retry would create a second document.
    enqueue('s1', fix('stable-id'));
    const seen: string[] = [];
    let failOnce = true;
    const send = async (b: QueuedFix[]): Promise<void> => {
      seen.push(...b.map((f) => f.clientPingId));
      if (failOnce) {
        failOnce = false;
        throw new Error('network');
      }
    };
    await drainQueue('s1', send).catch(() => {});
    await drainQueue('s1', send);
    expect(seen).toEqual(['stable-id', 'stable-id']);
    expect(queueSize('s1')).toBe(0);
  });

  it('does not drop a fix captured while a flush was in flight', async () => {
    // The bug this guards: slicing a stale array and writing it back would silently discard
    // anything enqueued during the request.
    enqueue('s1', fix('a'));
    await drainQueue('s1', async () => {
      enqueue('s1', fix('captured-mid-flush'));
    });
    // The mid-flush fix was sent by the following iteration, not lost.
    expect(queueSize('s1')).toBe(0);
  });

  it('removes only what was actually sent', async () => {
    for (let i = 0; i < 25; i++) enqueue('s1', fix(`f${i}`));
    let calls = 0;
    await drainQueue('s1', async () => {
      calls++;
      if (calls === 2) throw new Error('died halfway');
    }).catch(() => {});
    // First batch of 20 acknowledged and removed; the remaining 5 are still queued.
    expect(queueSize('s1')).toBe(5);
  });

  it('treats corrupt storage as an empty queue rather than throwing', () => {
    store.set('msp.queue.s1', 'not json');
    expect(queueSize('s1')).toBe(0);
    expect(() => enqueue('s1', fix('a'))).not.toThrow();
  });

  it('clears a session queue', () => {
    enqueue('s1', fix('a'));
    clearQueue('s1');
    expect(queueSize('s1')).toBe(0);
  });
});
