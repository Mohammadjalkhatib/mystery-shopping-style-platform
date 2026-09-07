import { useEffect, useRef, useState } from 'react';
import type { Verdict } from '@msp/shared';
import { API_BASE, tokenStore } from '../api/client.js';

export interface VisitEvent {
  id: number;
  clientOrgId: string;
  sessionId: string;
  verdict: Verdict;
  score: number;
  venueName: string;
  participantId: string;
  endedAt: string | null;
  at: string;
}

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'stopped';

/**
 * Subscribe to the live visit feed.
 *
 * **Why this is not `EventSource`.** The browser's EventSource API cannot send custom
 * headers, and this API authenticates with a bearer token. The alternatives were putting the
 * token in the query string -- where it lands in access logs, proxy logs and browser history
 * -- or switching the whole app to cookie auth for the sake of one endpoint. Reading the
 * stream with `fetch` and a ReadableStream keeps the Authorization header and costs about
 * thirty lines.
 *
 * It also makes `Last-Event-ID` explicit rather than magic: we track the last id we saw and
 * send it on reconnect, so events that happened during the gap are replayed instead of being
 * lost. D-004 assumed native reconnection removed the need for reconnection code; that is
 * true of the transport and false of the requirement.
 */
export function useVisitStream(onVisit: (e: VisitEvent) => void): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  // Refs so reconnecting does not depend on render timing.
  const lastId = useRef<number>(0);
  const handler = useRef(onVisit);
  handler.current = onVisit;

  useEffect(() => {
    const abort = new AbortController();
    let stopped = false;
    let backoff = 1000;

    const run = async (): Promise<void> => {
      while (!stopped) {
        try {
          const res = await fetch(`${API_BASE}/console/stream`, {
            signal: abort.signal,
            headers: {
              Authorization: `Bearer ${tokenStore.get() ?? ''}`,
              Accept: 'text/event-stream',
              // Ask the server to replay anything we missed while disconnected.
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
              parseFrame(frame, lastId, handler.current);
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
  }, []);

  return status;
}

function parseFrame(
  frame: string,
  lastId: { current: number },
  onVisit: (e: VisitEvent) => void,
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
  if (event !== 'visit' || !data) return;

  try {
    onVisit(JSON.parse(data) as VisitEvent);
  } catch {
    // A malformed frame must not kill the stream.
  }
}
