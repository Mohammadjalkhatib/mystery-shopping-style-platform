import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// node: prefix so the builtin is unambiguous under ESM resolution.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthUser } from '@msp/shared';
import { findDemoUser, findDemoUserById, type DemoUser } from './demo-users.js';

/**
 * Demo token issuer. Deliberately NOT JWT and deliberately not a dependency.
 *
 * Format: `<base64url(payload)>.<base64url(hmac-sha256)>`. That is enough to make the token
 * unforgeable without JWT_SECRET, which is all the guards need. It has no algorithm
 * negotiation, so it also has none of the `alg: none` class of JWT footguns.
 *
 * Not production auth: no rotation, no revocation, no refresh. See D-008.
 */
@Injectable()
export class AuthService {
  private readonly secret: string;
  private readonly ttlMs: number;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('JWT_SECRET') ?? 'change-me-locally';
    // Long-lived on purpose: a reviewer should not get logged out mid-demo.
    this.ttlMs = 7 * 24 * 60 * 60 * 1000;
  }

  login(username: string, password: string): { token: string; user: AuthUser } {
    const found = findDemoUser(username, password);
    if (!found) throw new UnauthorizedException('Invalid username or password');
    return { token: this.sign(found), user: this.toAuthUser(found) };
  }

  /** Verifies signature and expiry, then re-reads the user from the demo list. */
  verify(token: string): AuthUser {
    const parts = token.split('.');
    if (parts.length !== 2) throw new UnauthorizedException('Malformed token');
    const [body, sig] = parts as [string, string];

    const expected = this.hmac(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Bad token signature');
    }

    let payload: { sub: string; exp: number };
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
        sub: string;
        exp: number;
      };
    } catch {
      throw new UnauthorizedException('Malformed token payload');
    }

    if (Date.now() > payload.exp) throw new UnauthorizedException('Token expired');

    // Re-read rather than trusting the payload: role changes must not survive in a token.
    const user = findDemoUserById(payload.sub);
    if (!user) throw new UnauthorizedException('Unknown subject');
    return this.toAuthUser(user);
  }

  private sign(user: DemoUser): string {
    const body = Buffer.from(
      JSON.stringify({ sub: user.id, exp: Date.now() + this.ttlMs }),
    ).toString('base64url');
    return `${body}.${this.hmac(body)}`;
  }

  private hmac(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  private toAuthUser(u: DemoUser): AuthUser {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      clientOrgId: u.clientOrgId,
    };
  }
}
