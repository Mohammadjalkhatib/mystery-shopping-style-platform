import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AuthUser } from '@msp/shared';
import type { Model } from 'mongoose';
import { haversineM, presenceFor } from '../geo/haversine.js';
import { Ping } from '../db/schemas/ping.schema.js';
import { Venue } from '../db/schemas/org-venue.schema.js';
import { MAX_PINGS_PER_SESSION, Session } from '../db/schemas/task-session.schema.js';
import { allowedEvents } from '../session/state-machine.js';
import type { CreatePingBatchDto } from './dto/create-ping.dto.js';

export interface IngestResult {
  /** Fixes that were new. A duplicate flush reports 0 and is not an error. */
  accepted: number;
  /** Fixes already stored under this (sessionId, clientPingId). */
  duplicates: number;
  /** Fixes dropped because capturedAt fell outside the session window. */
  rejectedOutOfWindow: number;
  pingCount: number;
  remainingBudget: number;
}

/**
 * Ping ingest. Everything here exists because of a specific finding in D-010 or D-012, and
 * the comments say which -- these are not general precautions, they are patched holes.
 */
@Injectable()
export class PingsService {
  constructor(
    @InjectModel(Ping.name) private readonly pings: Model<Ping>,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    @InjectModel(Venue.name) private readonly venues: Model<Venue>,
  ) {}

