import { Body, Controller, Param, Post } from '@nestjs/common';
import type { AuthUser } from '@msp/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { CreateReportDto } from './dto/create-report.dto.js';
import { ReportsService } from './reports.service.js';

@Controller('sessions/:sessionId/report')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /**
   * Submit the report and close the visit.
   *
   * 201, because this creates a report. The response says the visit is queued for
   * verification rather than pretending a verdict exists yet -- the evaluator runs after
   * this returns (rule 9).
   */
  @Roles('participant')
  @Post()
  submit(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateReportDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ sessionId: string; submittedAt: Date; queuedForVerification: true }> {
    return this.reports.submit(sessionId, dto, user);
  }
}
