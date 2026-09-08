import { IsMongoId, IsString, MaxLength } from 'class-validator';

/**
 * Hand one task to one participant.
 *
 * No `clientOrgId` and no session fields. The org is derived from the task, and the session
 * this creates is written entirely by the server -- `state`, `createdAtServer` and `lastSeenAt`
 * are server clock readings and a client may not propose any of them (rules 2 and 5).
 */
export class CreateAssignmentDto {
  @IsMongoId()
  taskId!: string;

  /** A demo user id such as `u-participant-7`. Checked against the demo roster, not free text. */
  @IsString()
  @MaxLength(120)
  participantId!: string;
}
