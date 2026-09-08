import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import type { AuthUser, Verdict } from '@msp/shared';
import { Observable, concat, from, interval, map, merge } from 'rxjs';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { ReaperService } from '../session/reaper.service.js';
import {
  ConsoleService,
  type ConsoleStats,
  type ParticipantStats,
  type VisitDetail,
  type VisitRow,
} from './console.service.js';
import { ReviewDto } from './dto/review.dto.js';
import { VisitEventsService } from './visit-events.service.js';

/**
 * The two response methods this controller needs.
 *
 * Structural, rather than importing Response from express: that would mean adding
 * @types/express as a dependency for one setHeader call, and CLAUDE.md section 6 says every
 * dependency needs a reason. This one does not have one.
 */
interface ResponseLike {
  setHeader(name: string, value: string): void;
}

/** Comment-only keep-alive. See the note on the stream below. */
const HEARTBEAT_MS = 20_000;

@Controller('console')
export class ConsoleController {
  constructor(
    private readonly console: ConsoleService,
    private readonly events: VisitEventsService,
    private readonly reaper: ReaperService,
  ) {}

  /**
   * The visit feed.
   *
   * Reaps the org's overdue sessions first (D-019). This is the trigger that carries the
   * feature: abandonment IS the participant not coming back, so a participant-only sweep
   * never fires for the sessions that most need it, and the console would show an `active`
   * visit that has been dead for hours.
   *
   * Note this does not violate rule 6. The reaper writes to `sessions`, which the console
   * already reads; it never touches the ping collection.
   */
  @Roles('business', 'admin')
  @Get('visits')
  async list(
    @CurrentUser() user: AuthUser,
    @Query('verdict') verdict?: Verdict,
    @Query('limit') limit?: string,
  ): Promise<VisitRow[]> {
    await this.reaper.reapForOrg(user.clientOrgId);
    return this.console.listVisits(user, {
      verdict,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Roles('business', 'admin')
  @Get('visits/counts')
  async counts(@CurrentUser() user: AuthUser): Promise<Record<string, number>> {
    await this.reaper.reapForOrg(user.clientOrgId);
    return this.console.counts(user);
  }

  /**
   * Dashboard aggregates. Same tenancy rule as every other console read: the org comes from
   * the verified token, never from a query parameter.
   *
   * Declared BEFORE `visits/:sessionId` would be reached, but on its own path, so there is no
   * chance of `stats` being captured as a session id.
   */
  @Roles('business', 'admin')
  @Get('stats')
  stats(@CurrentUser() user: AuthUser, @Query('days') days?: string): Promise<ConsoleStats> {
    return this.console.stats(user, days ? Number(days) : undefined);
  }

  /**
   * Per-participant results. Same tenancy rule as every other console read.
   *
   * A separate path from `visits/:sessionId`, so there is no chance of `participants` being
   * captured as a session id.
   */
  @Roles('business', 'admin')
  @Get('participants')
  participants(
    @CurrentUser() user: AuthUser,
    @Query('days') days?: string,
  ): Promise<ParticipantStats[]> {
    return this.console.participantStats(user, days ? Number(days) : undefined);
  }

  @Roles('business', 'admin')
  @Get('visits/:sessionId')
  detail(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<VisitDetail> {
    return this.console.visitDetail(sessionId, user);
  }

  @Roles('business', 'admin')
  @Post('visits/:sessionId/review')
  review(
    @Param('sessionId') sessionId: string,
    @Body() dto: ReviewDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ ok: true }> {
    return this.console.review(sessionId, user, dto);
  }

  /**
   * The live visit feed. D-004.
   *
   * Three things here are not decoration:
   *
   * 1. **`X-Accel-Buffering: no`.** Free-tier platforms commonly sit behind a buffering proxy,
   *    which holds the response until its buffer fills. SSE through one delivers nothing for
   *    a long time and then everything at once, which presents to a reviewer as "the console
   *    is broken". This header is the standard opt-out.
   *
   * 2. **A heartbeat.** Those same proxies drop idle connections at around 30-60 s. A visit
   *    feed is idle most of the time by nature, so without a periodic keep-alive the stream
   *    is killed exactly when nothing is happening and silently reconnects in a loop.
   *
   * 3. **`Last-Event-ID` replay.** D-004 claimed "browsers reconnect SSE natively, so there is
   *    no reconnection code to write". True of the transport, false of the requirement: on
   *    reconnect the browser sends this header, and a server that ignores it drops every event
   *    from the gap. "The visit appears with no refresh" is the one thing the brief actually
   *    asks for, so the gap is replayed from the in-process buffer before live events resume.
   *
   * The org comes from the verified token. There is no query parameter for it -- otherwise the
   * tenancy boundary would be a suggestion (rule 2).
   */
  @Roles('business', 'admin')
  @Sse('stream')
  stream(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: ResponseLike,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache, no-transform');

    // Admins have no single org; they watch the org they are scoped to, or nothing.
    const orgId = user.clientOrgId ?? '*';

    const since = Number(lastEventId);
    const missed = Number.isFinite(since) && since > 0 ? this.events.replay(orgId, since) : [];

    const backlog = from(missed).pipe(
      map((e): MessageEvent => ({ id: String(e.id), type: 'visit', data: e })),
    );

    const live = this.events.forOrg(orgId).pipe(
      map((e): MessageEvent => ({ id: String(e.id), type: 'visit', data: e })),
    );

    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: { at: new Date().toISOString() } })),
    );

    // Backlog strictly before live, so the client never sees a newer event before an older one.
    return merge(concat(backlog, live), heartbeat);
  }
}
