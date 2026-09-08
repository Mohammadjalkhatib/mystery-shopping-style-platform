import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { syncPingTtlIndex } from './indexes.js';
import { ClientOrg, ClientOrgSchema, Venue, VenueSchema } from './schemas/org-venue.schema.js';
import {
  Assignment,
  AssignmentSchema,
  Session,
  SessionEventDoc,
  SessionEventSchema,
  SessionSchema,
  Task,
  TaskSchema,
} from './schemas/task-session.schema.js';
import { Ping, PingSchema } from './schemas/ping.schema.js';
import {
  OutboxEntry,
  OutboxSchema,
  Report,
  ReportSchema,
  ReviewAction,
  ReviewActionSchema,
  VerificationResultDoc,
  VerificationResultSchema,
} from './schemas/report-verification.schema.js';

const MODELS = MongooseModule.forFeature([
  { name: ClientOrg.name, schema: ClientOrgSchema },
  { name: Venue.name, schema: VenueSchema },
  { name: Task.name, schema: TaskSchema },
  { name: Assignment.name, schema: AssignmentSchema },
  { name: Session.name, schema: SessionSchema },
  { name: SessionEventDoc.name, schema: SessionEventSchema },
  { name: Ping.name, schema: PingSchema },
  { name: Report.name, schema: ReportSchema },
  { name: OutboxEntry.name, schema: OutboxSchema },
  { name: VerificationResultDoc.name, schema: VerificationResultSchema },
  { name: ReviewAction.name, schema: ReviewActionSchema },
]);

@Module({ imports: [MODELS], exports: [MODELS] })
export class DbModule implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
  ) {}

  /**
   * Reconcile the ping TTL with PING_RETENTION_DAYS on every boot.
   * See indexes.ts for why re-declaring the index is not enough.
   */
  async onModuleInit(): Promise<void> {
    const days = Number(this.config.get<string>('PING_RETENTION_DAYS') ?? 30);
    await syncPingTtlIndex(this.connection, days);
  }
}
