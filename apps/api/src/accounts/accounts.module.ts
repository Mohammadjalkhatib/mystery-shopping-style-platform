import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';

@Module({
  imports: [DbModule],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
