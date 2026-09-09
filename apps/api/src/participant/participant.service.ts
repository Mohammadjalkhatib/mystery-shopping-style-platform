import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  AuthUser,
  NotificationKind,
  SessionState,
  Verdict,
  VisitOutcome,
} from '@msp/shared';
import type { Model } from 'mongoose';
import { Venue } from '../db/schemas/org-venue.schema.js';
import { Report, ReviewAction } from '../db/schemas/report-verification.schema.js';
import { Assignment, Session, Task } from '../db/schemas/task-session.schema.js';
import { SessionsService } from '../session/sessions.service.js';
import { terminalReasonCode, type TerminalReasonCode } from '../session/terminal-reason.js';
import { ParticipantEventsService } from './participant-events.service.js';
import { hasReadDecision, isReleased, releaseOutcome } from './outcome.js';

/** One row of the participant's own history. */
export interface ParticipantVisitRow {
  sessionId: string;
  state: SessionState;
  outcome: VisitOutcome;
  taskTitle: string;
  taskBrief: string;
  venueName: string;
  venueAddress: string;
  /** When the work was handed to them. This is what the list is sorted by. */
  assignedAt: Date;
  consentedAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  submittedAt: Date | null;
  /** The reviewer's words, or null. Never the internal note, never a signal (D-034). */
  feedback: string | null;
  decidedAt: Date | null;
  decidedByHuman: boolean;
  /** Their own report, echoed back. It is theirs; withholding it would be theatre. */
  report: { notes: string; rating: number } | null;
  terminalReasonCode: TerminalReasonCode | null;
  /** True once they have opened the assignment / read the decision. */
  seen: { assignment: boolean; outcome: boolean };
}

export interface ParticipantSummary {
  /**
   * Everything ever assigned to them. Counted in the database, NOT from the page below.
   *
   * The two differ the moment someone passes `countedOver` visits, and a lifetime total
   * quietly computed from the most recent page is wrong with nothing on screen to say so.
   */
  assigned: number;
  /** How many of the newest visits the rest of these numbers were computed over. */
  countedOver: number;
  /** Reports filed. */
  submitted: number;
  approved: number;
  notApproved: number;
  inReview: number;
  /** Assigned or ended but not carried through -- the number they can still act on. */
  openNow: number;
  closed: number;
  /**
   * Share of RELEASED decisions that were approvals, 0..1, or null with none released.
   * Over `countedOver` visits, not over `assigned`.
   */
  approvalRate: number | null;
  /** Mean of their own self-reported ratings. Their data, not a judgement of them. */
  averageRating: number | null;
}

export interface ParticipantNotification {
  kind: NotificationKind;
  sessionId: string;
  taskTitle: string;
  venueName: string;
  /** The event's own time: when it was assigned, or when the decision was released. */
  at: Date;
  outcome: VisitOutcome;
}

/** The page size ceiling. Same shape of guard as the console's list. */
const MAX_HISTORY = 200;
const DEFAULT_HISTORY = 50;

/**
 * Everything the PARTICIPANT reads about their own work.
 *
 * The mirror image of `ConsoleService`, and separate from it for the same reason the two SSE
 * services are separate: the tenancy key is different. Every read here is scoped to
 * `participantId` taken from the verified token, and there is no code path that accepts one
 * from a caller.
 *
 * Rule 6 is about the console, but the same discipline applies with more force here: this file
 * must never query the ping collection either. A participant has even less business reading a
 * raw location trace back than a business user does -- it is the most sensitive data in the
 * system and re-serving it is the one thing the TTL in rule 10 cannot protect against.
 *
 * What is released, and what is withheld, is `outcome.ts`. It is pure and tested; this file
 * only feeds it.
 */
@Injectable()
export class ParticipantService {
  constructor(
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    @InjectModel(Assignment.name) private readonly assignments: Model<Assignment>,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    @InjectModel(Venue.name) private readonly venues: Model<Venue>,
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    @InjectModel(ReviewAction.name) private readonly reviews: Model<ReviewAction>,
    private readonly sessionsService: SessionsService,
    private readonly events: ParticipantEventsService,
  ) {}

