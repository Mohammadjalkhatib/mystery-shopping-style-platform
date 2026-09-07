import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Ping } from '../db/schemas/ping.schema.js';
import {
  OutboxEntry,
  VerificationResultDoc,
} from '../db/schemas/report-verification.schema.js';
import { Session, type VenueSnapshot } from '../db/schemas/task-session.schema.js';
import { evaluate } from './engine.js';
import { DEFAULT_ENGINE_CONFIG, type EngineConfig, type EvidenceFix, type VisitEvidence } from './types.js';

/**
 * How long a claimed outbox row may stay claimed before another worker may take it.
 *
 * Closes a D-012 finding: `status: 'processing'` was set on claim and nothing ever moved it
 * back, so a worker that died mid-row left that visit unverified and un-retried, forever and
 * silently. Rule 9 promised a retry for a FAILED attempt; it said nothing about a LOST one.
 */
export const LEASE_SECONDS = 120;
export const MAX_ATTEMPTS = 5;

@Injectable()
export class EvaluatorService {
  private readonly logger = new Logger('Evaluator');
  private readonly config: EngineConfig;

  constructor(
    @InjectModel(OutboxEntry.name) private readonly outbox: Model<OutboxEntry>,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    @InjectModel(Ping.name) private readonly pings: Model<Ping>,
    @InjectModel(VerificationResultDoc.name)
    private readonly results: Model<VerificationResultDoc>,
    configService: ConfigService,
  ) {
    // Thresholds are config, not constants, because they are placeholders until there is
    // labelled data to tune them against (D-001, D-009).
    const num = (k: string, d: number): number => {
      const v = Number(configService.get<string>(k));
      return Number.isFinite(v) && v > 0 ? v : d;
    };
    this.config = {
      ...DEFAULT_ENGINE_CONFIG,
      autoThreshold: num('VERIFY_AUTO_THRESHOLD', DEFAULT_ENGINE_CONFIG.autoThreshold),
      rejectThreshold: num('VERIFY_REJECT_THRESHOLD', DEFAULT_ENGINE_CONFIG.rejectThreshold),
      engineVersion:
        configService.get<string>('VERIFY_ENGINE_VERSION') ?? DEFAULT_ENGINE_CONFIG.engineVersion,
    };
  }

  /** Drain the queue. Returns how many rows were processed. */
  async drain(limit = 25, now: Date = new Date()): Promise<number> {
    await this.reclaimStale(now);

    let processed = 0;
    for (let i = 0; i < limit; i++) {
      const row = await this.claimOne(now);
      if (!row) break;
      await this.process(String(row._id), row.sessionId, row.attempts, now);
      processed++;
    }
    return processed;
  }

