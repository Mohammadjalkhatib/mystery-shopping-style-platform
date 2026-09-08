import { IsInt, IsMongoId, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

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
   */
  @IsOptional()
  @IsMongoId()
  evidenceKey?: string;
}