  /**
   * The participant's whole history, newest first.
   *
   * Served by `{ participantId: 1, createdAtServer: -1 }`. Sorted on when the work was
   * ASSIGNED rather than when it ended, because a pending assignment has no `endedAt` and
   * still has to appear -- it is the row they most need to act on.
   *
   * Batched rather than per-row: one query per collection with an `$in`, not four per visit.
   * This is a list screen and the N+1 shape would be felt on a phone on a slow connection,
   * which is the only device this screen is ever opened on.
   */
  async history(user: AuthUser, limit = DEFAULT_HISTORY): Promise<ParticipantVisitRow[]> {
    const rows = await this.sessions
      .find({ participantId: user.id })
      .sort({ createdAtServer: -1 })
      .limit(Math.min(Math.max(Math.trunc(limit) || DEFAULT_HISTORY, 1), MAX_HISTORY))
      .lean<SessionLean[]>();

    if (rows.length === 0) return [];
    return this.decorate(rows);
  }

  /**
   * The counts, over rows the caller has already fetched.
   *
   * Takes the rows rather than re-reading them: `GET /me/dashboard` renders the list and the
   * tiles from the same data, and computing them independently meant running `decorate()`
   * twice and paying two round trips to produce numbers that have to agree anyway.
   *
   * `assigned` is the one figure that cannot come from the page, so it is counted separately.
   */
  async summary(user: AuthUser, rows: ParticipantVisitRow[]): Promise<ParticipantSummary> {
    const assigned = await this.sessions.countDocuments({ participantId: user.id });

    const count = (o: VisitOutcome): number => rows.filter((r) => r.outcome === o).length;
    const approved = count('approved');
    const notApproved = count('not_approved');
    const released = approved + notApproved;
    const ratings = rows.map((r) => r.report?.rating).filter((n): n is number => typeof n === 'number');

    return {
      assigned,
      countedOver: rows.length,
      submitted: rows.filter((r) => r.state === 'submitted').length,
      approved,
      notApproved,
      inReview: count('in_review'),
      openNow: count('not_started') + count('in_progress') + count('awaiting_report'),
      closed: count('closed'),
      approvalRate: released === 0 ? null : approved / released,
      averageRating:
        ratings.length === 0
          ? null
          : Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10,
    };
  }

