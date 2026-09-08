import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { SessionsModule } from '../session/sessions.module.js';
import { VerificationModule } from '../verification/verification.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [DbModule, SessionsModule, VerificationModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
