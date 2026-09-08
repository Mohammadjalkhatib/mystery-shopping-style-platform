import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4, by hand.
 *
 * CLAUDE.md section 4: the code talks to the S3 API, never to a vendor SDK. That rule is the
 * reason this file exists rather than `@aws-sdk/client-s3`, and it is worth the ~90 lines: the
 * SDK is several megabytes and a vendor coupling for four verbs, and swapping MinIO for R2 for
 * Backblaze then becomes a config change rather than a client change.
 *
 * Everything here is pure. Given the same inputs it produces the same signature, with no clock
 * read, no network and no environment lookup -- which is what makes it testable at all, and it
 * is the only part of the S3 path that CAN be tested without a bucket.
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';

export interface SignInput {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  /** Full URL including any query string. */
  url: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Hex SHA-256 of the body. `UNSIGNED-PAYLOAD` is not used: S3 accepts it, MinIO is stricter. */
  payloadSha256: string;
  /** Extra headers to sign, e.g. content-type and x-amz-meta-*. */
  headers?: Record<string, string>;
  /** Injected, never read from the clock, so signing stays pure. */
  now: Date;
}

export const sha256Hex = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

/** `20260909T134501Z` and `20260909`. */
export function amzDate(now: Date): { amzDateTime: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDateTime: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * Percent-encode a path segment the way S3 expects.
 *
 * `encodeURIComponent` leaves `!'()*` alone and S3 does not, so a key containing any of them
 * would produce a canonical request the server does not agree with -- and the failure is a
 * 403 SignatureDoesNotMatch that says nothing about which character caused it.
 */
export function encodeS3Path(path: string): string {
  return path
    .split('/')
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

export interface CanonicalParts {
  canonicalRequest: string;
  signedHeaders: string;
  credentialScope: string;
  stringToSign: string;
}

/**
 * The two documents SigV4 is actually about, built separately so they can be asserted on.
 *
 * Header names are lowercased and sorted; values are trimmed. Getting the ordering wrong is the
 * single most common SigV4 mistake and it surfaces only as a 403 from the far end.
 */
export function canonicalise(input: SignInput): CanonicalParts {
  const url = new URL(input.url);
  const service = input.service ?? 's3';
  const { amzDateTime, dateStamp } = amzDate(input.now);

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': input.payloadSha256,
    'x-amz-date': amzDateTime,
    ...Object.fromEntries(
      Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  };

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((n) => `${n}:${headers[n]!.trim()}\n`).join('');
  const signedHeaders = sortedNames.join(';');

  // Query parameters are sorted by key, each encoded, joined with '&'.
  const query = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonicalRequest = [
    input.method,
    encodeS3Path(url.pathname),
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadSha256,
  ].join('\n');

  const credentialScope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDateTime,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  return { canonicalRequest, signedHeaders, credentialScope, stringToSign };
}

/** The derived signing key: date, region, service, then the terminator. Never the raw secret. */
export function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/** The headers to send, including Authorization. */
export function signRequest(input: SignInput): Record<string, string> {
  const service = input.service ?? 's3';
  const { amzDateTime, dateStamp } = amzDate(input.now);
  const { signedHeaders, credentialScope, stringToSign } = canonicalise(input);

  const key = signingKey(input.secretAccessKey, dateStamp, input.region, service);
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex');

  return {
    ...(input.headers ?? {}),
    'x-amz-content-sha256': input.payloadSha256,
    'x-amz-date': amzDateTime,
    Authorization:
      `${ALGORITHM} Credential=${input.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
