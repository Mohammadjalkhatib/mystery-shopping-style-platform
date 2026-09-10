import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AuthUser, Signal, Verdict } from '@msp/shared';
import type { Model } from 'mongoose';
import { Venue } from '../db/schemas/org-venue.schema.js';
import {
  Report,
  ReviewAction,
  VerificationResultDoc,
} from '../db/schemas/report-verification.schema.js';
import { Session } from '../db/schemas/task-session.schema.js';
import { User } from '../db/schemas/user.schema.js';
import { ParticipantService } from '../participant/participant.service.js';

export interface VisitRow {
  sessionId: string;
  venueName: string;
  participantId: string;
  endedAt: Date | null;
  verdict: Verdict | null;
  score: number | null;
}

export interface ConsoleStats {
  /** The window these numbers describe, so a tile can say what it is counting. */
  days: number;
  totals: { visits: number; auto_verified: number; needs_review: number; rejected: number };
  /** Median rather than mean: one 4,789 m outlier should not move the headline. */
  medianCoverageRatio: number | null;
  medianScore: number | null;
  /** Newest last, one entry per day, zero-filled so the axis has no holes. */
  byDay: { date: string; auto_verified: number; needs_review: number; rejected: number }[];
  /** Which signals actually cost visits their score, worst first. */
  topFailingSignals: { code: string; visits: number; totalPenalty: number; reason: string }[];
}

export interface ParticipantStats {
  participantId: string;
  displayName: string;
  visits: number;
  auto_verified: number;
  needs_review: number;
  rejected: number;
  /** Share of their visits that cleared the auto threshold, 0..1. */
  passRate: number;
  medianScore: number | null;
  /** Their most frequent penalty, which is what distinguishes the causes. */
  topSignal: { code: string; visits: number } | null;
  lastVisitAt: Date | null;
}

export interface VisitDetail extends VisitRow {
  startedAt: Date | null;
  signals: Signal[];
  engineVersion: string | null;
  rollups: {
    fixCount: number;
    dwellSeconds: number;
    coverageRatio: number;
    minDistanceM: number | null;
    medianAccuracyM: number | null;
    unusableFixCount: number;
  } | null;
  report: {
    notes: string;
    rating: number;
    submittedAt: Date;
    /** The key only. The image itself is served by a separate, separately-authorized route. */
    evidenceKey: string | null;
  } | null;
  review: {
    decision: string;
    note: string;
    reviewerId: string;
    at: Date;
    /** What the participant was told, or null. Shown back so a reviewer can see it. */
    feedbackToParticipant: string | null;
  } | null;
  venue: { name: string; radiusM: number; indoor: boolean } | null;
}

/**
 * Everything the business console reads.
 *
 * CLAUDE.md rule 6: **this file must never query the ping collection.** It reads sessions and
 * verification results, which carry the rollups the evaluator wrote. If a query here ever
 * needs a ping, that is a design failure, not a missing index -- the raw trace is the most
 * sensitive data in the system and it also does not scale to read per dashboard row.
 *
 * Every method takes the org from the verified token. There is no code path that lets a
 * caller name the organisation they want to see.
 */
@Injectable()
export class ConsoleService {
  constructor(
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    @InjectModel(VerificationResultDoc.name)
    private readonly results: Model<VerificationResultDoc>,
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    @InjectModel(ReviewAction.name) private readonly reviews: Model<ReviewAction>,
    @InjectModel(Venue.name) private readonly venues: Model<Venue>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly participants: ParticipantService,
  ) {}

