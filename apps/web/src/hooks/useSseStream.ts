import { useEffect, useRef, useState } from 'react';
import { API_BASE, tokenStore } from '../api/client.js';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'stopped';

/**
 * Read one authenticated SSE stream, with explicit `Last-Event-ID` replay.
 *
 * **Why this is not `EventSource`.** The browser's EventSource API cannot send custom headers,
 * and this API authenticates with a bearer token. The alternatives were putting the token in
 * the query string -- where it lands in access logs, proxy logs and browser history -- or
 * switching the whole app to cookie auth for the sake of one endpoint. Reading the stream with
 * `fetch` and a ReadableStream keeps the Authorization header and costs about thirty lines
 * (D-013).
 *
 * It also makes `Last-Event-ID` explicit rather than magic: the last id seen is tracked and
 * sent on reconnect, so events that happened during the gap are replayed instead of being lost.
 * D-004 assumed native reconnection removed the need for reconnection code; that is true of the
 * transport and false of the requirement.
 *
 * Extracted from `useVisitStream` when the participant gained a notification stream of its own.
 * The two differ only in the path and the event name, and thirty lines of frame parsing and
 * backoff is not something to keep two copies of -- a fix to one would silently not reach the
 * other.
 */
export function useSseStream<T>(
  path: string,
  eventName: string,
  onEvent: (e: T) => void,
): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  // Refs so reconnecting does not depend on render timing.
  const lastId = useRef<number>(0);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const abort = new AbortController();
    let stopped = false;
    let backoff = 1000;

    const run = async (): Promise<void> => {
      while (!stopped) {
        try {
          const res = await fetch(`${API_BASE}${path}`, {
            signal: abort.signal,
            headers: {
              Authorization: `Bearer ${tokenStore.get() ?? ''}`,
              Accept: 'text/event-stream',
              // Ask the server to replay anything missed while disconnected.
              ...(lastId.current ? { 'Last-Event-ID': String(lastId.current) } : {}),
            },
          });
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

          setStatus('live');
          backoff = 1000;

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // SSE frames are separated by a blank line.
            let split: number;
            while ((split = buffer.indexOf('\n\n')) !== -1) {
              const frame = buffer.slice(0, split);
              buffer = buffer.slice(split + 2);
              parseFrame(frame, eventName, lastId, handler.current as (e: unknown) => void);
            }
          }
          // Clean end of stream: fall through and reconnect.
          if (!stopped) setStatus('reconnecting');
        } catch {
          if (stopped) return;
          setStatus('reconnecting');
        }

        if (stopped) return;
        await new Promise((r) => setTimeout(r, backoff));
        // Capped exponential backoff, so a server that is down does not get hammered.
        backoff = Math.min(backoff * 2, 15_000);
      }
    };

    void run();
    return () => {
      stopped = true;
      setStatus('stopped');
      abort.abort();
    };
  }, [path, eventName]);

  return status;
}

function parseFrame(
  frame: string,
  wanted: string,
  lastId: { current: number },
  onEvent: (e: unknown) => void,
): void {
  let event = 'message';
  let data = '';
  let id: number | null = null;

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
    else if (line.startsWith('id:')) {
      const n = Number(line.slice(3).trim());
      if (Number.isFinite(n)) id = n;
    }
    // A line starting with ':' is a comment/keep-alive and is deliberately ignored.
  }

  // Track the id even for heartbeats, so a reconnect never asks for something already seen.
  if (id !== null) lastId.current = Math.max(lastId.current, id);
  if (event !== wanted || !data) return;

  try {
    onEvent(JSON.parse(data));
  } catch {
    // A malformed frame must not kill the stream.
  }
}
