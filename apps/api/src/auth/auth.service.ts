import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
// node: prefix so the builtin is unambiguous under ESM resolution.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthUser } from '@msp/shared';
import { User } from '../db/schemas/user.schema.js';
import { verifyPassword } from './password.js';

/** What a lookup needs. `passwordHash` is `select: false`, so it is asked for by name. */
interface UserLean {
  _id: string;
  username: string;
  displayName: string;
  role: AuthUser['role'];
  clientOrgId: string | null;
  active: boolean;
  passwordHash?: string;
}

/**
 * Demo token issuer, now over real accounts.
 *
 * Format: `<base64url(payload)>.<base64url(hmac-sha256)>`. That is enough to make the token
 * unforgeable without JWT_SECRET, which is all the guards need. It has no algorithm
 * negotiation, so it also has none of the `alg: none` class of JWT footguns.
 *
 * Since D-037 the accounts behind it live in the `users` collection with scrypt-hashed
 * passwords, and can be created at runtime. Still not production auth: no rotation, no
 * refresh, no reset, and a shared default password (D-008, D-037).
 */
@Injectable()
export class AuthService {
  private readonly secret: string;
  private readonly ttlMs: number;

  constructor(
    config: ConfigService,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {
    this.secret = config.get<string>('JWT_SECRET') ?? 'change-me-locally';
    // Long-lived on purpose: a reviewer should not get logged out mid-demo.
    this.ttlMs = 7 * 24 * 60 * 60 * 1000;
  }

  async login(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const found = await this.users
      .findOne({ username: username.trim().toLowerCase() })
      .select('+passwordHash')
      .lean<UserLean | null>();

    /**
     * One message and one code for "no such user" and "wrong password", and the hash is
     * verified even when the user does not exist. Branching earlier would answer "does this
     * username exist" in the response time -- roughly a scrypt round, which is tens of
     * milliseconds and trivially measurable over a network. That matters more now that
     * usernames are chosen by a business rather than being a published demo list.
     */
    const ok = await verifyPassword(password, found?.passwordHash ?? DUMMY_HASH);
    if (!found || !ok || !found.active) {
      throw new UnauthorizedException('Invalid username or password');
    }

    return { token: this.sign(found._id), user: toAuthUser(found) };
  }

  /**
   * Verifies signature and expiry, then re-reads the user.
   *
   * This is a database read on EVERY authenticated request, which is a deliberate cost. The
   * alternative -- trusting the role and org in the token payload -- means a deactivated
   * account keeps working for up to seven days. Deactivation is the only control this system
   * has over an account, and a control that takes a week to apply is not one. The read is
   * projected to the five fields an `AuthUser` needs, because this guard sits in front of ping
   * ingest, which is the highest-write path in the system.
   *
   * **The immediacy has one hole, and it is not fixed here.** Guards run when a request
   * starts, and an `@Sse()` stream is one request that stays open -- so deactivating someone
   * mid-visit stops their next REST call but does NOT close a console or notification stream
   * they already hold. It closes when they reconnect. Terminating live streams on
   * deactivation needs a signal from here into the events services and belongs with whatever
   * adds session revocation.
   *
   * A driver error propagates rather than being caught. A Mongo blip must not be
   * indistinguishable from "no such user": that would log every signed-in user out during a
   * transient outage, including a participant mid-visit.
   */
  async verify(token: string): Promise<AuthUser> {
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

    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
      throw new UnauthorizedException('Malformed token payload');
    }
    if (Date.now() > payload.exp) throw new UnauthorizedException('Token expired');

    const user = await this.users
      .findById(payload.sub)
      .select({ username: 1, displayName: 1, role: 1, clientOrgId: 1, active: 1 })
      .lean<UserLean | null>();
    if (!user) throw new UnauthorizedException('Unknown subject');
    if (!user.active) throw new UnauthorizedException('Account is deactivated');
    return toAuthUser(user);
  }

  private sign(userId: string): string {
    const body = Buffer.from(
      JSON.stringify({ sub: userId, exp: Date.now() + this.ttlMs }),
    ).toString('base64url');
    return `${body}.${this.hmac(body)}`;
  }

  private hmac(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}

function toAuthUser(u: UserLean): AuthUser {
  return {
    id: u._id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    clientOrgId: u.clientOrgId,
  };
}

/**
 * A real, well-formed scrypt record for a password nobody has, used only to keep the timing
 * of an unknown username indistinguishable from a known one. Its parameters must match what
 * `hashPassword` writes, or the timing tells you what you were trying to hide.
 */
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
