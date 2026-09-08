import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [DbModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
