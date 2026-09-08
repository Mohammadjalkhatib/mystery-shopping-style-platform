export interface QueuedFix {
  clientPingId: string;
  capturedAt: string;
  lat: number;
  lng: number;
  accuracyM: number;
}

const KEY = (sessionId: string): string => `msp.queue.${sessionId}`;
/** The server accepts up to 20 fixes per batch. */
const BATCH = 20;

/**
 * The offline buffer for location fixes.
 *
 * **localStorage, not IndexedDB, and that is a deliberate deviation from the backlog.**
 *
 * The backlog said IndexedDB. What that requirement actually needs is: survive a tab reload
 * and a period offline, then flush safely. The payload is a few hundred fixes of five short
 * fields -- single-digit kilobytes, nowhere near the ~5 MB localStorage limit, and the
 * per-session ping cap bounds it structurally. IndexedDB would buy async writes and a much
 * larger ceiling, and cost an async wrapper, a schema version, an upgrade path and a set of
 * failure modes to handle, for data that is deleted minutes later.
 *
 * The safety property that matters is not the storage engine. It is that every fix carries a
 * `clientPingId` generated ONCE at capture time and stored with it, so a flush that runs
 * twice is a no-op server-side (rule 4, first-write-wins). That holds identically here.
 *
 * If evidence upload or a much longer visit lands, this becomes IndexedDB. Recorded in D-014.
 */

function read(sessionId: string): QueuedFix[] {
  try {
    const raw = localStorage.getItem(KEY(sessionId));
    return raw ? (JSON.parse(raw) as QueuedFix[]) : [];
  } catch {
    // Corrupt or unavailable storage must not stop a visit. Losing the buffer is a gap in
    // the trace, which the engine already treats as a normal condition.
    return [];
  }
}

function write(sessionId: string, fixes: QueuedFix[]): void {
  try {
    localStorage.setItem(KEY(sessionId), JSON.stringify(fixes));
  } catch {
    // Quota or private mode. Same reasoning: a gap, not a failure.
  }
}

export function enqueue(sessionId: string, fix: QueuedFix): void {
  write(sessionId, [...read(sessionId), fix]);
}

export function queueSize(sessionId: string): number {
  return read(sessionId).length;
}

/**
 * Send everything queued, in batches, removing only what was accepted.
 *
 * A batch that fails stays in the queue and is retried on the next flush. That retry is safe
 * precisely because the ids were generated at capture time rather than at send time -- the
 * server sees the same `clientPingId` and reports it as a duplicate instead of storing it
 * twice or moving the original.
 */
export async function drainQueue(
  sessionId: string,
  send: (fixes: QueuedFix[]) => Promise<void>,
): Promise<number> {
  let sent = 0;
  for (;;) {
    const queue = read(sessionId);
    if (queue.length === 0) return sent;

    const batch = queue.slice(0, BATCH);
    await send(batch);

    // Re-read rather than reusing `queue`: a fix may have been captured while the request
    // was in flight, and slicing a stale array would drop it.
    const after = read(sessionId).filter(
      (f) => !batch.some((b) => b.clientPingId === f.clientPingId),
    );
    write(sessionId, after);
    sent += batch.length;
  }
}

export function clearQueue(sessionId: string): void {
  try {
    localStorage.removeItem(KEY(sessionId));
  } catch {
    /* nothing to do */
  }
}