  async ingest(
    sessionId: string,
    dto: CreatePingBatchDto,
    user: AuthUser,
    now: Date = new Date(),
  ): Promise<IngestResult> {
    const session = await this.sessions.findById(sessionId).lean<{
      _id: unknown;
      participantId: string;
      venueId: string;
      state: string;
      startedAt: Date | null;
      pingCount: number;
      venueSnapshot: {
        lat: number;
        lng: number;
        radiusM: number;
        nearBufferM: number;
      } | null;
    }>();
    if (!session) throw new NotFoundException('Session not found');

    // A participant may only ping their own session. Checked from the token, never from the
    // body (rule 2). Admins are not exempt: there is no reason for an admin to post fixes.
    if (session.participantId !== user.id) {
      throw new ForbiddenException('This session belongs to another participant');
    }

    /**
     * Fixes are accepted only while the session is `active` (D-010).
     *
     * Without this a participant could end the visit and then flush a forged queue before
     * submitting, because the state machine legitimately allows `ended -> submit`. An illegal
     * state returns 409 carrying the current state and what would have been legal, which is
     * exactly what the state machine's rejection already provides (rule 5).
     */
    if (session.state !== 'active') {
      throw new ConflictException({
        code: 'SESSION_NOT_ACTIVE',
        message: `Cannot accept fixes for a session in state ${session.state}.`,
        state: session.state,
        allowed: allowedEvents(session.state as never),
      });
    }

    /**
     * Measure against the SNAPSHOT taken when the visit started, not the live venue.
     *
     * D-012 pinned `venueSnapshot` so an admin editing a geofence could not change a verdict
     * after the fact, and the evaluator was switched over. Ingest was not, which left the fix
     * half applied: the evaluator took the venue from the snapshot while every fix carried a
     * `distanceM` and `presence` computed here against whatever the venue looked like at the
     * moment that fix arrived. Edit a venue mid-visit and one trace ends up holding two
     * vintages of geofence -- the exact failure D-010 item 5 and D-012 each fixed one half of.
     *
     * The snapshot is written at `start` and fixes are only accepted while `active`, so it is
     * always present for anything ingested today. The fallback is for sessions that began
     * before the field existed. D-021.
     */
    const snap = session.venueSnapshot;
    let centre: { lat: number; lng: number };
    let fence: { radiusM: number; nearBufferM: number };

    if (snap) {
      centre = { lat: snap.lat, lng: snap.lng };
      fence = { radiusM: snap.radiusM, nearBufferM: snap.nearBufferM };
    } else {
      const venue = await this.venues.findById(session.venueId).lean<{
        location: { coordinates: [number, number] };
        radiusM: number;
        nearBufferM: number;
      }>();
      if (!venue) throw new NotFoundException('Venue not found');
      const [venueLng, venueLat] = venue.location.coordinates;
      centre = { lat: venueLat, lng: venueLng };
      fence = { radiusM: venue.radiusM, nearBufferM: venue.nearBufferM };
    }

    const windowStart = session.startedAt ? session.startedAt.getTime() : 0;
    let rejectedOutOfWindow = 0;
    let accepted = 0;
    let duplicates = 0;

    for (const fix of dto.fixes) {
      /**
       * THE most important line in this file (D-010): the server clock is read PER FIX,
       * inside the loop, never once per batch.
       *
       * A batch-level stamp makes every intra-batch interval zero, which collapses
       * coverageRatio, zeroes dwellSeconds, and silently disables the teleport check for the
       * whole batch via its `seconds <= 0` guard. It punishes the honest offline flush and
       * hands an attacker a free pass through the same bug. `batchFlushedHonestVisit` in the
       * engine fixtures is that failure written as a test.
       */
      const receivedAt = new Date();

      /**
       * Bound the device clock against the session window (D-010).
       *
       * `capturedAt` is untrusted, and nothing else stops a fix claiming to predate the
       * session or to arrive from the future. Out-of-window fixes are dropped rather than
       * failing the batch: one bad clock reading should not reject nineteen good fixes.
       */
      const capturedAt = new Date(fix.capturedAt);
      const capturedMs = capturedAt.getTime();
      if (
        !Number.isFinite(capturedMs) ||
        capturedMs < windowStart - CLOCK_GRACE_MS ||
        capturedMs > now.getTime() + CLOCK_GRACE_MS
      ) {
        rejectedOutOfWindow++;
        continue;
      }

      // Server-computed. Never accepted from the client, and not derivable by it either.
      const distanceM = haversineM({ lat: fix.lat, lng: fix.lng }, centre);
      const presence = presenceFor(distanceM, fix.accuracyM, fence);

      /**
       * Idempotent on (sessionId, clientPingId), FIRST-WRITE-WINS (rule 4, D-010).
       *
       * `$setOnInsert`, never `$set`. With `$set` a client could resend a stored
       * clientPingId carrying different coordinates and quietly move a fix after the fact.
       */
      const res = await this.pings.updateOne(
        { sessionId, clientPingId: fix.clientPingId },
        {
          $setOnInsert: {
            sessionId,
            clientPingId: fix.clientPingId,
            capturedAt,
            receivedAt,
            lat: fix.lat,
            lng: fix.lng,
            accuracyM: fix.accuracyM,
            distanceM,
            presence,
          },
        },
        { upsert: true },
      );

      if (res.upsertedCount > 0) accepted++;
      else duplicates++;
    }

    /**
     * One atomic conditional update does the budget check, the state re-check and the
     * lastSeenAt move together (D-012).
     *
     * A read-then-check in this service would be a TOCTOU across two concurrent batch
     * flushes -- precisely the offline-queue scenario rule 4 exists for.
     *
     * `$inc` uses `accepted`, the number of documents ACTUALLY inserted, never the batch
     * length. `$setOnInsert` already makes a re-flush a no-op on pings, but incrementing by
     * batch length would still burn the budget, turning rule 4's safety guarantee into a
     * slow leak.
     */
    const updated = await this.sessions.findOneAndUpdate(
      {
        _id: sessionId,
        state: 'active',
        pingCount: { $lte: MAX_PINGS_PER_SESSION - accepted },
      },
      { $inc: { pingCount: accepted }, $set: { lastSeenAt: now } },
      { returnDocument: 'after' },
    );

    if (!updated) {
      // Either the session left `active` mid-batch, or the budget is exhausted.
      throw new ConflictException({
        code: 'PING_BUDGET_EXHAUSTED',
        message:
          `This session has reached its limit of ${MAX_PINGS_PER_SESSION} fixes, or is no ` +
          'longer active. The fixes in this batch were stored but the session was not advanced.',
        limit: MAX_PINGS_PER_SESSION,
      });
    }

    return {
      accepted,
      duplicates,
      rejectedOutOfWindow,
      pingCount: updated.pingCount,
      remainingBudget: MAX_PINGS_PER_SESSION - updated.pingCount,
    };
  }
}

/**
 * Tolerance on the device clock, either side of the session window.
 *
 * Generous on purpose: a phone with a drifting clock is an honest participant, and D-010's
 * review of `clockSkew` established that penalising ordinary queue latency taxes exactly the
 * offline buffering rule 4 exists to make safe. This bound is here to stop a fix claiming to
 * be from last week, not to police a few minutes of drift.
 */
export const CLOCK_GRACE_MS = 6 * 60 * 60 * 1000;
