import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationKind } from '@msp/shared';
import { api, type ParticipantNotification } from '../api/client.js';
import { useSseStream, type StreamStatus } from '../hooks/useSseStream.js';

export interface NotificationsState {
  items: ParticipantNotification[];
  status: StreamStatus;
  /** Re-read from the server. The list is the truth; the stream only says when to re-read. */
  refresh: () => Promise<void>;
  /** Mark one read, optimistically, then confirm with the server. */
  acknowledge: (sessionId: string, kind: NotificationKind) => Promise<void>;
}

/**
 * The participant's notification inbox.
 *
 * **The stream is a nudge, not the data.** An arriving event triggers a re-read of
 * `/me/notifications` rather than being appended to the list. That is a deliberate round trip,
 * and it is the difference between a notification list and a message log: the server derives
 * notifications from the work itself (D-035), so re-reading cannot show a notification for an
 * assignment that has since been completed, renamed or reassigned, and appending would.
 *
 * It also means a dropped event is survivable rather than a permanent hole. The list is
 * refetched on every reconnect and whenever the tab comes back to the foreground, so the worst
 * case for a lost push is a late notification, not a missing one.
 */
export function useNotifications(enabled: boolean): NotificationsState {
  const [items, setItems] = useState<ParticipantNotification[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    try {
      setItems(await api.myNotifications());
    } catch {
      // A failed refresh leaves the previous list on screen. An empty inbox because the
      // network blinked would be a worse lie than a slightly stale one.
    }
  }, [enabled]);

  // Kept in a ref so the stream callback never captures a stale closure.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const status = useSseStream<unknown>('/me/notifications/stream', 'notification', () => {
    void refreshRef.current();
  });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Re-read when the tab comes back.
   *
   * Capture is released while the page is hidden and a phone suspends a backgrounded tab
   * outright, so the stream is very often dead on return with the reconnect still in backoff.
   * Someone reopening the app expects to see what arrived while it was closed.
   */
  useEffect(() => {
    if (!enabled) return;
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refreshRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled]);

  const acknowledge = useCallback(
    async (sessionId: string, kind: NotificationKind): Promise<void> => {
      // Optimistic: the badge must clear the instant it is tapped, not a round trip later.
      setItems((prev) => prev.filter((n) => !(n.sessionId === sessionId && n.kind === kind)));
      try {
        await api.markNotificationSeen(sessionId, kind);
      } catch {
        // Put it back. A 409 here means the decision was not actually released, and silently
        // swallowing that would hide a real notification for good.
        await refreshRef.current();
      }
    },
    [],
  );

  return { items, status, refresh, acknowledge };
}
