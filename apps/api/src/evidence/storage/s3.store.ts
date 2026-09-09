import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type {
  FetchedObject,
  ObjectMetadata,
  ObjectStore,
  StoredObject,
} from './object-store.js';
import { sha256Hex, signRequest } from './sigv4.js';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** MinIO needs path style (`host/bucket/key`); R2 and AWS accept it too. */
  forcePathStyle: boolean;
}

/**
 * Evidence in an S3-compatible bucket. MinIO locally, R2 or anything else in production.
 *
 * Uses `fetch` and the hand-rolled signer, never a vendor SDK (CLAUDE.md section 4). The bucket
 * is expected to already exist -- creating it is a deployment concern, and a service that
 * silently creates its own bucket hides a misconfigured endpoint until the day you look for the
 * data and it is somewhere else.
 *
 * Ownership metadata rides as `x-amz-meta-*`. It is the same model as the GridFS store: the
 * object carries who it belongs to, and authorization is re-derived from the object rather than
 * asserted by the caller.
 */
/**
 * Strip the bucket name off the endpoint if it is already there.
 *
 * Cloudflare R2's dashboard shows the S3 endpoint for a bucket **with the bucket appended**:
 * `https://<account>.r2.cloudflarestorage.com/visit-evidence`. That is the string in front of
 * someone copying it, and pasting it here produces
 * `…/visit-evidence/visit-evidence/sessions/…` — every request 404s, and the 404 reads as "the
 * bucket does not exist" when the bucket is fine and the URL is doubled.
 *
 * The intent is unambiguous, so this fixes it AND says so. Silently correcting configuration is
 * how the next person inherits a setting that does not mean what it says.
 */
export function normaliseEndpoint(config: S3Config, logger?: Logger): string {
  const trimmed = config.endpoint.replace(/\/+$/, '');
  const suffix = `/${config.bucket}`;
  if (!config.bucket || !trimmed.endsWith(suffix)) return trimmed;

  const corrected = trimmed.slice(0, -suffix.length);
  logger?.warn(
    `S3_ENDPOINT ended with "/${config.bucket}", which is the bucket name. Using ` +
      `"${corrected}" instead — S3_ENDPOINT should be the ACCOUNT endpoint and S3_BUCKET the ` +
      'bucket. Cloudflare R2 shows the two joined together, which is where this usually comes from.',
  );
  return corrected;
}

export class S3ObjectStore implements ObjectStore {
  readonly kind = 's3' as const;
  private readonly logger = new Logger('S3ObjectStore');

  constructor(config: S3Config) {
    this.config = { ...config, endpoint: normaliseEndpoint(config, this.logger) };
  }

  private readonly config: S3Config;

  /**
   * Two representations of the same object, and the difference matters.
   *
   * IN THE BUCKET the path is `sessions/<sessionId>/<uuid>`. That prefix is load-bearing:
   * `listBySession` is a prefix list, which S3 does natively and cheaply, where a flat
   * namespace would make replace-and-sweep a full bucket scan.
   *
   * OUTSIDE, the key handed to callers is `<sessionId>.<uuid>` — the same identity with no
   * slashes. A slash-bearing key cannot travel through `/evidence/:evidenceKey`, because a
   * route parameter does not match `/`; the read 404s and the cause looks like a missing
   * object rather than a routing rule. The `ObjectStore` contract already says the key is
   * opaque to every caller, so this is the store keeping that promise rather than leaking its
   * own layout into a URL. It also keeps keys shaped the same as the GridFS store's ObjectIds,
   * so evidence stored before this change still resolves.
   */
  private objectPath(externalKey: string): string {
    const dot = externalKey.indexOf('.');
    if (dot < 0) return externalKey;
    return `sessions/${externalKey.slice(0, dot)}/${externalKey.slice(dot + 1)}`;
  }

  private externalKey(objectPath: string): string {
    const m = /^sessions\/([^/]+)\/(.+)$/.exec(objectPath);
    return m ? `${m[1]}.${m[2]}` : objectPath;
  }

  private url(key = ''): string {
    const base = this.config.endpoint.replace(/\/+$/, '');
    return this.config.forcePathStyle
      ? `${base}/${this.config.bucket}${key ? `/${key}` : ''}`
      : `${base.replace('://', `://${this.config.bucket}.`)}${key ? `/${key}` : ''}`;
  }

  private sign(
    method: 'GET' | 'PUT' | 'DELETE' | 'HEAD',
    url: string,
    payloadSha256: string,
    headers: Record<string, string> = {},
  ): Record<string, string> {
    return signRequest({
      method,
      url,
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      payloadSha256,
      headers,
      now: new Date(),
    });
  }

