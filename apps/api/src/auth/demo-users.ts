import type { AuthUser } from '@msp/shared';

/**
 * DEMO CREDENTIALS. This is not an identity system and is not pretending to be one.
 *
 * There is no user collection, no password hashing, no registration, no refresh tokens and
 * no password reset. Accounts are a hardcoded list so a reviewer can log in as any role in
 * one step. See docs/DECISIONS.md D-008 for why this was scoped out rather than half-built.
 *
 * What IS real: the token is HMAC-signed and verified, and the role guards are enforced on
 * every protected route and covered by tests. The boundaries are genuine even though the
 * accounts behind them are fake.
 */

export const DEMO_PASSWORD = 'demo1234';

export interface DemoUser extends AuthUser {
  password: string;
}

const ORG_A = 'org-alfa-retail';

export const DEMO_USERS: readonly DemoUser[] = [
  {
    id: 'u-admin',
    username: 'admin',
    displayName: 'Platform Admin',
    role: 'admin',
    clientOrgId: null,
    password: DEMO_PASSWORD,
  },
  {
    id: 'u-business',
    username: 'business',
    displayName: 'Alfa Retail (Business)',
    role: 'business',
    clientOrgId: ORG_A,
    password: DEMO_PASSWORD,
  },
  // Ten participants, user1 .. user10.
  ...Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    return {
      id: `u-participant-${n}`,
      username: `user${n}`,
      displayName: `Participant ${n}`,
      role: 'participant' as const,
      clientOrgId: ORG_A,
      password: DEMO_PASSWORD,
    };
  }),
];

export function findDemoUser(username: string, password: string): DemoUser | undefined {
  return DEMO_USERS.find((u) => u.username === username && u.password === password);
}

export function findDemoUserById(id: string): DemoUser | undefined {
  return DEMO_USERS.find((u) => u.id === id);
}
