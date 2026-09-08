import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { ReaperService } from './reaper.service.js';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [DbModule],
  controllers: [SessionsController],
  providers: [SessionsService, ReaperService],
  exports: [SessionsService, ReaperService],
})
export class SessionsModule {}
