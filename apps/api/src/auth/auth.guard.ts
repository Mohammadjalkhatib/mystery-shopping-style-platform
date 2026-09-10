import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '@msp/shared';
import { AuthService } from './auth.service.js';
import { PUBLIC_KEY } from './auth.decorators.js';

/**
 * Global guard: every route requires a valid token unless explicitly marked @Public().
 * Deny by default, so a new controller cannot be left unprotected by omission.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  /**
   * Async since D-037, because the user is now re-read from the database rather than found in
   * an array. Nest has always accepted a Promise here; what changes is that every
   * authenticated request costs one indexed lookup by `_id`, which is what makes deactivating
   * an account take effect immediately instead of at token expiry.
   */
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthUser;
    }>();

    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    req.user = await this.auth.verify(header.slice('Bearer '.length).trim());
    return true;
  }
}
