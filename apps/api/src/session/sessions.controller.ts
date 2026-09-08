import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { AuthUser } from '@msp/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { ConsentDto } from './dto/consent.dto.js';
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
  constructor(private readonly sessions: SessionsService) {}

  /** The signed-in participant's own visits. No id is taken from the caller. */
  @Roles('participant')
  @Get('mine')
  mine(@CurrentUser() user: AuthUser): Promise<SessionView[]> {
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

  @Roles('participant')
  @Get(':sessionId')
  get(@Param('sessionId') sessionId: string): Promise<SessionView> {
    return this.sessions.view(sessionId);
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
