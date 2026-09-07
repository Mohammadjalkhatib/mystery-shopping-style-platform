import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { AuthUser } from '@msp/shared';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public, Roles } from './auth.decorators.js';
import { LoginDto } from './login.dto.js';
import { DEMO_PASSWORD, DEMO_USERS } from './demo-users.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): { token: string; user: AuthUser } {
    return this.auth.login(dto.username, dto.password);
  }

  /** Who am I, according to the token. Used by the web app to route by role on load. */
  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  /**
   * Lists the demo logins so a reviewer does not have to read the source to find them.
   * Public purely because this is a demo build; it would obviously not exist otherwise.
   */
  @Public()
  @Get('demo-credentials')
  demoCredentials(): { password: string; accounts: { username: string; role: string }[] } {
    return {
      password: DEMO_PASSWORD,
      accounts: DEMO_USERS.map((u) => ({ username: u.username, role: u.role })),
    };
  }

  /** Exists only so the authorization boundary has something concrete to test against. */
  @Roles('admin')
  @Get('admin-only')
  adminOnly(): { ok: true } {
    return { ok: true };
  }
}
