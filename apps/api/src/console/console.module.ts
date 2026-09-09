import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { ParticipantModule } from '../participant/participant.module.js';
import { SessionsModule } from '../session/sessions.module.js';
import { ConsoleController } from './console.controller.js';
import { ConsoleService } from './console.service.js';
import { VisitEventsService } from './visit-events.service.js';

@Module({
  imports: [DbModule, SessionsModule, ParticipantModule],
  controllers: [ConsoleController],
  providers: [ConsoleService, VisitEventsService],
  exports: [VisitEventsService],
})
export class ConsoleModule {}
