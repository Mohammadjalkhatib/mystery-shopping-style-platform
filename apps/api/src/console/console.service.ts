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

export interface VisitRow {
  sessionId: string;
  venueName: string;
  participantId: string;
  endedAt: Date | null;
  verdict: Verdict | null;
  score: number | null;
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
  report: { notes: string; rating: number; submittedAt: Date } | null;
  review: { decision: string; note: string; reviewerId: string; at: Date } | null;
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
      .lean<{ notes: string; rating: number; submittedAt: Date }>();

    const review = await this.reviews
      .findOne({ sessionId })
      .sort({ at: -1 })
      .lean<{ decision: string; note: string; reviewerId: string; at: Date }>();

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
      report: report ? { notes: report.notes, rating: report.rating, submittedAt: report.submittedAt } : null,
      review: review ?? null,
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
    body: { decision: 'approve' | 'reject'; note: string },
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
      at: new Date(),
    });

    return { ok: true };
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
