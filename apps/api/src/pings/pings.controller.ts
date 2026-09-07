import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { AuthUser } from '@msp/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { CreatePingBatchDto } from './dto/create-ping.dto.js';
import { PingsService, type IngestResult } from './pings.service.js';

@Controller('sessions/:sessionId/pings')
export class PingsController {
  constructor(private readonly pings: PingsService) {}

  /**
   * Batch ping ingest.
   *
   * 200 rather than 201: a re-flush of an already-stored batch creates nothing, and the body
   * reports exactly what happened (accepted / duplicates / rejectedOutOfWindow) so an offline
   * client can reconcile its queue rather than guess.
   *
   * `@CurrentUser()` comes from the verified token. The participant identity is NEVER read
   * from the body or the path (rule 2).
   */
  @Roles('participant')
  @Post()
  @HttpCode(200)
  ingest(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreatePingBatchDto,
    @CurrentUser() user: AuthUser,
  ): Promise<IngestResult> {
    return this.pings.ingest(sessionId, dto, user);
  }
}
