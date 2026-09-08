import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { AuthUser, Role } from '@msp/shared';

export const ROLES_KEY = 'msp:roles';

/** Restricts a route to the listed roles. Enforced by RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Marks a route as reachable without a token. Everything else requires one. */
export const PUBLIC_KEY = 'msp:public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * The authenticated user, as resolved by AuthGuard from the token.
 * Never populated from the request body -- CLAUDE.md rule 2, the client is untrusted.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
