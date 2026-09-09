import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import type { AuthUser } from '@msp/shared';
import { Observable, concat, from, interval, map, merge } from 'rxjs';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { ReaperService } from '../session/reaper.service.js';
import { MarkSeenDto } from './dto/mark-seen.dto.js';
import { ParticipantEventsService } from './participant-events.service.js';
import {
  ParticipantService,
  type ParticipantNotification,
  type ParticipantSummary,
  type ParticipantVisitRow,
} from './participant.service.js';

/** Structural, so this file does not pull in @types/express for one setHeader call. */
interface ResponseLike {
  setHeader(name: string, value: string): void;
}

const HEARTBEAT_MS = 20_000;

export interface ParticipantDashboard {
  summary: ParticipantSummary;
  visits: ParticipantVisitRow[];
  /** So a terminal reason can be said in the participant's own language (D-022). */
  timeouts: { abandonMinutes: number; hardCapHours: number };
}

/**
 * The participant's own record.
 *
 * `@Controller('me')` rather than `/participants/:id/...`: there is no id in any path here and
 * there must not be one. The subject is always the holder of the token, so the only way to read
 * another person's history is to hold their token -- rather than to guess an id and hope the
 * guard was remembered on that particular route.
 *
 * The visit RUNNER stays on `/sessions` where it was. This controller is read-and-acknowledge
 * only: it never moves a session's state, which remains the state machine's alone (rule 5).
 */
@Controller('me')
export class ParticipantController {
  constructor(
    private readonly participant: ParticipantService,
    private readonly events: ParticipantEventsService,
    private readonly reaper: ReaperService,
  ) {}

  /**
   * History and totals in one round trip.
   *
   * One call rather than three, because this screen is opened on a phone on a shop's wifi and
   * the summary is computed from the same rows the list renders anyway -- splitting it would
   * mean doing the work twice and paying two latencies for the privilege.
   *
   * Reaps first, and AWAITS it, for the same reason `/sessions/mine` does (D-019): a history
   * screen showing a visit as "in progress" that the very same request has just abandoned is
   * worse than a slightly slower one.
   */
  @Roles('participant')
  @Get('dashboard')
  async dashboard(
    @CurrentUser() user: AuthUser,
    @Query('limit') limit?: string,
  ): Promise<ParticipantDashboard> {
    await this.reaper.reapForParticipant(user.id);
    const visits = await this.participant.history(user, limit ? Number(limit) : undefined);
    // Rows fetched once and handed to the summary, so one dashboard load decorates one page
    // rather than two.
    const summary = await this.participant.summary(user, visits);
    return { summary, visits, timeouts: this.participant.timeouts() };
  }

  @Roles('participant')
  @Get('notifications')
  async notifications(@CurrentUser() user: AuthUser): Promise<ParticipantNotification[]> {
    await this.reaper.reapForParticipant(user.id);
    return this.participant.notifications(user);
  }

  /**
   * Acknowledge one notification.
   *
   * Idempotent and 200 rather than 201: nothing is created, a marker is moved, and a second
   * ack from a second tab is not an error worth surfacing to someone in a shop.
   */
  @Roles('participant')
  @Post('notifications/:sessionId/seen')
  @HttpCode(200)
  markSeen(
    @Param('sessionId') sessionId: string,
    @Body() dto: MarkSeenDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ ok: true }> {
    return this.participant.markSeen(sessionId, user, dto.kind);
  }

  /**
   * The participant's notification stream. Same three non-decorative details as the console
   * stream: `X-Accel-Buffering: no` to defeat a buffering proxy, a heartbeat so an idle
   * connection is not dropped, and `Last-Event-ID` replay so a reconnect does not silently
   * swallow the gap.
   *
   * Polling would have been simpler. CLAUDE.md section 4 says SSE and not polling, and the
   * reason applies here more than on the console: this stream is idle almost all of the time
   * -- a participant is assigned a task every few days, not every few seconds -- and a poll
   * frequent enough to feel like a notification would be a request every few seconds, all day,
   * on a phone, to be told nothing has changed.
   *
   * The subject comes from the verified token. There is no parameter for it (rule 2).
   */
  @Roles('participant')
  @Sse('notifications/stream')
  stream(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: ResponseLike,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache, no-transform');

    const since = Number(lastEventId);
    const missed =
      Number.isFinite(since) && since > 0 ? this.events.replay(user.id, since) : [];

    const backlog = from(missed).pipe(
      map((e): MessageEvent => ({ id: String(e.id), type: 'notification', data: e })),
    );
    const live = this.events.forParticipant(user.id).pipe(
      map((e): MessageEvent => ({ id: String(e.id), type: 'notification', data: e })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: { at: new Date().toISOString() } })),
    );

    return merge(concat(backlog, live), heartbeat);
  }
}
