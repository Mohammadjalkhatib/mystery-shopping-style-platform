import { IsBoolean } from 'class-validator';

/**
 * Switch an account on or off.
 *
 * Deactivation rather than deletion: sessions, reports and append-only verification results
 * (rule 8) reference a participant by id forever, and removing the user behind a completed
 * visit would leave a verdict attributed to nobody.
 */
export class SetActiveDto {
  @IsBoolean()
  active!: boolean;
}
