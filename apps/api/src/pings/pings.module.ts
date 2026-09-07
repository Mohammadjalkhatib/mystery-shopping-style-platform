import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { PingsController } from './pings.controller.js';
import { PingsService } from './pings.service.js';

@Module({
  imports: [DbModule],
  controllers: [PingsController],
  providers: [PingsService],
  exports: [PingsService],
})
export class PingsModule {}
