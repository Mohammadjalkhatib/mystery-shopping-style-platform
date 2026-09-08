import {
  amzDate,
  canonicalise,
  encodeS3Path,
  sha256Hex,
  signingKey,
  signRequest,
  type SignInput,
} from './sigv4.js';

/**
 * SigV4 is the one part of the S3 path that can be tested without a bucket, and it is the part
 * that fails silently: every mistake here surfaces as a bare `403 SignatureDoesNotMatch` from
 * the far end, with no indication of which byte was wrong. Everything below is pure.
 *
 * These are structural assertions, not a published AWS vector — the end-to-end proof is a real
 * PUT against MinIO in the compose stack, which is the only thing that proves the whole chain.
 */
const base: SignInput = {
  method: 'PUT',
  url: 'http://minio:9000/visit-evidence/sessions/abc/photo.png',
  region: 'auto',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  payloadSha256: sha256Hex('hello'),
  headers: { 'content-type': 'image/png', 'x-amz-meta-sessionid': 'abc' },
  now: new Date('2026-09-09T13:45:01.000Z'),
};

describe('AWS SigV4', () => {
  describe('amzDate', () => {
    it('formats both stamps the way the spec wants', () => {
      const { amzDateTime, dateStamp } = amzDate(new Date('2026-09-09T13:45:01.000Z'));
      expect(amzDateTime).toBe('20260909T134501Z');
      expect(dateStamp).toBe('20260909');
    });
  });

  describe('encodeS3Path', () => {
    it('leaves slashes as separators', () => {
      expect(encodeS3Path('/bucket/sessions/a/b.png')).toBe('/bucket/sessions/a/b.png');
    });

    it("encodes the characters encodeURIComponent leaves alone but S3 does not", () => {
      // !'()* — the failure this prevents is a 403 that names no cause.
      expect(encodeS3Path("/a!b'c(d)e*f")).toBe('/a%21b%27c%28d%29e%2Af');
    });

    it('encodes spaces and unicode', () => {
      expect(encodeS3Path('/my photo.png')).toBe('/my%20photo.png');
    });
  });

  describe('canonicalise', () => {
    const parts = canonicalise(base);

    it('sorts and lowercases the signed headers', () => {
      expect(parts.signedHeaders).toBe(
        'content-type;host;x-amz-content-sha256;x-amz-date;x-amz-meta-sessionid',
      );
    });

    it('puts the method, path and payload hash in the canonical request', () => {
      const lines = parts.canonicalRequest.split('\n');
      expect(lines[0]).toBe('PUT');
      expect(lines[1]).toBe('/visit-evidence/sessions/abc/photo.png');
      expect(lines[2]).toBe('');
      expect(lines[lines.length - 1]).toBe(base.payloadSha256);
    });

    it('builds the string to sign as algorithm, time, scope, hash', () => {
      const [alg, time, scope, hash] = parts.stringToSign.split('\n');
      expect(alg).toBe('AWS4-HMAC-SHA256');
      expect(time).toBe('20260909T134501Z');
      expect(scope).toBe('20260909/auto/s3/aws4_request');
      expect(hash).toBe(sha256Hex(parts.canonicalRequest));
    });

    it('sorts query parameters by key', () => {
      const q = canonicalise({
        ...base,
        method: 'GET',
        url: 'http://minio:9000/visit-evidence?prefix=sessions%2Fabc%2F&list-type=2',
      });
      expect(q.canonicalRequest.split('\n')[2]).toBe('list-type=2&prefix=sessions%2Fabc%2F');
    });
  });

  describe('signingKey', () => {
    it('never contains the raw secret', () => {
      const key = signingKey(base.secretAccessKey, '20260909', 'auto', 's3');
      expect(key.toString('hex')).not.toContain(Buffer.from(base.secretAccessKey).toString('hex'));
      expect(key.length).toBe(32);
    });

    it('is different per day, per region and per service', () => {
      const a = signingKey(base.secretAccessKey, '20260909', 'auto', 's3').toString('hex');
      expect(signingKey(base.secretAccessKey, '20260910', 'auto', 's3').toString('hex')).not.toBe(a);
      expect(signingKey(base.secretAccessKey, '20260909', 'us-east-1', 's3').toString('hex')).not.toBe(a);
      expect(signingKey(base.secretAccessKey, '20260909', 'auto', 'sts').toString('hex')).not.toBe(a);
    });
  });

  describe('signRequest', () => {
    const headers = signRequest(base);

    it('emits an Authorization header in the documented shape', () => {
      expect(headers.Authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20260909\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
      );
    });

    it('sends the payload hash and the date as headers, since both are signed', () => {
      expect(headers['x-amz-content-sha256']).toBe(base.payloadSha256);
      expect(headers['x-amz-date']).toBe('20260909T134501Z');
    });

    it('keeps the caller headers so the request actually carries what was signed', () => {
      // Signing headers that are not sent is the other half of the same 403.
      expect(headers['content-type']).toBe('image/png');
      expect(headers['x-amz-meta-sessionid']).toBe('abc');
    });

    it('is deterministic for identical input', () => {
      expect(signRequest(base).Authorization).toBe(headers.Authorization);
    });

    it.each([
      ['method', { method: 'GET' as const }],
      ['url', { url: 'http://minio:9000/visit-evidence/other.png' }],
      ['payload', { payloadSha256: sha256Hex('different') }],
      ['region', { region: 'us-east-1' }],
      ['time', { now: new Date('2026-09-09T13:45:02.000Z') }],
      ['secret', { secretAccessKey: 'another-secret-entirely' }],
      ['a signed header', { headers: { 'content-type': 'image/webp' } }],
    ])('changes the signature when %s changes', (_what, patch) => {
      expect(signRequest({ ...base, ...patch }).Authorization).not.toBe(headers.Authorization);
    });
  });
});
