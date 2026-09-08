import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { AuthUser, SessionEvent, SessionState } from '@msp/shared';
import type { ClientSession, Model } from 'mongoose';
import { Venue } from '../db/schemas/org-venue.schema.js';
import { Assignment } from '../db/schemas/task-session.schema.js';
import {
  Session,
  SessionEventDoc,
  type VenueSnapshot,
} from '../db/schemas/task-session.schema.js';
import { transition } from './state-machine.js';

export interface SessionView {
  id: string;
  state: SessionState;
  /** So the client knows whether to show the consent gate. */
  consentedAt: Date | null;
  venue: { name: string; lat: number; lng: number; radiusM: number; indoor: boolean };
  startedAt: Date | null;
  endedAt: Date | null;
  pingCount: number;
  /**
   * Why a terminal session ended, in words, or null while it is still live.
   *
   * The state alone says `abandoned` and leaves the participant to guess which of three
   * different things happened to them. D-019: the engine already distinguishes them, so the
   * screen should too.
   */
  terminalReason: string | null;
  /**
   * The same thing as a code, so a client can say it in its own language.
   *
   * `terminalReason` is English, composed on the server. It is the ONLY server-generated
   * string a participant sees, so without this the Arabic pass would produce a screen that is
   * Arabic everywhere except the one sentence explaining what went wrong (D-022). The numbers
   * travel with it in `timeouts` rather than being baked into the text.
   */
  terminalReasonCode: TerminalReasonCode | null;
  /** The configured timers, so a localised message can name them without a second endpoint. */
  timeouts: { abandonMinutes: number; hardCapHours: number };
}

