import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type { AuthUser } from '@msp/shared';
import type { Connection, Model } from 'mongoose';
import { OutboxEntry, Report } from '../db/schemas/report-verification.schema.js';
import { Session } from '../db/schemas/task-session.schema.js';
import { SessionsService } from '../session/sessions.service.js';
import { EvaluatorRunner } from '../verification/evaluator.runner.js';
import type { CreateReportDto } from './dto/create-report.dto.js';

@Injectable()
export class ReportsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Report.name) private readonly reports: Model<Report>,
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    @InjectModel(OutboxEntry.name) private readonly outbox: Model<OutboxEntry>,
    private readonly sessionsService: SessionsService,
    private readonly runner: EvaluatorRunner,
  ) {}

  /**
   * Submit a report. CLAUDE.md rule 9.
   *
   * ONE transaction writes three things: the report, the session state change (with its
   * append-only event), and an outbox row. Either the visit is fully submitted or it is not
   * submitted at all -- there is no state in which a report exists but nothing will ever
   * verify it, and none in which the session says `submitted` with no report behind it.
   *
   * Verification is deliberately NOT done here. It runs off the outbox afterwards, so submit
   * stays a fast write that cannot fail because the evaluator is slow, and so a verdict can
   * be re-run later under a newer engineVersion without touching this path.
   *
   * Requires a replica set. Atlas M0 is one; the `mongo` container in docker-compose is not
   * yet, which is the open item recorded against `chore/dockerize`.
   */
  async submit(
    sessionId: string,
    dto: CreateReportDto,
    user: AuthUser,
  ): Promise<{ sessionId: string; submittedAt: Date; queuedForVerification: true }> {
    const session = await this.sessions.findById(sessionId).lean<{
      participantId: string;
      clientOrgId: string;
    }>();
    if (!session) throw new NotFoundException('Session not found');
    if (session.participantId !== user.id) {
      throw new ForbiddenException('This session belongs to another participant');
    }

    const now = new Date();
    const dbSession = await this.connection.startSession();

    try {
      await dbSession.withTransaction(async () => {
        /**
         * The state transition goes FIRST, deliberately.
         *
         * With the report written first, a second submit hit the unique index on
         * `reports.sessionId` and surfaced as a 500 duplicate-key error before the state
         * machine was ever consulted. Rule 5 says an illegal transition returns 409 with the
         * current state -- a 500 tells the client nothing and looks like a server fault.
         *
         * Ordering it first means the state machine is the thing that rejects a repeat
         * submission, and it rejects it with the state and the legal events attached. The
         * unique index stays as the last line of defence rather than the first.
         */
        await this.sessionsService.apply(sessionId, 'submit', user.id, {
          dbSession,
          now,
        });

        await this.reports.create(
          [
            {
              sessionId,
              clientOrgId: session.clientOrgId,
              participantId: user.id,
              notes: dto.notes,
              rating: dto.rating,
              evidenceKey: null,
              // Server clock. A client-supplied submittedAt is not in the DTO at all.
              submittedAt: now,
            },
          ],
          { session: dbSession },
        );

        await this.outbox.create(
          [{ sessionId, kind: 'verify_visit', status: 'pending', runAfter: now }],
          { session: dbSession },
        );
      });
    } finally {
      await dbSession.endSession();
    }

    /**
     * Nudge the evaluator, AFTER the transaction has committed and without awaiting it.
     *
     * Ordering matters: kicking inside the transaction would let the evaluator read a session
     * the transaction had not committed yet. Not awaiting matters too -- rule 9 makes submit a
     * fast write that must not fail because verification is slow. If this kick is lost, the
     * periodic sweep picks the outbox row up, which is the whole point of having an outbox.
     */
    this.runner.kick();

    return { sessionId, submittedAt: now, queuedForVerification: true };
  }
}