  /**
   * Take back rows whose lease has expired.
   *
   * Deliberately does not care WHY the worker vanished -- crash, deploy, OOM. A row that has
   * been `processing` for longer than the lease is by definition not being worked on by
   * anything that will finish it.
   */
  async reclaimStale(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - LEASE_SECONDS * 1000);
    const res = await this.outbox.updateMany(
      { status: 'processing', lastAttemptAt: { $lt: cutoff } },
      { $set: { status: 'pending', runAfter: now } },
    );
    if (res.modifiedCount > 0) {
      this.logger.warn(
        `Reclaimed ${res.modifiedCount} outbox row(s) whose worker did not finish within ` +
          `${LEASE_SECONDS}s. Those visits would otherwise never have been verified.`,
      );
    }
    return res.modifiedCount;
  }

  /**
   * Atomically claim the oldest due row.
   *
   * findOneAndUpdate with the status in the filter, so two workers racing cannot both win:
   * the loser matches nothing and moves on.
   */
  private async claimOne(
    now: Date,
  ): Promise<{ _id: unknown; sessionId: string; attempts: number } | null> {
    return this.outbox.findOneAndUpdate(
      { status: 'pending', runAfter: { $lte: now } },
      { $set: { status: 'processing', lastAttemptAt: now }, $inc: { attempts: 1 } },
      { sort: { runAfter: 1 }, returnDocument: 'after' },
    );
  }

  private async process(
    rowId: string,
    sessionId: string,
    attempts: number,
    now: Date,
  ): Promise<void> {
    try {
      const result = await this.evaluateSession(sessionId);
      if (!result) {
        await this.outbox.updateOne(
          { _id: rowId },
          { $set: { status: 'failed', lastError: 'Session or evidence missing' } },
        );
        return;
      }
      await this.outbox.updateOne({ _id: rowId }, { $set: { status: 'done', lastError: null } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const giveUp = attempts >= MAX_ATTEMPTS;

      // Exponential backoff. A failing evaluator must not spin the queue.
      const delayMs = Math.min(60_000, 2 ** attempts * 1000);
      await this.outbox.updateOne(
        { _id: rowId },
        {
          $set: {
            status: giveUp ? 'failed' : 'pending',
            lastError: message.slice(0, 2000),
            runAfter: new Date(now.getTime() + delayMs),
          },
        },
      );
      this.logger.error(
        `Evaluation of session ${sessionId} failed (attempt ${attempts}${giveUp ? ', giving up' : ''}): ${message}`,
      );
    }
  }

  /**
   * Build the evidence object and run the pure engine over it.
   *
   * This function is the only bridge between the database and `apps/api/src/verification/`,
   * which is why the engine can stay free of Mongoose (CLAUDE.md section 4).
   */
  async evaluateSession(sessionId: string): Promise<VerificationResultDoc | null> {
    const session = await this.sessions.findById(sessionId).lean<{
      clientOrgId: string;
      startedAt: Date | null;
      endedAt: Date | null;
      venueSnapshot: VenueSnapshot | null;
    }>();
    if (!session?.startedAt || !session.endedAt || !session.venueSnapshot) return null;

    /**
     * The venue as it was when the visit started, NOT as it is now (D-012).
     *
     * Reading it live meant an admin editing `radiusM` between the visit and its evaluation
     * mixed two vintages of config into one verdict, which can make `proximity` contradict
     * `presence` in exactly the way D-010 item 5 fixed.
     */
    const snap = session.venueSnapshot;

    const fixes = await this.pings
      .find({ sessionId })
      .sort({ receivedAt: 1 })
      .lean<
        {
          capturedAt: Date;
          receivedAt: Date;
          lat: number;
          lng: number;
          accuracyM: number;
          distanceM: number;
          presence: EvidenceFix['presence'];
        }[]
      >();

    const evidence: VisitEvidence = {
      venue: {
        lat: snap.lat,
        lng: snap.lng,
        radiusM: snap.radiusM,
        nearBufferM: snap.nearBufferM,
        indoor: snap.indoor,
      },
      session: {
        startedAt: session.startedAt.getTime(),
        endedAt: session.endedAt.getTime(),
      },
      // The engine takes epoch millis, not Dates: it is pure and must not depend on Date.
      fixes: fixes.map((f) => ({
        capturedAt: f.capturedAt.getTime(),
        receivedAt: f.receivedAt.getTime(),
        lat: f.lat,
        lng: f.lng,
        accuracyM: f.accuracyM,
        distanceM: f.distanceM,
        presence: f.presence,
      })),
    };

    const output = evaluate(evidence, this.config);

    /**
     * Append-only (rule 8). A re-run writes a NEW document; the schema's pre-hook makes an
     * in-place update throw, so this cannot silently become an update later.
     */
    const [written] = await this.results.create([
      {
        sessionId,
        clientOrgId: session.clientOrgId,
        score: output.score,
        verdict: output.verdict,
        signals: output.signals,
        engineVersion: output.engineVersion,
        rollups: output.rollups,
      },
    ]);

    /**
     * Denormalise the pointer onto the session so the console list is one indexed query
     * rather than a join per row (D-012). The result itself stays append-only; the session
     * just points at the newest one.
     */
    await this.sessions.updateOne(
      { _id: sessionId },
      {
        $set: {
          latestResultId: String(written!._id),
          latestVerdict: output.verdict,
          latestScore: output.score,
        },
      },
    );

    this.logger.log(
      `Session ${sessionId}: ${output.verdict} (${output.score}) via ${output.engineVersion}`,
    );
    return written!;
  }
}
