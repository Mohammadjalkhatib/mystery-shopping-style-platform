import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { HealthController } from './health/health.controller.js';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConsoleModule } from './console/console.module.js';
import { DbModule } from './db/db.module.js';
import { EvidenceModule } from './evidence/evidence.module.js';
import { GeocodeModule } from './geocode/geocode.module.js';
import { ParticipantModule } from './participant/participant.module.js';
import { PingsModule } from './pings/pings.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SessionsModule } from './session/sessions.module.js';
import { VerificationModule } from './verification/verification.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri:
          config.get<string>('MONGO_URI') ??
          'mongodb://127.0.0.1:27017/mystery-shopping',
        // Fail fast locally rather than hanging for 30s when mongo is not up yet.
        serverSelectionTimeoutMS: 5000,
      }),
    }),
    AuthModule,
    DbModule,
    PingsModule,
    SessionsModule,
    ReportsModule,
    VerificationModule,
    ConsoleModule,
    AdminModule,
    ParticipantModule,
    EvidenceModule,
    GeocodeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