  /**
   * What the participant has not seen yet.
   *
   * DERIVED from the work, never stored as a message (D-035). A notification collection would
   * be a second copy of the truth that can drift from it -- a stored "you were assigned Venue
   * X" survives the assignment being reassigned, the venue being renamed, and the visit being
   * completed, and then contradicts the screen underneath it. The only thing persisted is the
   * one fact that cannot be derived: whether the person has looked.
   */
  async notifications(
    user: AuthUser,
    prefetched?: ParticipantVisitRow[],
  ): Promise<ParticipantNotification[]> {
    const rows = prefetched ?? (await this.history(user, MAX_HISTORY));

    const out: ParticipantNotification[] = [];
    for (const r of rows) {
      if (r.outcome === 'not_started' && !r.seen.assignment) {
        out.push({ kind: 'assignment', sessionId: r.sessionId, taskTitle: r.taskTitle, venueName: r.venueName, at: r.assignedAt, outcome: r.outcome });
      }
      if (isReleased(r.outcome) && !r.seen.outcome) {
        out.push({ kind: 'outcome', sessionId: r.sessionId, taskTitle: r.taskTitle, venueName: r.venueName, at: r.decidedAt ?? r.endedAt ?? r.assignedAt, outcome: r.outcome });
      }
    }
    // Newest first. A participant with a backlog cares about the most recent thing first.
    return out.sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  /**
   * Mark one notification read. Server clock (rule 2), never a client timestamp.
   *
   * The two kinds behave differently, and the asymmetry is the point:
   *
   * - `assignment` is written ONCE, guarded on the field still being unset. An assignment
   *   happens once, and the first time they looked is the fact worth keeping.
   * - `outcome` is written EVERY time, unguarded. A decision can be superseded -- a second
   *   `reviewAction` reversing the first, or a re-run under a newer engine -- and the marker
   *   is compared against the release time rather than read as a boolean, so it has to record
   *   the LAST read, not the first. Set-once here would silently suppress every reversal.
   *
   * Acking an outcome that has not been released is REFUSED rather than ignored. Otherwise a
   * client could ack an `in_review` visit and permanently suppress the notification for the
   * decision that had not arrived yet: a write that looks harmless and loses a message.
   *
   * Silently idempotent otherwise. Two tabs, or a retry on a flaky connection, is not a 409.
   */
  async markSeen(
    sessionId: string,
    user: AuthUser,
    kind: NotificationKind,
  ): Promise<{ ok: true }> {
    const s = await this.sessions.findById(sessionId).lean<SessionLean>();
    if (!s) throw new NotFoundException('Visit not found');
    if (s.participantId !== user.id) {
      throw new ForbiddenException('This visit belongs to another participant');
    }

    if (kind === 'assignment') {
      await this.sessions.updateOne(
        // `participantId` in the filter as well as checked above, so the guarantee is
        // structural rather than a remembered call order -- the shape `apply()` already uses.
        { _id: sessionId, participantId: user.id, assignmentSeenAt: null },
        { $set: { assignmentSeenAt: new Date() } },
      );
      return { ok: true };
    }

    const [decorated] = await this.decorate([s]);
    if (!decorated || !isReleased(decorated.outcome)) {
      throw new ConflictException({
        code: 'NOT_RELEASED',
        message: 'No decision has been released on this visit yet.',
      });
    }
    await this.sessions.updateOne(
      { _id: sessionId, participantId: user.id },
      { $set: { outcomeSeenAt: new Date() } },
    );
    return { ok: true };
  }

  /**
   * Announce a new assignment to its participant.
   *
   * Called by the authoring path AFTER its transaction commits, fire-and-forget, for the same
   * reason `EvaluatorRunner.kick()` is: a notification that cannot be delivered must not be
   * able to fail the write that caused it. If the stream is down the participant still sees the
   * assignment on their next read -- the list is the truth, the push is an optimisation.
   */
  async announceAssignment(sessionId: string): Promise<void> {
    const s = await this.sessions
      .findById(sessionId)
      .select({ participantId: 1, venueId: 1, assignmentId: 1 })
      .lean<{ participantId: string; venueId: string; assignmentId: string }>();
    if (!s) return;
    const [venue, task] = await Promise.all([
      this.venues.findById(s.venueId).select({ name: 1 }).lean<{ name: string }>(),
      this.taskForAssignment(s.assignmentId),
    ]);
    this.events.publish({
      participantId: s.participantId,
      kind: 'assignment',
      sessionId,
      title: task?.title ?? 'New visit',
      venueName: venue?.name ?? 'Unknown venue',
    });
  }

  /**
   * Announce a RELEASED decision to its participant.
   *
   * Called from the review path and from the evaluator. Checks the release rule itself rather
   * than trusting the caller: a push is a disclosure, and the one place that decides what a
   * participant may be told (D-034) should also decide what they may be pushed. An
   * `auto_verified` result is released; a `rejected` one with no human decision is not, and
   * pushing "your visit was rejected" for it would be exactly the accusation `outcome.ts`
   * refuses to make.
   */
  async announceOutcome(sessionId: string): Promise<void> {
    const s = await this.sessions.findById(sessionId).lean<SessionLean>();
    if (!s) return;
    const [decorated] = await this.decorate([s]);
    if (!decorated || !isReleased(decorated.outcome)) return;

    this.events.publish({
      participantId: s.participantId,
      kind: 'outcome',
      sessionId,
      title: decorated.taskTitle,
      venueName: decorated.venueName,
    });
  }

  /* ------------------------------------------------------------------ internals */

  /** Turn session documents into history rows. One query per collection, never per row. */
  private async decorate(rows: SessionLean[]): Promise<ParticipantVisitRow[]> {
    const sessionIds = rows.map((r) => String(r._id));
    const assignmentIds = rows.map((r) => r.assignmentId);
    const venueIds = rows.map((r) => r.venueId);

    const assignments = await this.assignments
      .find({ _id: { $in: assignmentIds } })
      .select({ taskId: 1, consentedAt: 1 })
      .lean<{ _id: unknown; taskId: string; consentedAt: Date | null }[]>();
    const byAssignment = new Map(assignments.map((a) => [String(a._id), a]));

    const [tasks, venues, reports, reviews] = await Promise.all([
      this.tasks
        .find({ _id: { $in: assignments.map((a) => a.taskId) } })
        .select({ title: 1, brief: 1 })
        .lean<{ _id: unknown; title: string; brief: string }[]>(),
      this.venues
        .find({ _id: { $in: venueIds } })
        .select({ name: 1, address: 1 })
        .lean<{ _id: unknown; name: string; address: string }[]>(),
      this.reports
        .find({ sessionId: { $in: sessionIds } })
        .select({ sessionId: 1, notes: 1, rating: 1, submittedAt: 1 })
        .lean<{ sessionId: string; notes: string; rating: number; submittedAt: Date }[]>(),
      /**
       * Newest human decision per session.
       *
       * Sorted ascending and reduced into a Map, so the LAST write for each session wins --
       * one pass, no per-session query, and it survives a visit being reviewed twice.
       */
      this.reviews
        .find({ sessionId: { $in: sessionIds } })
        .sort({ at: 1 })
        .select({ sessionId: 1, decision: 1, feedbackToParticipant: 1, at: 1 })
        .lean<
          {
            sessionId: string;
            decision: 'approve' | 'reject';
            feedbackToParticipant: string | null;
            at: Date;
          }[]
        >(),
    ]);

    const byTask = new Map(tasks.map((t) => [String(t._id), t]));
    const byVenue = new Map(venues.map((v) => [String(v._id), v]));
    const byReport = new Map(reports.map((r) => [r.sessionId, r]));
    const byReview = new Map(reviews.map((r) => [r.sessionId, r]));

    return rows.map((s): ParticipantVisitRow => {
      const id = String(s._id);
      const assignment = byAssignment.get(s.assignmentId);
      const task = assignment ? byTask.get(assignment.taskId) : undefined;
      const venue = byVenue.get(s.venueId);
      const report = byReport.get(id) ?? null;
      const released = releaseOutcome({
        state: s.state,
        latestVerdict: s.latestVerdict,
        latestResultAt: s.latestResultAt ?? null,
        review: byReview.get(id) ?? null,
      });

      return {
        sessionId: id,
        state: s.state,
        outcome: released.outcome,
        taskTitle: task?.title ?? 'Visit',
        taskBrief: task?.brief ?? '',
        venueName: venue?.name ?? 'Unknown venue',
        venueAddress: venue?.address ?? '',
        assignedAt: s.createdAtServer,
        consentedAt: assignment?.consentedAt ?? null,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        submittedAt: report?.submittedAt ?? null,
        feedback: released.feedback,
        decidedAt: released.decidedAt,
        decidedByHuman: released.decidedByHuman,
        report: report ? { notes: report.notes, rating: report.rating } : null,
        terminalReasonCode: terminalReasonCode(s.state, s.startedAt, s.endedAt),
        /**
         * `Boolean(...)`, not `!== null`.
         *
         * `default: null` is applied when a document is CREATED, and `.lean()` does no
         * hydration -- so on a session written before this branch the field is ABSENT and
         * `undefined !== null` is true. Every visit already in the deployed database would
         * have reported itself as already seen, and the notification list would have come
         * back empty for exactly the work that most needed announcing. A fresh volume hides
         * this completely, which is why it is written down here rather than trusted to a run
         * against freshly seeded data.
         *
         * The outcome half is a COMPARISON, not a flag: see `hasReadDecision`.
         */
        seen: {
          assignment: Boolean(s.assignmentSeenAt),
          outcome: hasReadDecision(s.outcomeSeenAt, released.decidedAt),
        },
      };
    });
  }

  private async taskForAssignment(assignmentId: string): Promise<{ title: string } | null> {
    const a = await this.assignments
      .findById(assignmentId)
      .select({ taskId: 1 })
      .lean<{ taskId: string }>();
    if (!a) return null;
    return this.tasks.findById(a.taskId).select({ title: 1 }).lean<{ title: string }>();
  }

  /** The configured timers, so the history screen can localise a terminal reason (D-022). */
  timeouts(): { abandonMinutes: number; hardCapHours: number } {
    return this.sessionsService.timeouts();
  }
}

interface SessionLean {
  _id: unknown;
  state: SessionState;
  participantId: string;
  assignmentId: string;
  venueId: string;
  createdAtServer: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  latestVerdict: Verdict | null;
  /**
   * Optional in the TYPE as well as nullable, and so are the two markers below, because
   * `.lean()` returns what is in the document and a session written before this branch has
   * none of them. Typing them as `Date | null` let `!== null` compile while being wrong at
   * runtime, which is precisely the bug the schema-reviewer pass caught.
   */
  latestResultAt?: Date | null;
  assignmentSeenAt?: Date | null;
  outcomeSeenAt?: Date | null;
}
