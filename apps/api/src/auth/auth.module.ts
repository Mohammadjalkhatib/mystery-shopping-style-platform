import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../db/schemas/user.schema.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { RolesGuard } from './roles.guard.js';

/**
 * Guards are registered globally and in order: authenticate, then authorize.
 * Deny by default -- a route is protected unless it opts out with @Public().
 */
@Module({
  /**
   * `forFeature` for the one model this needs, rather than importing DbModule.
   *
   * DbModule carries an `onModuleInit` that reconciles the ping TTL index, and AuthModule is
   * imported directly by seven specs -- pulling the whole database module in behind the guard
   * would run that index reconciliation in every one of them. Registering the same model
   * twice is safe: MongooseModule reuses `connection.models[name]` when it already exists.
   */
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
