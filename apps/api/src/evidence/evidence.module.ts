import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { EvidenceController } from './evidence.controller.js';
import { EvidenceService } from './evidence.service.js';

@Module({
  imports: [DbModule],
  controllers: [EvidenceController],
  providers: [EvidenceService],
  exports: [EvidenceService],
})
export class EvidenceModule {}
