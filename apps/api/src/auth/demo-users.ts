import type { Role } from '@msp/shared';

/**
 * The demo ROSTER. Since D-037 this is seed data, not the runtime identity store.
 *
 * Accounts now live in the `users` collection and are looked up there on every login and
 * every request. This file survives for two reasons and no others:
 *
 *  1. The seed needs a fixed list to upsert, so `docker compose up` still hands a reviewer
 *     working logins with no manual step.
 *  2. **The ids are load-bearing.** Assignments, sessions, reports and participant stats in
 *     the deployed database all reference `u-participant-1` .. `u-participant-10` as plain
 *     strings. The seed upserts on these exact `_id` values; generating new ones would orphan
 *     every existing visit silently -- blank dashboards, no errors.
 *
 * The passwords here are public and in source control, which is correct for a demo and
 * catastrophic anywhere else. What changed since D-008 is that they are now stored hashed
 * (scrypt, see password.ts) rather than compared as plaintext, and that new accounts can be
 * created at runtime by an admin or a business.
 */

/**
 * The password every account gets: the seeded roster, and every account created through the
 * console. Chosen deliberately over a generated one-time password (D-037) -- there is no mail
 * transport in this build, so a generated password would have to be displayed once and would
 * be unrecoverable the moment the dialog closed.
 *
 * This is the single thing in the authentication story that is still demo-shaped. Real
 * onboarding is an invite link or a forced first-login reset, and neither is in scope.
 */
export const DEFAULT_PASSWORD = 'demo1234';

/** Kept as the old name so nothing that reads it has to change. */
export const DEMO_PASSWORD = DEFAULT_PASSWORD;

export interface DemoUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  clientOrgId: string | null;
}

/**
 * The demo organisation id, used as the ClientOrg._id by the seed.
 *
 * A literal string rather than a generated ObjectId, and shared with seed.ts on purpose.
 * These were two independent values -- the demo users carried this constant while the seed
 * wrote whatever ObjectId Mongo generated -- so the tenancy filter never matched and a
 * reviewer signing in as `business` saw an EMPTY CONSOLE for every seeded visit.
 *
 * Every test missed it because each builds its own data with a self-consistent org id. It
 * only appears where the two subsystems meet, which is the demo. See D-014.
 */
export const DEMO_CLIENT_ORG_ID = 'org-alfa-retail';
const ORG_A = DEMO_CLIENT_ORG_ID;

export const DEMO_USERS: readonly DemoUser[] = [
  {
    id: 'u-admin',
    username: 'admin',
    displayName: 'Platform Admin',
    role: 'admin',
    clientOrgId: null,
  },
  {
    id: 'u-business',
    username: 'business',
    displayName: 'Alfa Retail (Business)',
    role: 'business',
    clientOrgId: ORG_A,
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
    };
  }),
];
