import type { Verdict } from '@msp/shared';
import { useSseStream, type StreamStatus } from './useSseStream.js';

export type { StreamStatus };

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

/**
 * Subscribe to the live visit feed for the signed-in user's organisation.
 *
 * The transport lives in `useSseStream`, which is where the reasoning about `EventSource`,
 * bearer tokens and `Last-Event-ID` replay now sits. The org is never named here: it comes
 * from the verified token on the server, so there is no parameter that could disagree with it.
 */
export function useVisitStream(onVisit: (e: VisitEvent) => void): StreamStatus {
  return useSseStream<VisitEvent>('/console/stream', 'visit', onVisit);
}
