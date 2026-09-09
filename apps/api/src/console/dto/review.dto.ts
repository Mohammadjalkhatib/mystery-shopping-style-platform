import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A reviewer overriding the engine.
 *
 * `note` is required and has a floor, not a ceiling of politeness: an override with no stated
 * reason is exactly the thing that makes a review queue useless six months later, and it is
 * also the labelled data D-009 needs.
 */
export class ReviewDto {
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @IsString()
  @MinLength(10, { message: 'note must say why: at least 10 characters' })
  @MaxLength(1000)
  note!: string;

  /**
   * Feedback written FOR the participant, and the only part of a review they ever read.
   *
   * A second field rather than a reuse of `note`, because the two have different audiences and
   * the reviewer knows which one they are writing. `note` stays required and candid -- it is
   * the labelled data D-009 needs, and candour is the first thing lost when the subject can
   * read it. This one is OPTIONAL, because a reviewer with nothing useful to say should leave
   * it empty rather than pad it. D-034.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  feedbackToParticipant?: string;
}
