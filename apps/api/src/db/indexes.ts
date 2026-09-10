import { Logger } from '@nestjs/common';
import type { Connection } from 'mongoose';
import { PING_TTL_INDEX_NAME } from './schemas/ping.schema.js';

const logger = new Logger('PingTtl');

/** Deliberate ceiling on the retention window. See the check in syncPingTtlIndex. */
export const MAX_PING_RETENTION_DAYS = 365;

export interface TtlSyncResult {
  action: 'created' | 'updated' | 'unchanged';
  previousSeconds: number | null;
  currentSeconds: number;
}

/**
 * Bring the ping TTL index into line with PING_RETENTION_DAYS.
 *
 * Why this function has to exist, and why it is not a refactor:
 *
 * MongoDB fixes `expireAfterSeconds` when the index is CREATED. Re-declaring the index in
 * Mongoose with a different value does not change it and does not error -- it silently
 * no-ops. So without this, `PING_RETENTION_DAYS` works exactly once, on a database that has
 * never seen a ping, and is decorative on every deployment thereafter.
 *
 * That matters more here than it would elsewhere. D-002 chose MongoDB specifically because
 * TTL makes the retention limit "a schema property rather than a cron job that can silently
 * stop running". An env var that silently stops applying is the same failure that argument
 * was meant to avoid, so the decision only holds if something reconciles the two. This is
 * that something.
 *
 * Runs on boot. Idempotent. Logs loudly on any change, because a retention window moving is
 * a privacy-relevant event and should be visible in the logs of whoever moved it.
 */
export async function syncPingTtlIndex(
  connection: Connection,
  retentionDays: number,
): Promise<TtlSyncResult> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new Error(
      `PING_RETENTION_DAYS must be a positive number, got ${String(retentionDays)}. ` +
        'Raw location traces are the most sensitive data in this system; refusing to start ' +
        'rather than defaulting to keeping them forever.',
    );
  }

  // A ceiling as well as a floor. Rule 10 says do not raise the window without asking, and
  // PING_RETENTION_DAYS=36500 previously sailed through with one warning and widened raw
  // location traces to a century. Same argument as the radiusM bound: put it where a fat
  // -fingered env var or a migration cannot reach past it. D-012.
  if (retentionDays > MAX_PING_RETENTION_DAYS) {
    throw new Error(
      `PING_RETENTION_DAYS is ${retentionDays}, above the ${MAX_PING_RETENTION_DAYS} day ` +
        'ceiling. Raising the retention window on raw location traces is a privacy ' +
        'decision (CLAUDE.md rule 10); change the ceiling deliberately and record why.',
    );
  }

  const target = Math.round(retentionDays * 24 * 60 * 60);
  const collection = connection.collection('pings');

  /**
   * On a fresh database the `pings` collection does not exist yet, and `indexes()` throws
   * NamespaceNotFound (code 26) rather than returning an empty list. Left unhandled this
   * crashes the API on its FIRST boot against a new Atlas cluster and on every
   * `docker compose down -v` -- the two moments a reviewer is most likely to hit.
   * Found by schemas.spec.ts, not in production.
   */
  let existing: Array<{ name?: string; expireAfterSeconds?: number }> = [];
  try {
    existing = (await collection.indexes()) as typeof existing;
  } catch (err) {
    const code = (err as { code?: number }).code;
    const message = (err as { message?: string }).message ?? '';
    const namespaceMissing = code === 26 || /ns does not exist|NamespaceNotFound/i.test(message);
    if (!namespaceMissing) throw err;
    // No collection means no indexes to reconcile. createIndex below makes both.
  }
  const ttl = existing.find((i) => i.name === PING_TTL_INDEX_NAME);

  if (!ttl) {
    await collection.createIndex(
      { receivedAt: 1 },
      { name: PING_TTL_INDEX_NAME, expireAfterSeconds: target },
    );
    logger.log(`Created TTL index on pings.receivedAt at ${retentionDays} day(s).`);
    return { action: 'created', previousSeconds: null, currentSeconds: target };
  }

  const current = ttl.expireAfterSeconds ?? null;
  if (current === target) {
    return { action: 'unchanged', previousSeconds: current, currentSeconds: target };
  }

  // collMod is the only way to move expireAfterSeconds on an existing index.
  await connection.db!.command({
    collMod: 'pings',
    index: { name: PING_TTL_INDEX_NAME, expireAfterSeconds: target },
  });

  const direction = current !== null && target > current ? 'WIDENED' : 'narrowed';
  logger.warn(
    `Ping retention ${direction}: ${String(current)}s -> ${target}s (${retentionDays} day(s)). ` +
      'This is a privacy control (CLAUDE.md rule 10).',
  );
  return { action: 'updated', previousSeconds: current, currentSeconds: target };
}

/**
 * Build the `users` indexes on boot, and refuse to start if they cannot be built.
 *
 * `unique: true` on a Mongoose path is an index, not a validator, and `autoIndex` builds it
 * in the background: a failure surfaces on the model's `index` event, which nothing in this
 * app listens to. On a database that already contains two accounts with the same username the
 * build fails silently and `findOne({ username })` starts returning whichever document the
 * storage engine hands back first -- an authentication bug that presents as "sometimes I log
 * in as the wrong person", which is the worst possible way to find out.
 *
 * Same argument as syncPingTtlIndex above: the guarantee is only real if something asserts it
 * on the way up. Awaited and unguarded on purpose -- an API that cannot guarantee unique
 * usernames should not accept logins.
 */
export async function assertUserIndexes(connection: Connection): Promise<void> {
  const users = connection.collection('users');
  // Idempotent: an identical spec is a no-op, and a conflicting one throws rather than
  // quietly leaving the old index in place (Mongoose never drops indexes by itself).
  await users.createIndex({ username: 1 }, { unique: true });
  await users.createIndex({ clientOrgId: 1, role: 1 });
}
