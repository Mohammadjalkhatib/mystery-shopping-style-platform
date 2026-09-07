import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';

/**
 * Two fields. Everything else about a submission is server-owned.
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
}
