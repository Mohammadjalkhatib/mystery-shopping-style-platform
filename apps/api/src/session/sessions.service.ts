import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AuthUser, SessionEvent, SessionState } from '@msp/shared';
import type { ClientSession, Model } from 'mongoose';
import { Venue } from '../db/schemas/org-venue.schema.js';
import {
  Session,
  SessionEventDoc,
  type VenueSnapshot,
} from '../db/schemas/task-session.schema.js';
import { transition } from './state-machine.js';

export interface SessionView {
  id: string;
  state: SessionState;
  venue: { name: string; lat: number; lng: number; radiusM: number; indoor: boolean };
  startedAt: Date | null;
  endedAt: Date | null;
  pingCount: number;
}

/**
 * The HTTP-facing half of the session lifecycle. The pure state machine decides what is
 * legal; this applies the decision, records it, and owns every timestamp.
 *
 * No `startedAt`, `endedAt` or state value is ever accepted from a client (rule 2). The only
 * thing a participant can send is the intent to make a transition.
 */
@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    @InjectModel(SessionEventDoc.name) private readonly events: Model<SessionEventDoc>,
    @InjectModel(Venue.name) private readonly venues: Model<Venue>,
  ) {}

  /**
   * Apply one event to one session.
   *
   * The single funnel for every state change in the system, including the reaper's. Three
   * things happen together and in this order:
   *
   * 1. the pure state machine is asked whether the transition is legal;
   * 2. the update is applied with the CURRENT STATE IN THE FILTER, so two concurrent
   *    requests cannot both win -- the second matches nothing and is reported as the
   *    conflict it is, rather than silently overwriting the first;
   * 3. an append-only `sessionEvent` records what happened.
   *
   * An illegal transition is a 409 carrying the current state and the events that WOULD have
   * been legal, which is exactly what the state machine's rejection already provides (rule 5).
   */
  async apply(
    sessionId: string,
    event: SessionEvent,
    actor: string,
    opts: { extraSet?: Record<string, unknown>; dbSession?: ClientSession; now?: Date } = {},
  ): Promise<{ from: SessionState; to: SessionState }> {
    const now = opts.now ?? new Date();
    const current = await this.sessions
      .findById(sessionId)
      .select({ state: 1 })
      .lean<{ state: SessionState }>();
    if (!current) throw new NotFoundException('Session not found');

    const decision = transition(current.state, event);
    if (!decision.ok) {
      throw new ConflictException({
        code: decision.code,
        message: decision.reason,
        state: decision.from,
        allowed: decision.allowed,
      });
    }

    const updated = await this.sessions.findOneAndUpdate(
      // The current state is part of the filter, so this is a compare-and-swap.
      { _id: sessionId, state: decision.from },
      { $set: { state: decision.to, lastSeenAt: now, ...(opts.extraSet ?? {}) } },
      { returnDocument: 'after', session: opts.dbSession },
    );

    if (!updated) {
      // Someone else moved it between the read and the write.
      const latest = await this.sessions
        .findById(sessionId)
        .select({ state: 1 })
        .lean<{ state: SessionState }>();
      throw new ConflictException({
        code: 'ILLEGAL_TRANSITION',
        message: `Session changed state concurrently; it is now ${latest?.state ?? 'gone'}.`,
        state: latest?.state ?? null,
        allowed: [],
      });
    }

    await this.events.create(
      [
        {
          sessionId,
          from: decision.from,
          event: decision.event,
          to: decision.to,
          at: now,
          actor,
        },
      ],
      { session: opts.dbSession },
    );

    return { from: decision.from, to: decision.to };
  }

  /**
   * Start a visit.
   *
   * Takes the venue snapshot here (D-012): the geofence the participant is judged against is
   * the one in force when they started, not whatever an admin edits it to later.
   */
  async start(sessionId: string, user: AuthUser): Promise<SessionView> {
    const session = await this.assertOwned(sessionId, user);
    const venue = await this.venues.findById(session.venueId).lean<{
      name: string;
      location: { coordinates: [number, number] };
      radiusM: number;
      nearBufferM: number;
      indoor: boolean;
    }>();
    if (!venue) throw new NotFoundException('Venue not found');

    const now = new Date();
    const [lng, lat] = venue.location.coordinates;
    const snapshot: VenueSnapshot = {
      lat,
      lng,
      radiusM: venue.radiusM,
      nearBufferM: venue.nearBufferM,
      indoor: venue.indoor,
      snapshotAt: now,
    };

    await this.apply(sessionId, 'start', user.id, {
      now,
      extraSet: { startedAt: now, venueSnapshot: snapshot },
    });
    return this.view(sessionId);
  }

  /** End a visit. The report is a separate call, because ending and submitting are different. */
  async end(sessionId: string, user: AuthUser): Promise<SessionView> {
    await this.assertOwned(sessionId, user);
    const now = new Date();
    await this.apply(sessionId, 'end', user.id, { now, extraSet: { endedAt: now } });
    return this.view(sessionId);
  }

  async view(sessionId: string): Promise<SessionView> {
    const s = await this.sessions.findById(sessionId).lean<{
      _id: unknown;
      state: SessionState;
      venueId: string;
      startedAt: Date | null;
      endedAt: Date | null;
      pingCount: number;
      venueSnapshot: VenueSnapshot | null;
    }>();
    if (!s) throw new NotFoundException('Session not found');

    // Prefer the snapshot: it is what the participant is actually being judged against.
    const venue = await this.venues.findById(s.venueId).lean<{
      name: string;
      location: { coordinates: [number, number] };
      radiusM: number;
      indoor: boolean;
    }>();

    const snap = s.venueSnapshot;
    return {
      id: String(s._id),
      state: s.state,
      venue: {
        name: venue?.name ?? 'Unknown venue',
        lat: snap?.lat ?? venue?.location.coordinates[1] ?? 0,
        lng: snap?.lng ?? venue?.location.coordinates[0] ?? 0,
        radiusM: snap?.radiusM ?? venue?.radiusM ?? 0,
        indoor: snap?.indoor ?? venue?.indoor ?? false,
      },
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      pingCount: s.pingCount,
    };
  }

  /** A participant may only act on their own session. Read from the token, never the body. */
  private async assertOwned(
    sessionId: string,
    user: AuthUser,
  ): Promise<{ venueId: string; participantId: string }> {
    const s = await this.sessions
      .findById(sessionId)
      .select({ participantId: 1, venueId: 1 })
      .lean<{ participantId: string; venueId: string }>();
    if (!s) throw new NotFoundException('Session not found');
    if (s.participantId !== user.id) {
      throw new ForbiddenException('This session belongs to another participant');
    }
    return s;
  }
}
