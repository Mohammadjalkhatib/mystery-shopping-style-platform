import type { SessionState } from '@msp/shared';

/**
 * Why a terminal session ended. Pure, and extracted from `SessionsService` because the
 * participant's history screen needs the same answer for a session it is not viewing one at a
 * time (D-034) -- and the alternative was a second copy of the prose, which is exactly how two
 * screens end up disagreeing about what happened to the same visit.
 *
 * D-019 is the reason this distinction exists at all: `abandoned` alone leaves a participant
 * to guess which of three different things happened to them.
 */
export type TerminalReasonCode = 'never_started' | 'went_quiet' | 'no_report' | 'expired';

export interface Timeouts {
  abandonMinutes: number;
  hardCapHours: number;
}

/**
 * Which timer fired, derived from the document rather than read back out of `sessionEvents`:
 * a session with no `startedAt` never began, one with a `startedAt` and no `endedAt` went
 * quiet mid-visit, and one with both finished but never filed a report. Same information,
 * without a second query per row -- which matters more on a history list than on a detail view.
 */
export function terminalReasonCode(
  state: SessionState,
  startedAt: Date | null,
  endedAt: Date | null,
): TerminalReasonCode | null {
  if (state === 'expired') return 'expired';
  if (state !== 'abandoned') return null;
  if (startedAt === null) return 'never_started';
  if (endedAt === null) return 'went_quiet';
  return 'no_report';
}

/**
 * The English fallback for the same thing.
 *
 * This is the ONLY server-composed sentence a participant ever sees, which is why the code
 * above exists at all: without it the Arabic pass produces a screen that is Arabic everywhere
 * except the one line explaining what went wrong (D-022). The client renders from the code and
 * falls back to this only for a code it does not recognise.
 *
 * The numbers come from config at the call site, so this text cannot drift away from the
 * timers that produced it.
 */
export function terminalReasonText(
  code: TerminalReasonCode | null,
  timeouts: Timeouts,
): string | null {
  const { abandonMinutes: mins, hardCapHours: hours } = timeouts;
  switch (code) {
    case 'expired':
      return `This visit reached the ${hours}-hour limit for a single session and was closed automatically. Location was no longer being recorded.`;
    case 'never_started':
      return `This visit was never started, and was closed automatically after ${mins} minutes.`;
    case 'went_quiet':
      return `No location update arrived for ${mins} minutes, so this visit was closed automatically. Capture stops when the screen locks or the tab is backgrounded.`;
    case 'no_report':
      return `This visit was ended but no report was filed within ${mins} minutes, so it was closed automatically.`;
    default:
      return null;
  }
}
