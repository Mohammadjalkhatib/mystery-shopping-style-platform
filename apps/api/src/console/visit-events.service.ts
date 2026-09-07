import { Injectable } from '@nestjs/common';
import type { Verdict } from '@msp/shared';
import { Observable, Subject, filter, map } from 'rxjs';

export interface VisitEvent {
  /** Monotonic per process. Sent as the SSE event id so a reconnect can ask for the rest. */
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
 * In-process pub/sub for completed visits, plus a short replay buffer.
 *
 * The buffer is the interesting part. D-004 chose SSE partly because "browsers reconnect SSE
 * natively, so there is no reconnection code to write" -- which is true of the TRANSPORT and
 * false of the REQUIREMENT. On reconnect the browser sends `Last-Event-ID`; if the server
 * ignores it, every event that occurred during the gap is lost silently, and "the visit
 * appears with no refresh" is the one thing the brief actually asks for. So the last N events
 * per org are kept and replayed on request.
 *
 * In-process and therefore single-instance. That is honest for this build (one API container,
 * one free-tier dyno) and it is the first thing that breaks under horizontal scaling -- at
 * which point this becomes a Mongo change stream or Redis pub/sub. Recorded in D-013.
 */
@Injectable()
export class VisitEventsService {
  private readonly stream = new Subject<VisitEvent>();
  private readonly recent = new Map<string, VisitEvent[]>();
  private nextId = 1;

  /** Events retained per org for replay across a reconnect. */
  static readonly REPLAY_BUFFER = 50;

  publish(event: Omit<VisitEvent, 'id' | 'at'>): VisitEvent {
    const full: VisitEvent = { ...event, id: this.nextId++, at: new Date().toISOString() };

    const bucket = this.recent.get(full.clientOrgId) ?? [];
    bucket.push(full);
    if (bucket.length > VisitEventsService.REPLAY_BUFFER) bucket.shift();
    this.recent.set(full.clientOrgId, bucket);

    this.stream.next(full);
    return full;
  }

  /**
   * Events for one organisation only.
   *
   * The org comes from the verified token at the call site, never from a query parameter --
   * otherwise the tenancy boundary would be a suggestion (rule 2).
   */
  forOrg(clientOrgId: string): Observable<VisitEvent> {
    return this.stream.pipe(filter((e) => e.clientOrgId === clientOrgId));
  }

  /** Everything after `lastEventId` that this process still holds. */
  replay(clientOrgId: string, lastEventId: number): VisitEvent[] {
    return (this.recent.get(clientOrgId) ?? []).filter((e) => e.id > lastEventId);
  }

  /** Test seam. */
  asMessages(clientOrgId: string): Observable<{ id: string; type: string; data: string }> {
    return this.forOrg(clientOrgId).pipe(
      map((e) => ({ id: String(e.id), type: 'visit', data: JSON.stringify(e) })),
    );
  }
}
