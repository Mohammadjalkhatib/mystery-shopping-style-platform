import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { EvaluatorService } from './evaluator.service.js';

@Module({
  imports: [DbModule],
  providers: [EvaluatorService],
  exports: [EvaluatorService],
})
export class VerificationModule {}
