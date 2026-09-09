import { Module } from '@nestjs/common';
import { ConsoleModule } from '../console/console.module.js';
import { DbModule } from '../db/db.module.js';
import { ParticipantModule } from '../participant/participant.module.js';
import { EvaluatorRunner } from './evaluator.runner.js';
import { EvaluatorService } from './evaluator.service.js';

@Module({
  imports: [DbModule, ConsoleModule, ParticipantModule],
  providers: [EvaluatorService, EvaluatorRunner],
  exports: [EvaluatorService, EvaluatorRunner],
})
export class VerificationModule {}
