import { IsIn } from 'class-validator';
import { NOTIFICATION_KINDS, type NotificationKind } from '@msp/shared';

/**
 * Which notification is being acknowledged.
 *
 * The two kinds are separate acks on purpose: opening the task on Monday does not mean the
 * decision that arrived on Thursday has been read. There is deliberately no `seenAt` field
 * here -- the timestamp is the server's (rule 2), and a client that could name it could also
 * claim to have read a decision before it was released.
 */
export class MarkSeenDto {
  @IsIn([...NOTIFICATION_KINDS])
  kind!: NotificationKind;
}
