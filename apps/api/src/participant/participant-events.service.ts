import { Injectable } from '@nestjs/common';
import type { NotificationKind } from '@msp/shared';
import { Observable, Subject, filter } from 'rxjs';

export interface ParticipantEvent {
  /** Monotonic per process. Sent as the SSE event id so a reconnect can ask for the rest. */
  id: number;
  participantId: string;
  kind: NotificationKind;
  sessionId: string;
  /** Enough to render a notification line without a second round trip. */
  title: string;
  venueName: string;
  at: string;
}

/**
 * In-process pub/sub for one participant's notifications, plus a short replay buffer.
 *
 * A near-twin of `VisitEventsService`, and deliberately a separate class rather than a
 * generalisation of it. They differ in the only thing that matters about either: the tenancy
 * key. The console stream is keyed on `clientOrgId` and fans one event out to everyone in an
 * organisation; this one is keyed on `participantId` and fans out to exactly one person.
 * Merging them behind a generic `topic` string would make the subject boundary a parameter,
 * and a parameterised tenancy boundary is how one gets crossed (rule 2). The duplication is
 * about forty lines and it is worth more than that.
 *
 * Same single-instance caveat as D-013: in-process, so a second API replica splits the
 * streams. Honest for one container, and the first thing to replace under horizontal scaling.
 */
@Injectable()
export class ParticipantEventsService {
  private readonly stream = new Subject<ParticipantEvent>();
  private readonly recent = new Map<string, ParticipantEvent[]>();
  private nextId = 1;

  /** Events retained per participant for replay across a reconnect. */
  static readonly REPLAY_BUFFER = 20;

  publish(event: Omit<ParticipantEvent, 'id' | 'at'>): ParticipantEvent {
    const full: ParticipantEvent = { ...event, id: this.nextId++, at: new Date().toISOString() };

    const bucket = this.recent.get(full.participantId) ?? [];
    bucket.push(full);
    if (bucket.length > ParticipantEventsService.REPLAY_BUFFER) bucket.shift();
    this.recent.set(full.participantId, bucket);

    this.stream.next(full);
    return full;
  }

  /**
   * Events for one participant only.
   *
   * The id comes from the verified token at the call site. There is no query parameter for it
   * and there must never be one: unlike the console stream, where the worst case is seeing a
   * peer organisation's visit counts, the worst case here is reading another person's work
   * history.
   */
  forParticipant(participantId: string): Observable<ParticipantEvent> {
    return this.stream.pipe(filter((e) => e.participantId === participantId));
  }

  /** Everything after `lastEventId` that this process still holds. */
  replay(participantId: string, lastEventId: number): ParticipantEvent[] {
    return (this.recent.get(participantId) ?? []).filter((e) => e.id > lastEventId);
  }
}
