import type { Connection, Model } from 'mongoose';
import { DEFAULT_PASSWORD, DEMO_USERS } from '../src/auth/demo-users.js';
import { hashPassword } from '../src/auth/password.js';
import { UserSchema } from '../src/db/schemas/user.schema.js';

/**
 * Put the demo roster in a test database.
 *
 * Since D-037 `AuthService` reads accounts from the `users` collection, so a spec that logs
 * in needs them to exist. Every spec that calls `/auth/login` calls this once in `beforeAll`.
 *
 * The hash is computed ONCE and shared across all twelve accounts. They all have the same
 * password, and scrypt is deliberately slow -- per-user hashing would add a few hundred
 * milliseconds to every spec file for no test value whatsoever.
 */
export async function seedDemoUsers(conn: Connection): Promise<void> {
  // `conn.model(name, schema)` throws if the model is already registered, which it will be
  // whenever the testing module declared it through MongooseModule.forFeature.
  const Users: Model<unknown> =
    (conn.models.User as Model<unknown> | undefined) ??
    (conn.model('User', UserSchema) as unknown as Model<unknown>);

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  /**
   * `insertMany` on what is missing, rather than an upsert.
   *
   * Two reasons, both about matching production. An upsert bypasses document validation, so
   * a roster that broke the role/organisation invariant would seed cleanly in tests and fail
   * at runtime -- and the seed itself deliberately does not use one either, for exactly that
   * reason. And `bulkWrite` does not run Mongoose query middleware, so it would slip past the
   * set-once guard on `role` and `clientOrgId` that this schema now carries: a test setup that
   * can reach states the application cannot is a test setup that hides bugs.
   */
  const existing = await Users.find({}, { _id: 1 }).lean<{ _id: string }[]>();
  const already = new Set(existing.map((d) => String(d._id)));
  const missing = DEMO_USERS.filter((u) => !already.has(u.id));
  if (missing.length === 0) return;

  await Users.insertMany(
    missing.map((u) => ({
      _id: u.id,
      username: u.username,
      displayName: u.displayName,
      passwordHash,
      role: u.role,
      clientOrgId: u.clientOrgId,
      active: true,
      createdBy: null,
    })),
  );
}

export { DEFAULT_PASSWORD };
