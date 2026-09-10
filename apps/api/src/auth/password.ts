// node: prefix so the builtin is unambiguous under ESM resolution.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with `node:crypto`'s scrypt. No new dependency, on purpose.
 *
 * scrypt is memory-hard and is in the standard library, which matters here for the same
 * reason `AuthService` issues an HMAC token instead of pulling in `@nestjs/jwt` (D-008):
 * bcrypt and argon2 are both native modules, and a native module means a compiler in the API
 * image and a rebuild story for every Node version bump. That is real cost for a build whose
 * password storage nobody is grading. See D-037.
 *
 * The encoded form carries its own parameters:
 *
 *   scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
 *
 * so the cost can be raised later and old hashes still verify against the parameters they
 * were written with. A bare `salt$hash` would pin the cost forever, which is the mistake that
 * makes hashing schemes impossible to migrate.
 */

/**
 * N = 16384, r = 8, p = 1: the classic interactive-login parameters, ~16 MB and a few tens of
 * milliseconds per hash. Deliberately not higher: `verify` runs on every authenticated
 * request but hashes nothing, so this cost is paid only at login.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

/**
 * Node's default `maxmem` is 32 MB and N=16384,r=8 needs 128*N*r = 16 MB, so the default
 * would just about hold -- but only for these parameters. `derive` passes an explicit
 * headroom of 256*N*r so raising the cost later cannot start failing with an opaque
 * "memory limit exceeded" from inside the crypto binding.
 */
const MEM_HEADROOM = 256;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Constant-time verification against the parameters stored with the hash.
 *
 * Returns false rather than throwing on a malformed record: a corrupted or hand-edited row
 * must fail the login, not 500 the endpoint and tell the caller that this username exists.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!isSaneCost(n, r, p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, 'base64');
    expected = Buffer.from(parts[5]!, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await derive(password, salt, n, r, p);
  } catch {
    return false;
  }

  // Length is checked first because timingSafeEqual throws on a mismatch rather than
  // returning false, and the length of a stored hash is not a secret.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A guard on the parameters read back out of the database, not a style check.
 *
 * scrypt's memory use is 128 * N * r bytes. A row carrying N = 2^30 would ask Node for a
 * terabyte and hang the event loop while it tried -- an unauthenticated request turning into
 * a denial of service through a field nobody thought of as input. Anything outside the range
 * this code has ever written is refused.
 */
function isSaneCost(n: number, r: number, p: number): boolean {
  return (
    Number.isInteger(n) && n >= 1024 && n <= 1 << 20 &&
    Number.isInteger(r) && r >= 1 && r <= 16 &&
    Number.isInteger(p) && p >= 1 && p <= 16
  );
}

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(
      password,
      salt,
      KEYLEN,
      { N: n, r, p, maxmem: MEM_HEADROOM * n * r },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}
