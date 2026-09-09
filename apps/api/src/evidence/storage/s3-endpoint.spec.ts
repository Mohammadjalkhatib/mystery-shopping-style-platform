import { normaliseEndpoint, type S3Config } from './s3.store.js';

const cfg = (over: Partial<S3Config> = {}): S3Config => ({
  endpoint: 'https://abc123.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'visit-evidence',
  accessKeyId: 'k',
  secretAccessKey: 's',
  forcePathStyle: true,
  ...over,
});

/**
 * The endpoint mistake this guards against is not hypothetical: Cloudflare R2's dashboard shows
 * the S3 endpoint for a bucket with the BUCKET ALREADY APPENDED, so the string in front of
 * someone copying it is exactly the wrong one. The resulting doubled path 404s, and the 404
 * reads as "the bucket does not exist" while the bucket is perfectly fine.
 */
describe('S3 endpoint normalisation', () => {
  it('leaves a correct account endpoint alone', () => {
    expect(normaliseEndpoint(cfg())).toBe('https://abc123.r2.cloudflarestorage.com');
  });

  it('strips a trailing slash', () => {
    expect(normaliseEndpoint(cfg({ endpoint: 'https://abc123.r2.cloudflarestorage.com/' }))).toBe(
      'https://abc123.r2.cloudflarestorage.com',
    );
  });

  it('strips the bucket when R2 has already appended it', () => {
    expect(
      normaliseEndpoint(cfg({ endpoint: 'https://abc123.r2.cloudflarestorage.com/visit-evidence' })),
    ).toBe('https://abc123.r2.cloudflarestorage.com');
  });

  it('strips it with a trailing slash too', () => {
    expect(
      normaliseEndpoint(cfg({ endpoint: 'https://abc123.r2.cloudflarestorage.com/visit-evidence/' })),
    ).toBe('https://abc123.r2.cloudflarestorage.com');
  });

  it('does not strip a path that merely CONTAINS the bucket name', () => {
    // Supabase's endpoint ends in /s3; a bucket called "s3" must not eat it.
    expect(
      normaliseEndpoint(cfg({ endpoint: 'https://p.supabase.co/storage/v1/s3', bucket: 'evidence' })),
    ).toBe('https://p.supabase.co/storage/v1/s3');
  });

  it('only strips a whole final segment, never a partial match', () => {
    // "my-visit-evidence" ends with "visit-evidence" as TEXT but is a different bucket path.
    expect(
      normaliseEndpoint(
        cfg({ endpoint: 'https://abc123.r2.cloudflarestorage.com/my-visit-evidence' }),
      ),
    ).toBe('https://abc123.r2.cloudflarestorage.com/my-visit-evidence');
  });

  it('does nothing when the bucket is empty', () => {
    expect(normaliseEndpoint(cfg({ bucket: '' }))).toBe('https://abc123.r2.cloudflarestorage.com');
  });
});