  /**
   * The visit feed.
   *
   * One indexed query. The verdict comes from the denormalised pointer on the session, not
   * from a per-row join into verificationResults -- that is what `latestVerdict` is for.
   */
  async listVisits(
    user: AuthUser,
    opts: { verdict?: Verdict; limit?: number } = {},
  ): Promise<VisitRow[]> {
    const orgId = this.orgFor(user);
    const query: Record<string, unknown> = { state: 'submitted' };
    if (orgId) query.clientOrgId = orgId;
    if (opts.verdict) query.latestVerdict = opts.verdict;

    const rows = await this.sessions
      .find(query)
      .sort({ endedAt: -1 })
      .limit(Math.min(opts.limit ?? 50, 200))
      .lean<
        {
          _id: unknown;
          venueId: string;
          participantId: string;
          endedAt: Date | null;
          latestVerdict: Verdict | null;
          latestScore: number | null;
        }[]
      >();

    const venueNames = await this.venueNames(rows.map((r) => r.venueId));

    return rows.map((r) => ({
      sessionId: String(r._id),
      venueName: venueNames.get(r.venueId) ?? 'Unknown venue',
      participantId: r.participantId,
      endedAt: r.endedAt,
      verdict: r.latestVerdict,
      score: r.latestScore,
    }));
  }

  /** One visit, with the evidence trail a reviewer needs to make a decision. */
  async visitDetail(sessionId: string, user: AuthUser): Promise<VisitDetail> {
    const session = await this.sessions.findById(sessionId).lean<{
      _id: unknown;
      clientOrgId: string;
      venueId: string;
      participantId: string;
      startedAt: Date | null;
      endedAt: Date | null;
      latestVerdict: Verdict | null;
      latestScore: number | null;
    }>();
    if (!session) throw new NotFoundException('Visit not found');
    this.assertVisible(session.clientOrgId, user);

    // Newest result. Older ones are kept (rule 8) but the console shows the current verdict.
    const result = await this.results
      .findOne({ sessionId })
      .sort({ createdAt: -1 })
      .lean<{
        signals: Signal[];
        engineVersion: string;
        rollups: VisitDetail['rollups'];
      }>();

    const report = await this.reports
      .findOne({ sessionId })
      .lean<{ notes: string; rating: number; submittedAt: Date; evidenceKey: string | null }>();

    const review = await this.reviews
      .findOne({ sessionId })
      .sort({ at: -1 })
      // Projected explicitly rather than passed through whole. The lean document also carries
      // `_id`, `clientOrgId` and `verificationResultId`, none of which this view uses, and a
      // spread of an unprojected document is how a field added later reaches a screen nobody
      // decided to put it on.
      .select({ decision: 1, note: 1, reviewerId: 1, at: 1, feedbackToParticipant: 1 })
      .lean<{
        decision: string;
        note: string;
        reviewerId: string;
        at: Date;
        feedbackToParticipant: string | null;
      }>();

    const venue = await this.venues
      .findById(session.venueId)
      .lean<{ name: string; radiusM: number; indoor: boolean }>();

    return {
      sessionId: String(session._id),
      venueName: venue?.name ?? 'Unknown venue',
      participantId: session.participantId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      verdict: session.latestVerdict,
      score: session.latestScore,
      signals: result?.signals ?? [],
      engineVersion: result?.engineVersion ?? null,
      rollups: result?.rollups ?? null,
      report: report
        ? {
            notes: report.notes,
            rating: report.rating,
            submittedAt: report.submittedAt,
            evidenceKey: report.evidenceKey ?? null,
          }
        : null,
      review: review
        ? {
            decision: review.decision,
            note: review.note,
            reviewerId: review.reviewerId,
            at: review.at,
            feedbackToParticipant: review.feedbackToParticipant ?? null,
          }
        : null,
      venue: venue ? { name: venue.name, radiusM: venue.radiusM, indoor: venue.indoor } : null,
    };
  }

