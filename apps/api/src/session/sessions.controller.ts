import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { AuthUser } from '@msp/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { ConsentDto } from './dto/consent.dto.js';
import { ReaperService } from './reaper.service.js';
import { SessionsService, type SessionView } from './sessions.service.js';

/**
 * The participant's control of their own visit.
 *
 * There is no endpoint to set a state directly. A client expresses an intent -- start, end --
 * and the state machine decides what that means, which is what keeps rule 5 enforceable in
 * one place.
 */
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly reaper: ReaperService,
  ) {}

  /**
   * The signed-in participant's own visits. No id is taken from the caller.
   *
   * Reaps first (D-019). The sweep is awaited rather than fired and forgotten, because the
   * whole point is that this response reflects the reap -- a participant must not be shown an
   * `active` visit that the very same request has just abandoned. It cannot fail the read:
   * every error inside the reaper is swallowed there.
   */
  @Roles('participant')
  @Get('mine')
  async mine(@CurrentUser() user: AuthUser): Promise<SessionView[]> {
    await this.reaper.reapForParticipant(user.id);
    return this.sessions.mine(user);
  }

  /** Consent, recorded against the assignment with a server timestamp and a version. */
  @Roles('participant')
  @Post(':sessionId/consent')
  @HttpCode(200)
  consent(
    @Param('sessionId') sessionId: string,
    @Body() dto: ConsentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ consentedAt: Date; consentVersion: string }> {
    return this.sessions.consent(sessionId, user, dto.consentVersion);
  }

  /**
   * One of the caller's own visits.
   *
   * `viewOwned`, not `view`. This route took no `@CurrentUser()` at all and read whatever id
   * was in the path, so ANY participant token could read ANY session — its venue centre and
   * geofence, its timestamps, its ping count. Every other route on this controller asserts
   * ownership; this one was the exception, and the boundary test that would have caught it did
   * not exist because the check did not.
   *
   * Found by the `spoof-adversary` pass on the presence indicator, which went looking for how
   * an attacker learns the geofence and found a route that simply hands it over. D-036.
   */
  @Roles('participant')
  @Get(':sessionId')
  get(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<SessionView> {
    return this.sessions.viewOwned(sessionId, user);
  }

  @Roles('participant')
  @Post(':sessionId/start')
  @HttpCode(200)
  start(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<SessionView> {
    return this.sessions.start(sessionId, user);
  }

  @Roles('participant')
  @Post(':sessionId/end')
  @HttpCode(200)
  end(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthUser): Promise<SessionView> {
    return this.sessions.end(sessionId, user);
  }
}
