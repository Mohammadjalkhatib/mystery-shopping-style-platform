import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '@msp/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { AccountsService, type OrgRow, type UserRow } from './accounts.service.js';
import { CreateOrgDto } from './dto/create-org.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { SetActiveDto } from './dto/set-active.dto.js';

/**
 * Organisations and accounts.
 *
 * No `/admin` prefix, for the reason AdminController gives: these are the resources
 * themselves, and the ROLE is what restricts them, not the URL. `POST /orgs` is admin-only
 * and `POST /users` admits a business too but narrows what it may create -- a distinction the
 * path could not express anyway.
 *
 * Every route carries @Roles. Without it a route is open to any authenticated user, including
 * a participant, since RolesGuard only restricts routes that ask to be restricted. There is
 * one test per boundary here for exactly that reason (CLAUDE.md section 5).
 */
@Controller()
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /* ------------------------------------------------------------------ orgs */

  /**
   * Create a business account: the organisation plus its first sign-in.
   *
   * Admin only, and not merely by convention -- a business user creating an organisation
   * would be creating a tenancy boundary it also sits outside of.
   */
  @Roles('admin')
  @Post('orgs')
  createOrg(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateOrgDto,
  ): Promise<{ org: OrgRow; businessUser: UserRow }> {
    return this.accounts.createOrg(user, dto);
  }

  @Roles('admin', 'business')
  @Get('orgs')
  listOrgs(@CurrentUser() user: AuthUser): Promise<OrgRow[]> {
    return this.accounts.listOrgs(user);
  }

  /* ----------------------------------------------------------------- users */

  /**
   * Create a user. An admin may create a business or a participant in any organisation; a
   * business may create participants, and only in its own.
   */
  @Roles('admin', 'business')
  @Post('users')
  createUser(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto): Promise<UserRow> {
    return this.accounts.createUser(user, dto);
  }

  @Roles('admin', 'business')
  @Get('users')
  listUsers(@CurrentUser() user: AuthUser): Promise<UserRow[]> {
    return this.accounts.listUsers(user);
  }

  /**
   * Deactivate or reactivate. PATCH rather than DELETE: the account is never removed, because
   * completed visits and append-only verification results reference it by id forever (rule 8).
   */
  @Roles('admin', 'business')
  @Patch('users/:userId')
  setActive(
    @Param('userId') userId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: SetActiveDto,
  ): Promise<UserRow> {
    return this.accounts.setActive(user, userId, dto.active);
  }
}