  /**
   * A human overriding the engine.
   *
   * Written to `reviewActions`, NEVER by mutating the verification result (rule 8). The
   * engine's verdict and a reviewer's decision are different claims by different authors, and
   * keeping them apart is what preserves the "how often do reviewers disagree with the engine"
   * question -- which is the labelled data D-009 needs to make the weights principled.
   */
  async review(
    sessionId: string,
    user: AuthUser,
    body: { decision: 'approve' | 'reject'; note: string; feedbackToParticipant?: string },
  ): Promise<{ ok: true }> {
    const session = await this.sessions
      .findById(sessionId)
      .lean<{ clientOrgId: string }>();
    if (!session) throw new NotFoundException('Visit not found');
    this.assertVisible(session.clientOrgId, user);

    const result = await this.results
      .findOne({ sessionId })
      .sort({ createdAt: -1 })
      .lean<{ _id: unknown }>();
    if (!result) throw new NotFoundException('This visit has not been verified yet');

    await this.reviews.create({
      sessionId,
      // Pinned to the specific result, so the override is tied to an engine version.
      verificationResultId: String(result._id),
      clientOrgId: session.clientOrgId,
      reviewerId: user.id,
      decision: body.decision,
      note: body.note,
      /**
       * The participant-facing half, and the ONLY part of this document they will ever read.
       * Empty is stored as null rather than '' so "wrote nothing" and "wrote whitespace" are
       * the same fact (D-034).
       */
      feedbackToParticipant: body.feedbackToParticipant?.trim() || null,
      at: new Date(),
    });

    /**
     * Tell the participant a decision has been released. Fire-and-forget and outside the write
     * for the same reason the assignment announcement is: a push that fails must not fail the
     * review. `announceOutcome` re-derives the release rule itself rather than trusting this
     * call site, so it is not possible to push something `outcome.ts` would have withheld.
     */
    void this.participants.announceOutcome(sessionId).catch(() => undefined);

    return { ok: true };
  }

  /**
   * The dashboard numbers.
   *
   * Aggregated in Mongo rather than pulled into Node: this is the one console read whose cost
   * grows with history rather than with page size, and `{ clientOrgId, state, endedAt }` already
   * exists as an index for exactly this shape of query.
   *
   * Rule 6 still holds -- sessions and verificationResults only. `topFailingSignals` reads the
   * signals the evaluator already wrote; it never touches a ping.
   */
  async stats(user: AuthUser, days = 30): Promise<ConsoleStats> {
    const orgId = this.orgFor(user);
    const window = Math.min(Math.max(Math.trunc(days), 1), 365);
    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);

    const sessionMatch: Record<string, unknown> = { state: 'submitted', endedAt: { $gte: since } };
    if (orgId) sessionMatch.clientOrgId = orgId;

    const sessions = await this.sessions
      .find(sessionMatch)
      .select({ _id: 1, endedAt: 1, latestVerdict: 1, latestScore: 1 })
      .lean<
        {
          _id: unknown;
          endedAt: Date | null;
          latestVerdict: Verdict | null;
          latestScore: number | null;
        }[]
      >();

    const totals = { visits: sessions.length, auto_verified: 0, needs_review: 0, rejected: 0 };
    const perDay = new Map<string, { auto_verified: number; needs_review: number; rejected: number }>();
    const scores: number[] = [];

    for (const s of sessions) {
      if (s.latestVerdict) totals[s.latestVerdict] += 1;
      if (typeof s.latestScore === 'number') scores.push(s.latestScore);
      if (!s.endedAt || !s.latestVerdict) continue;
      const key = s.endedAt.toISOString().slice(0, 10);
      const row = perDay.get(key) ?? { auto_verified: 0, needs_review: 0, rejected: 0 };
      row[s.latestVerdict] += 1;
      perDay.set(key, row);
    }

    /**
     * Zero-filled, every day in the window.
     *
     * A bar chart built only from days that HAVE visits silently compresses quiet periods and
     * makes a gap look like continuous activity -- the axis would lie about the shape of the
     * data, which is the whole thing a time series is for.
     */
    const byDay: ConsoleStats['byDay'] = [];
    for (let i = window - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      byDay.push({ date: d, ...(perDay.get(d) ?? { auto_verified: 0, needs_review: 0, rejected: 0 }) });
    }

    const ids = sessions.map((s) => String(s._id));
    const [signalRows, coverageRows] = await Promise.all([
      /**
       * Only NEGATIVE contributions, grouped by code.
       *
       * "Recurring failures" is the question a business user actually has, and a signal that
       * awards +2 for honest GPS is not a failure. Mixing the two would net them out and show
       * nothing.
       */
      this.results.aggregate<{ _id: string; visits: number; totalPenalty: number; reason: string }>([
        { $match: { sessionId: { $in: ids } } },
        { $unwind: '$signals' },
        { $match: { 'signals.contribution': { $lt: 0 } } },
        {
          $group: {
            _id: '$signals.code',
            visits: { $sum: 1 },
            totalPenalty: { $sum: '$signals.contribution' },
            reason: { $first: '$signals.reason' },
          },
        },
        { $sort: { visits: -1 } },
        { $limit: 6 },
      ]),
      this.results.aggregate<{ _id: null; coverage: number[] }>([
        { $match: { sessionId: { $in: ids } } },
        { $group: { _id: null, coverage: { $push: '$rollups.coverageRatio' } } },
      ]),
    ]);

