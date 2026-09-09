import { IsInt, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';
import { EVIDENCE_KEY_PATTERN } from '../../evidence/storage/object-store.js';

/**
 * Three fields, one of them optional. Everything else about a submission is server-owned.
 *
 * With `forbidNonWhitelisted`, a client sending `submittedAt`, `verdict`, `score` or
 * `sessionId` in the body gets a 400 naming the field (rule 2). `sessionId` comes from the
 * path and the participant from the token.
 */
export class CreateReportDto {
  @IsString()
  @MinLength(10, { message: 'notes must say something: at least 10 characters' })
  notes!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  /**
   * The photo uploaded earlier for this visit, if there is one.
   *
   * An identifier the client may CARRY but is never believed about. Same shape as
   * `clientPingId`: the value names something the server already stored, and the server
   * re-checks that the stored object was uploaded against THIS session before accepting it.
   * Without that check a participant could attach another visit's photo by pasting its id.
   *
   * Validated against the STORE'S contract, not against MongoDB's. This was `@IsMongoId()`,
   * which held only while GridFS was the sole backend; the moment an S3 bucket was configured
   * the store began issuing `<sessionId>.<uuid>` keys and every upload succeeded and then
   * failed at submission with "evidenceKey must be a mongodb id" (D-033). The format check is
   * input hygiene only -- `assertBelongsTo` in the submit path is the actual control, and it
   * asks the store whether this key was uploaded against THIS session.
   */
  @IsOptional()
  @Matches(EVIDENCE_KEY_PATTERN, {
    message: 'evidenceKey is not a key this server issued',
  })
  evidenceKey?: string;
}
