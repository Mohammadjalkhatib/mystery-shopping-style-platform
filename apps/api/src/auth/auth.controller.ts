import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { AuthUser } from '@msp/shared';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public, Roles } from './auth.decorators.js';
import { LoginDto } from './login.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<{ token: string; user: AuthUser }> {
    return this.auth.login(dto.username, dto.password);
  }

  /** Who am I, according to the token. Used by the web app to route by role on load. */
  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  /*
   * REMOVED: `GET /auth/demo-credentials`.
   *
   * It was @Public() and enumerated every account, which was harmless while the roster was a
   * fixed list published in the README. Since D-037 a business creates its own participants,
   * so the same endpoint would publish real usernames -- chosen by someone else, for people
   * who never agreed to be listed -- to anyone who asked, unauthenticated. An account
   * enumeration endpoint is a bad thing to leave switched on by habit.
   *
   * The login screen still shows the demo accounts; it just holds that list itself now
   * instead of asking the server who exists.
   */

  /** Exists only so the authorization boundary has something concrete to test against. */
  @Roles('admin')
  @Get('admin-only')
  adminOnly(): { ok: true } {
    return { ok: true };
  }
}