    const median = (xs: number[]): number | null => {
      const clean = xs.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
      if (clean.length === 0) return null;
      const mid = Math.floor(clean.length / 2);
      return clean.length % 2 ? clean[mid]! : (clean[mid - 1]! + clean[mid]!) / 2;
    };

    return {
      days: window,
      totals,
      medianCoverageRatio: median(coverageRows[0]?.coverage ?? []),
      medianScore: median(scores),
      byDay,
      topFailingSignals: signalRows.map((r) => ({
        code: r._id,
        visits: r.visits,
        totalPenalty: r.totalPenalty,
        reason: r.reason,
      })),
    };
  }

  /**
   * Per-participant results.
   *
   * The question behind this is "who is working and who is not", and the honest answer is that
   * THIS CANNOT IDENTIFY CHEATING and must not be presented as though it does (D-001). A
   * participant whose visits keep being rejected may be inventing them; they may equally have
   * been sent to a venue whose coordinate is wrong — which has happened in this very database
   * (D-020) — or be using a phone whose GPS is poor indoors.
   *
   * What it can do is rank who needs looking at, and say WHY by naming each person's most
   * frequent penalty. `proximity` failing every time means a different investigation from
   * `coverage` failing every time: the first is about where they were, the second about
   * whether the app was ever on screen.
   */
  async participantStats(user: AuthUser, days = 30): Promise<ParticipantStats[]> {
    const orgId = this.orgFor(user);
    const window = Math.min(Math.max(Math.trunc(days), 1), 365);
    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);

    const match: Record<string, unknown> = { state: 'submitted', endedAt: { $gte: since } };
    if (orgId) match.clientOrgId = orgId;

    const sessions = await this.sessions
      .find(match)
      .select({ _id: 1, participantId: 1, endedAt: 1, latestVerdict: 1, latestScore: 1 })
      .lean<
        {
          _id: unknown;
          participantId: string;
          endedAt: Date | null;
          latestVerdict: Verdict | null;
          latestScore: number | null;
        }[]
      >();
    if (sessions.length === 0) return [];

    /**
     * Their most frequent NEGATIVE signal. A signal that awards points is not a problem.
     *
     * Grouped by SESSION and folded into participants here, because `verificationResults` has
     * no `participantId` -- it carries `sessionId` and `clientOrgId` only. Grouping on a field
     * that does not exist would not error; every row would collapse under `null` and the whole
     * column would be one meaningless bucket.
     */
    const ownerOf = new Map(sessions.map((x) => [String(x._id), x.participantId]));
    const penalties = await this.results.aggregate<{
      _id: { session: string; code: string };
      n: number;
    }>([
      { $match: { sessionId: { $in: [...ownerOf.keys()] } } },
      { $unwind: '$signals' },
      { $match: { 'signals.contribution': { $lt: 0 } } },
      { $group: { _id: { session: '$sessionId', code: '$signals.code' }, n: { $sum: 1 } } },
    ]);

    const perPerson = new Map<string, Map<string, number>>();
    for (const row of penalties) {
      const owner = ownerOf.get(row._id.session);
      if (!owner) continue;
      const counts = perPerson.get(owner) ?? new Map<string, number>();
      counts.set(row._id.code, (counts.get(row._id.code) ?? 0) + row.n);
      perPerson.set(owner, counts);
    }

    const topByParticipant = new Map<string, { code: string; visits: number }>();
    for (const [participant, counts] of perPerson) {
      let best: { code: string; visits: number } | null = null;
      for (const [code, n] of counts) {
        if (!best || n > best.visits) best = { code, visits: n };
      }
      if (best) topByParticipant.set(participant, best);
    }

    const byParticipant = new Map<
      string,
      { scores: number[]; counts: Record<Verdict, number>; last: Date | null }
    >();
    for (const x of sessions) {
      const row =
        byParticipant.get(x.participantId) ??
        {
          scores: [],
          counts: { auto_verified: 0, needs_review: 0, rejected: 0 },
          last: null,
        };
      if (x.latestVerdict) row.counts[x.latestVerdict] += 1;
      if (typeof x.latestScore === 'number') row.scores.push(x.latestScore);
      if (x.endedAt && (!row.last || x.endedAt > row.last)) row.last = x.endedAt;
      byParticipant.set(x.participantId, row);
    }

    const median = (xs: number[]): number | null => {
      if (xs.length === 0) return null;
      const s2 = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(s2.length / 2);
      return s2.length % 2 ? s2[mid]! : (s2[mid - 1]! + s2[mid]!) / 2;
    };

    /**
      * Display names in ONE query, not one per row.
      *
      * This used to be an in-process lookup against the demo array, which was free. Since
      * D-037 it is a collection, and the shape it must not become is a lookup inside the loop
      * below -- that reads perfectly naturally and is N round trips against the database for
      * a screen whose whole job is to list everyone.
      *
      * A plain `find`, deliberately not an `$lookup` into the session pipeline: `passwordHash`
      * is `select: false`, and projections do not apply to aggregation stages.
      */
     const names = new Map<string, string>();
     if (byParticipant.size > 0) {
       const users = await this.users
         .find({ _id: { $in: [...byParticipant.keys()] } })
         .select({ displayName: 1 })
         .lean<{ _id: string; displayName: string }[]>();
       for (const u of users) names.set(u._id, u.displayName);
     }

    const out: ParticipantStats[] = [];
    for (const [participantId, row] of byParticipant) {
      const visits = row.counts.auto_verified + row.counts.needs_review + row.counts.rejected;
      out.push({
        participantId,
        // Falls back to the id: a participant whose account was removed by hand still has
        // visits, and a blank name column would read as a bug in the stats rather than as a
        // missing account.
        displayName: names.get(participantId) ?? participantId,
        visits,
        ...row.counts,
        passRate: visits === 0 ? 0 : row.counts.auto_verified / visits,
        medianScore: median(row.scores),
        topSignal: topByParticipant.get(participantId) ?? null,
        lastVisitAt: row.last,
      });
    }

    // Worst pass rate first: this list exists to be read from the top.
    out.sort((a, b) => a.passRate - b.passRate || b.visits - a.visits);
    return out;
  }

  /** Counts for the filter chips. */
  async counts(user: AuthUser): Promise<Record<string, number>> {
    const orgId = this.orgFor(user);
    const base: Record<string, unknown> = { state: 'submitted' };
    if (orgId) base.clientOrgId = orgId;

    const [all, auto, review, rejected] = await Promise.all([
      this.sessions.countDocuments(base),
      this.sessions.countDocuments({ ...base, latestVerdict: 'auto_verified' }),
      this.sessions.countDocuments({ ...base, latestVerdict: 'needs_review' }),
      this.sessions.countDocuments({ ...base, latestVerdict: 'rejected' }),
    ]);
    return { all, auto_verified: auto, needs_review: review, rejected };
  }

  /** Admin sees every org; a business user sees exactly one. */
  private orgFor(user: AuthUser): string | null {
    return user.role === 'admin' ? null : user.clientOrgId;
  }

  private assertVisible(clientOrgId: string, user: AuthUser): void {
    if (user.role === 'admin') return;
    if (user.clientOrgId !== clientOrgId) {
      // 403 rather than 404: the caller is authenticated and the resource exists, they simply
      // may not see it. Leaking existence across a tenancy boundary is a smaller problem than
      // a confusing 404 for a legitimately-shared session id.
      throw new ForbiddenException('This visit belongs to another organisation');
    }
  }

  private async venueNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    const venues = await this.venues
      .find({ _id: { $in: unique } })
      .select({ name: 1 })
      .lean<{ _id: unknown; name: string }[]>();
    return new Map(venues.map((v) => [String(v._id), v.name]));
  }
}
