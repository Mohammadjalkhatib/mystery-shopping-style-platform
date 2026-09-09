import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateReportDto } from './create-report.dto.js';

const errorsFor = (body: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(CreateReportDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).flatMap((e) => Object.keys(e.constraints ?? {}).map((k) => `${e.property}:${k}`));

const valid = { notes: 'Staff greeted within ten seconds.', rating: 4 };

/**
 * This DTO is where the store's "keys are opaque" contract was quietly broken.
 *
 * `evidenceKey` was validated with `@IsMongoId()`, which was true of GridFS keys and false of
 * S3 keys. Configuring a bucket therefore broke submission for every visit with a photo --
 * the upload succeeded, and the report that referenced it was rejected as malformed. These
 * cases pin the shapes BOTH shipped backends actually produce.
 */
describe('CreateReportDto evidenceKey', () => {
  it('accepts a GridFS key (a 24-character ObjectId)', () => {
    expect(errorsFor({ ...valid, evidenceKey: '6aa08b93549afae127d9012e' })).toEqual([]);
  });

  it('accepts an S3 key (sessionId.uuid) — the shape that broke submission', () => {
    expect(
      errorsFor({
        ...valid,
        evidenceKey: '6a9fbe97966ecc34c3f75f3b.7c8ad147-5961-4c3b-a945-d4df30e73bb5',
      }),
    ).toEqual([]);
  });

  it('is optional, because a report without a photo is normal', () => {
    expect(errorsFor(valid)).toEqual([]);
  });

  it('refuses a key containing a slash', () => {
    // A slash cannot survive `/evidence/:evidenceKey` — a route parameter does not match one.
    expect(errorsFor({ ...valid, evidenceKey: 'sessions/abc/photo.png' })).toContain(
      'evidenceKey:matches',
    );
  });

  it('refuses path traversal', () => {
    expect(errorsFor({ ...valid, evidenceKey: '../../etc/passwd' })).toContain(
      'evidenceKey:matches',
    );
    expect(errorsFor({ ...valid, evidenceKey: 'abc..def' })).toContain('evidenceKey:matches');
  });

  it('refuses an unbounded value', () => {
    expect(errorsFor({ ...valid, evidenceKey: 'a'.repeat(500) })).toContain(
      'evidenceKey:matches',
    );
  });

  it('still rejects server-owned fields (rule 2)', () => {
    // The reason this DTO exists at all. A client naming its own verdict gets a 400.
    expect(errorsFor({ ...valid, verdict: 'auto_verified' })).toContain(
      'verdict:whitelistValidation',
    );
  });
});