export type TerminalReasonCode = 'never_started' | 'went_quiet' | 'no_report' | 'expired';

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
    @InjectModel(Assignment.name) private readonly assignments: Model<Assignment>,
    private readonly config: ConfigService,
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
   * Record consent.
   *
   * Server clock, server-recorded, against the assignment rather than the session: consent is
   * to take part in the task, and it survives a session being abandoned and re-created.
   * Idempotent -- consenting twice keeps the FIRST timestamp, because the question a dispute
   * asks is when they first agreed, not when they last tapped the button.
   */
  async consent(
    sessionId: string,
    user: AuthUser,
    consentVersion: string,
  ): Promise<{ consentedAt: Date; consentVersion: string }> {
    const session = await this.assertOwned(sessionId, user);
    const existing = await this.assignments
      .findById(session.assignmentId)
      .lean<{ consentedAt: Date | null; consentVersion: string | null }>();
    if (!existing) throw new NotFoundException('Assignment not found');

    if (existing.consentedAt) {
      return { consentedAt: existing.consentedAt, consentVersion: existing.consentVersion ?? consentVersion };
    }

    const now = new Date();
    await this.assignments.updateOne(
      { _id: session.assignmentId },
      { $set: { consentedAt: now, consentVersion } },
    );
    return { consentedAt: now, consentVersion };
  }

  /** The visits belonging to the signed-in participant. Never takes an id from the caller. */
  async mine(user: AuthUser): Promise<SessionView[]> {
    /**
     * Live visits, plus anything the reaper closed in the last day.
     *
     * Without the second half a reaped visit simply VANISHES from the participant's list, and
     * the one person entitled to know why never finds out. A day is long enough to cover
     * "I came back the next morning" and short enough that the list does not become a history
     * screen, which is not what this is (D-019).
     */
    const reapedSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.sessions
      .find({
        participantId: user.id,
        $or: [
          { state: { $in: ['pending', 'active', 'ended'] } },
          { state: { $in: ['abandoned', 'expired'] }, lastSeenAt: { $gte: reapedSince } },
        ],
      })
      .sort({ createdAtServer: -1 })
      .limit(20)
      .lean<{ _id: unknown }[]>();
    return Promise.all(rows.map((r) => this.view(String(r._id))));
  }

  /**
   * Start a visit.
   *
   * Takes the venue snapshot here (D-012): the geofence the participant is judged against is
   * the one in force when they started, not whatever an admin edits it to later.
   *
   * Refuses without consent. Starting location capture on someone who has not agreed to it
   * would make the consent screen decoration, and this is the most sensitive data the system
   * collects.
   */
  async start(sessionId: string, user: AuthUser): Promise<SessionView> {
    const session = await this.assertOwned(sessionId, user);

    const assignment = await this.assignments
      .findById(session.assignmentId)
      .lean<{ consentedAt: Date | null }>();
    if (!assignment?.consentedAt) {
      throw new ConflictException({
        code: 'CONSENT_REQUIRED',
        message: 'Location capture cannot start until the participant has consented.',
      });
    }
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
      assignmentId: string;
      startedAt: Date | null;
      endedAt: Date | null;
      pingCount: number;
      venueSnapshot: VenueSnapshot | null;
    }>();
    if (!s) throw new NotFoundException('Session not found');

    const assignment = await this.assignments
      .findById(s.assignmentId)
      .select({ consentedAt: 1 })
      .lean<{ consentedAt: Date | null }>();

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
      consentedAt: assignment?.consentedAt ?? null,
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
      terminalReason: this.terminalReason(s.state, s.startedAt, s.endedAt),
      terminalReasonCode: this.terminalReasonCode(s.state, s.startedAt, s.endedAt),
      timeouts: { abandonMinutes: this.abandonMinutes(), hardCapHours: this.hardCapHours() },
    };
  }

  /** The machine-readable twin of `terminalReason`. Same branches, no prose. */
  private terminalReasonCode(
    state: SessionState,
    startedAt: Date | null,
    endedAt: Date | null,
  ): TerminalReasonCode | null {
    if (state === 'expired') return 'expired';
    if (state !== 'abandoned') return null;
    if (startedAt === null) return 'never_started';
    if (endedAt === null) return 'went_quiet';
    return 'no_report';
  }

  private abandonMinutes(): number {
    return Math.round(Number(this.config.get('SESSION_ABANDON_AFTER_SECONDS') ?? 900) / 60);
  }

  private hardCapHours(): number {
    return Math.round(Number(this.config.get('SESSION_HARD_CAP_SECONDS') ?? 10800) / 3600);
  }

  /**
   * Plain English for a terminal state.
   *
   * Which of the three abandonment cases applies is derived from the document rather than read
   * back out of `sessionEvents`: a session with no `startedAt` never began, one with a
   * `startedAt` and no `endedAt` went quiet mid-visit, and one with both finished but never
   * filed a report. That is the same information without a second query per row.
   *
   * The numbers come from config so this text cannot drift away from the timers that produced
   * it.
   */
  private terminalReason(
    state: SessionState,
    startedAt: Date | null,
    endedAt: Date | null,
  ): string | null {
    const mins = this.abandonMinutes();
    const hours = this.hardCapHours();

    if (state === 'expired') {
      return `This visit reached the ${hours}-hour limit for a single session and was closed automatically. Location was no longer being recorded.`;
    }
    if (state === 'abandoned') {
      if (startedAt === null) {
        return `This visit was never started, and was closed automatically after ${mins} minutes.`;
      }
      if (endedAt === null) {
        return `No location update arrived for ${mins} minutes, so this visit was closed automatically. Capture stops when the screen locks or the tab is backgrounded.`;
      }
      return `This visit was ended but no report was filed within ${mins} minutes, so it was closed automatically.`;
    }
    return null;
  }

  /** A participant may only act on their own session. Read from the token, never the body. */
  private async assertOwned(
    sessionId: string,
    user: AuthUser,
  ): Promise<{ venueId: string; participantId: string; assignmentId: string }> {
    const s = await this.sessions
      .findById(sessionId)
      .select({ participantId: 1, venueId: 1, assignmentId: 1 })
      .lean<{ participantId: string; venueId: string; assignmentId: string }>();
    if (!s) throw new NotFoundException('Session not found');
    if (s.participantId !== user.id) {
      throw new ForbiddenException('This session belongs to another participant');
    }
    return s;
  }
}
