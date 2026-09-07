import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

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
}