  async put(data: Buffer, metadata: ObjectMetadata): Promise<StoredObject> {
    const externalKey = `${metadata.sessionId}.${randomUUID()}`;
    const url = this.url(this.objectPath(externalKey));
    const headers = this.sign('PUT', url, sha256Hex(data), {
      'content-type': metadata.contentType,
      'content-length': String(data.length),
      'x-amz-meta-sessionid': metadata.sessionId,
      'x-amz-meta-participantid': metadata.participantId,
      'x-amz-meta-clientorgid': metadata.clientOrgId,
    });

    const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(data) });
    if (!res.ok) {
      throw new Error(`S3 PUT failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    return { key: externalKey, bytes: data.length };
  }

  async get(key: string): Promise<FetchedObject | null> {
    const url = this.url(this.objectPath(key));
    const headers = this.sign('GET', url, sha256Hex(''));
    const res = await fetch(url, { method: 'GET', headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 GET failed: ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    return {
      // Buffered rather than piped: the object is capped at 6 MB and Readable.from keeps the
      // controller identical across both backends.
      stream: Readable.from(buf),
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      bytes: buf.length,
      metadata: this.metaFromHeaders(res.headers),
    };
  }

  async head(key: string): Promise<(Partial<ObjectMetadata> & { key: string }) | null> {
    const url = this.url(this.objectPath(key));
    const headers = this.sign('HEAD', url, sha256Hex(''));
    const res = await fetch(url, { method: 'HEAD', headers });
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`S3 HEAD failed: ${res.status}`);
    return { key, ...this.metaFromHeaders(res.headers) };
  }

  async listBySession(sessionId: string): Promise<string[]> {
    const prefix = `sessions/${sessionId}/`;
    const url = `${this.url()}?list-type=2&prefix=${encodeURIComponent(prefix)}`;
    const headers = this.sign('GET', url, sha256Hex(''));
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) throw new Error(`S3 LIST failed: ${res.status}`);

    /**
     * Parsed with a regex, not an XML library.
     *
     * The response shape here is a flat list of `<Key>` elements and nothing else is read from
     * it, so a parser dependency would be carried for one tag. If this ever needs pagination or
     * attributes, that trade stops being worth it -- revisit rather than extend the regex.
     */
    const xml = await res.text();
    return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => this.externalKey(m[1]!));
  }

  async delete(key: string): Promise<void> {
    const url = this.url(this.objectPath(key));
    const headers = this.sign('DELETE', url, sha256Hex(''));
    const res = await fetch(url, { method: 'DELETE', headers });
    // S3 returns 204 for a delete of something that was never there. That is a success.
    if (!res.ok && res.status !== 404) {
      this.logger.warn(`S3 DELETE ${key} returned ${res.status}`);
    }
  }

  /**
   * A signed, empty LIST against the bucket.
   *
   * Chosen over a HEAD on the bucket because the failure modes are distinguishable: 403 means
   * the credentials or the signature are wrong, 404 means the bucket name is, and a network
   * error means the endpoint is. All three look identical at the first failed upload, which is
   * where this would otherwise surface.
   */
  async verify(): Promise<{ ok: boolean; detail: string }> {
    const url = `${this.url()}?list-type=2&max-keys=1`;
    try {
      const headers = this.sign('GET', url, sha256Hex(''));
      const res = await fetch(url, { method: 'GET', headers });
      if (res.ok) {
        return { ok: true, detail: `${this.config.endpoint}/${this.config.bucket}` };
      }
      if (res.status === 403) {
        return {
          ok: false,
          detail: `403 from ${this.config.endpoint} — check S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY, and that S3_REGION matches the bucket`,
        };
      }
      if (res.status === 404) {
        return {
          ok: false,
          detail: `404 from ${this.config.endpoint} — bucket "${this.config.bucket}" does not exist, or S3_FORCE_PATH_STYLE is wrong for this provider`,
        };
      }
      return { ok: false, detail: `${res.status} from ${this.config.endpoint}` };
    } catch (e) {
      return {
        ok: false,
        detail: `cannot reach ${this.config.endpoint} — ${e instanceof Error ? e.message : 'network error'}`,
      };
    }
  }

  private metaFromHeaders(h: Headers): Partial<ObjectMetadata> {
    return {
      contentType: h.get('content-type') ?? undefined,
      sessionId: h.get('x-amz-meta-sessionid') ?? undefined,
      participantId: h.get('x-amz-meta-participantid') ?? undefined,
      clientOrgId: h.get('x-amz-meta-clientorgid') ?? undefined,
    };
  }
}
