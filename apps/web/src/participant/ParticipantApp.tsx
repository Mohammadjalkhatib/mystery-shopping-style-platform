import HistoryIcon from '@mui/icons-material/History';
import StorefrontIcon from '@mui/icons-material/Storefront';
import {
  AppBar,
  Badge,
  Box,
  BottomNavigation,
  BottomNavigationAction,
  Button,
  Paper,
  Toolbar,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import type { ParticipantNotification } from '../api/client.js';
import { api, type ParticipantDashboard } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { useLocale, useT } from '../i18n/LocaleContext.js';
import { History } from './History.js';
import { NotificationBell } from './NotificationBell.js';
import { useNotifications } from './useNotifications.js';
import { VisitPage } from './VisitPage.js';

type Tab = 'visit' | 'history';

/**
 * The participant's app shell.
 *
 * Two surfaces where there was one. The visit runner is unchanged in what it does -- it was
 * already the screen that has to work one-handed in a shop -- and everything added here is
 * around it: an inbox that says when work arrives or a decision lands, and a record of
 * everything they have done and what came back (D-034, D-035).
 *
 * **Bottom navigation, not tabs at the top.** Same argument as every primary action on these
 * screens: a phone held one-handed reaches the bottom of the display and not the top. The bar
 * also carries the safe-area inset, because on an iPhone the home indicator sits exactly where
 * an unpadded nav bar would put its tap targets.
 *
 * There is still no router. D-013's reasoning holds -- every screen is scoped to the signed-in
 * user, so a URL for one is a link nobody can usefully share -- and the tab is state, not a
 * location.
 */
export function ParticipantApp() {
  const { user, logout } = useAuth();
  const { toggle } = useLocale();
  const t = useT();

  const [tab, setTab] = useState<Tab>('visit');
  /** The visit a notification pointed at. Cleared once the target screen has consumed it. */
  const [focus, setFocus] = useState<{ tab: Tab; sessionId: string } | null>(null);

  const [dashboard, setDashboard] = useState<ParticipantDashboard | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);

  const notifications = useNotifications(true);

  const loadDashboard = useCallback(async (): Promise<void> => {
    setLoadingDashboard(true);
    try {
      setDashboard(await api.myDashboard());
      setDashboardError(null);
    } catch (e) {
      setDashboardError(e instanceof Error ? e.message : t('common.failedToLoad'));
    } finally {
      setLoadingDashboard(false);
    }
  }, [t]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  /**
   * Re-read the history whenever the inbox changes.
   *
   * The inbox is derived from the same sessions the history renders, so an arriving
   * notification means the history is stale too. Keying on the length rather than the array
   * identity: `useNotifications` replaces the array on every refresh, including the ones that
   * change nothing, and reloading the whole dashboard on each of those would be a request every
   * time the tab regains focus.
   */
  useEffect(() => {
    if (notifications.items.length > 0) void loadDashboard();
  }, [notifications.items.length, loadDashboard]);

  /**
   * Open what a notification refers to.
   *
   * Acknowledged first and separately from the navigation, so the badge clears on tap rather
   * than after a round trip. An assignment goes to the runner ready to consent and start --
   * which is the flow that already existed, reached from a notification instead of by
   * scrolling. A decision goes to the history entry, because the feedback is what they came
   * to read.
   */
  const openNotification = (n: ParticipantNotification): void => {
    void notifications.acknowledge(n.sessionId, n.kind);
    const target: Tab = n.kind === 'assignment' ? 'visit' : 'history';
    setTab(target);
    setFocus({ tab: target, sessionId: n.sessionId });
    void loadDashboard();
  };

  /**
   * Depends on `notifications.refresh`, not on `notifications`.
   *
   * The hook returns a fresh object literal every render, so depending on the whole thing
   * would rebuild this callback on every render and defeat the memo it is written as. The
   * `refresh` function itself is stable.
   */
  const refreshNotifications = notifications.refresh;
  const refreshAll = useCallback((): void => {
    void loadDashboard();
    void refreshNotifications();
  }, [loadDashboard, refreshNotifications]);

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        bgcolor: 'background.default',
        // Clear of the fixed bottom navigation plus the home indicator beneath it.
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 72px)',
      }}
    >
      <AppBar position="sticky">
        <Toolbar sx={{ gap: 1, minHeight: { xs: 56, sm: 64 } }}>
          <Typography
            variant="h3"
            sx={{ fontSize: { xs: '1rem', sm: '1.05rem' }, flexGrow: 1, minWidth: 0 }}
            noWrap
          >
            {tab === 'visit' ? t('participant.yourVisit') : t('participant.history.title')}
          </Typography>
          {/* The name is what a signed-in participant least needs told; it goes last of the text. */}
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ display: { xs: 'none', sm: 'block' } }}
            noWrap
          >
            {user?.displayName}
          </Typography>

          <NotificationBell items={notifications.items} onOpen={openNotification} />

          {/*
            The language toggle shows the language it switches TO, not the current one -- a
            button reading "العربية" while the page is already Arabic is a coin flip.
          */}
          <Button size="small" onClick={toggle}>
            {t('common.language')}
          </Button>
          <Button size="small" onClick={logout}>
            {t('common.signOut')}
          </Button>
        </Toolbar>
      </AppBar>

      {/*
        BOTH screens stay mounted and one is hidden, rather than one being swapped for the
        other.

        This is not a performance choice. `useVisitTracker` lives inside the runner, so
        unmounting it releases the geolocation watch and the wake lock -- a participant who
        glanced at their history mid-visit would come back to a stopped capture and a coverage
        gap they did not cause. Same reasoning as the discreet-mode overlay, which is a sibling
        for exactly this reason.

        `hidden` rather than `display: none` in a style, because MUI's reset makes `[hidden]`
        authoritative and it is the one that survives a component setting its own display.
      */}
      <Box hidden={tab !== 'visit'}>
        <VisitPage
          focusSessionId={focus?.tab === 'visit' ? focus.sessionId : null}
          onChanged={refreshAll}
        />
      </Box>
      <Box hidden={tab !== 'history'}>
        <History
          data={dashboard}
          loading={loadingDashboard}
          error={dashboardError}
          expandSessionId={focus?.tab === 'history' ? focus.sessionId : null}
        />
      </Box>

      <Paper
        elevation={3}
        sx={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          pb: 'env(safe-area-inset-bottom, 0px)',
          borderRadius: 0,
        }}
      >
        <BottomNavigation
          value={tab}
          onChange={(_, v: Tab) => {
            setTab(v);
            setFocus(null);
          }}
          showLabels
        >
          <BottomNavigationAction
            value="visit"
            label={t('participant.nav.visit')}
            icon={<StorefrontIcon />}
          />
          <BottomNavigationAction
            value="history"
            label={t('participant.nav.history')}
            icon={
              // The badge sits on the tab as well as the bell, because a participant who
              // dismissed the sheet without tapping through still has an unread decision.
              <Badge
                color="secondary"
                variant="dot"
                invisible={!notifications.items.some((n) => n.kind === 'outcome')}
              >
                <HistoryIcon />
              </Badge>
            }
          />
        </BottomNavigation>
      </Paper>
    </Box>
  );
}
