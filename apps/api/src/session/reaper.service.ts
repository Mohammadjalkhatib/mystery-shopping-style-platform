import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import type { SessionState } from '@msp/shared';
import type { Model } from 'mongoose';
import { Session } from '../db/schemas/task-session.schema.js';
import { SessionsService } from './sessions.service.js';
import { dueEvent, type SessionTimeoutConfig } from './state-machine.js';

/**
 * How many overdue sessions one read may close.
 *
 * This runs inside a request that a user is waiting on, so it has to be bounded. The cap is
 * not a correctness limit: anything left over is picked up by the next read, because the
 * filter is "still overdue" rather than "not yet seen". It only bounds the worst case, which
 * is the first read after a long outage.
 */
const MAX_PER_SWEEP = 100;

/** Non-terminal states. Anything here can still have a timer fire against it. */
const LIVE_STATES: SessionState[] = ['pending', 'active', 'ended'];

/**
 * The reaper. Lazy, on read -- not a cron (D-016, D-019).
 *
 * `dueEvent()` and `SessionsService.apply()` have existed and been tested since the state
 * machine landed, and nothing called them, so `abandoned` and `expired` were unreachable in
 * practice. This is the caller.
 *
 * Why not an in-process cron: on a free tier the service sleeps, or stays awake only while a
 * third-party pinger keeps hitting it, so a cron stops silently on a missed ping, an exhausted
 * allowance or a redeploy -- and `SESSION_ABANDON_AFTER_SECONDS` is 900, the same order as the
 * idle window. A read-triggered sweep cannot drift out of sync with the hosting, because if
 * nobody is reading, nobody is being shown a stale answer either.
 *
 * **This must never break the read it is attached to.** Every failure here is swallowed and
 * logged: a session that cannot be reaped is a stale row, while a throw would be a broken
 * page. That asymmetry is the whole reason this is safe to put in a read path.
 */
@Injectable()
export class ReaperService {
  private readonly logger = new Logger('Reaper');

  constructor(
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    private readonly sessionsService: SessionsService,
    private readonly config: ConfigService,
  ) {}

  private timeouts(): SessionTimeoutConfig {
    return {
      abandonAfterSeconds: Number(this.config.get('SESSION_ABANDON_AFTER_SECONDS') ?? 900),
      hardCapSeconds: Number(this.config.get('SESSION_HARD_CAP_SECONDS') ?? 10800),
    };
  }

  /** Before a participant reads their own visits. */
  async reapForParticipant(participantId: string, now: Date = new Date()): Promise<number> {
    return this.sweep({ participantId }, now);
  }

  /**
   * Before the console reads an org's visits.
   *
   * This is the trigger that actually matters. Abandonment IS the participant not coming
   * back, so a participant-only trigger never fires for the sessions that most need it -- the
   * console would show a stale `active` visit for ever. D-019.
   *
   * `null` means an admin, who is scoped to no single org and therefore sweeps all of them.
   */
  async reapForOrg(clientOrgId: string | null, now: Date = new Date()): Promise<number> {
    return this.sweep(clientOrgId === null ? {} : { clientOrgId }, now);
  }

  /**
   * Find sessions whose timers may have fired and push each through the state machine.
   *
   * The candidate query is deliberately WIDER than the rule: it selects anything that could
   * plausibly be due and then lets `dueEvent()` decide, so the timer logic has exactly one
   * home and stays a pure, table-tested function. A filter that tried to encode the rule in
   * Mongo would be a second copy of it, free to disagree.
   */
  private async sweep(scope: Record<string, unknown>, now: Date): Promise<number> {
    const cfg = this.timeouts();
    const abandonCutoff = new Date(now.getTime() - cfg.abandonAfterSeconds * 1000);
    const expireCutoff = new Date(now.getTime() - cfg.hardCapSeconds * 1000);

    const candidates = await this.sessions
      .find({
        ...scope,
        state: { $in: LIVE_STATES },
        // Both branches are index-backed: { state, lastSeenAt } and { state, startedAt } exist
        // for exactly this pair of scans. A session pinging happily has a fresh lastSeenAt and
        // never appears in the first branch, which is why the second one is not redundant.
        $or: [
          { lastSeenAt: { $lte: abandonCutoff } },
          { createdAtServer: { $lte: abandonCutoff } },
          { startedAt: { $ne: null, $lte: expireCutoff } },
        ],
      })
      .select({ _id: 1, state: 1, createdAtServer: 1, startedAt: 1, lastSeenAt: 1 })
      .limit(MAX_PER_SWEEP)
      .lean<
        {
          _id: unknown;
          state: SessionState;
          createdAtServer: Date;
          startedAt: Date | null;
          lastSeenAt: Date;
        }[]
      >();

    let reaped = 0;
    for (const s of candidates) {
      const event = dueEvent(
        s.state,
        {
          createdAt: s.createdAtServer.getTime(),
          startedAt: s.startedAt ? s.startedAt.getTime() : null,
          lastSeenAt: s.lastSeenAt.getTime(),
        },
        cfg,
        now.getTime(),
      );
      if (!event) continue;

      try {
        // Still goes through the funnel, so an illegal combination cannot slip past just
        // because a timer says so, and the transition is recorded in sessionEvents like any
        // other. `endedAt` is NOT set: the participant did not end this visit, and claiming
        // they did would put a time on a thing that never happened.
        await this.sessionsService.apply(String(s._id), event, 'system:reaper', { now });
        reaped++;
      } catch {
        // Lost a race with a real request, or the row moved underneath us. Either way the
        // user's read must still succeed -- see the class comment.
        this.logger.debug(`Could not ${event} session ${String(s._id)}; leaving it for the next read.`);
      }
    }

    if (reaped > 0) this.logger.log(`Reaped ${reaped} session(s) on read.`);
    return reaped;
  }
}
