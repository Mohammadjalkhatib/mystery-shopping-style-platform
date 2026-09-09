import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { SessionsModule } from '../session/sessions.module.js';
import { ParticipantController } from './participant.controller.js';
import { ParticipantEventsService } from './participant-events.service.js';
import { ParticipantService } from './participant.service.js';

/**
 * Exports both the service and the event bus, because two other modules announce into this
 * one: `AdminModule` when an assignment is created, and `ConsoleModule` plus the evaluator
 * when a decision is released. The announcing side never publishes directly -- it calls
 * `ParticipantService`, which applies the release rule first (D-034).
 */
@Module({
  imports: [DbModule, SessionsModule],
  controllers: [ParticipantController],
  providers: [ParticipantService, ParticipantEventsService],
  exports: [ParticipantService, ParticipantEventsService],
})
export class ParticipantModule {}
