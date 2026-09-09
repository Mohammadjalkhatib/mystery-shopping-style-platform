import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import {
  Badge,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import type { ParticipantNotification } from '../api/client.js';
import { useT } from '../i18n/LocaleContext.js';
import { OutcomeChip } from './OutcomeChip.js';

/**
 * The participant's inbox.
 *
 * A bottom sheet rather than a menu anchored to the bell. This is a one-handed phone screen:
 * a dropdown from the top-right corner puts every tap target at the far end of a thumb's
 * reach, and the list can be several lines per row. It opens from the bottom for the same
 * reason the primary action on every other participant screen is at the bottom.
 *
 * Tapping a notification does two things and in this order: it acknowledges (so the badge
 * clears immediately, optimistically) and it navigates to the thing itself. The notification
 * is never the destination -- an assignment opens the visit runner ready to consent and start,
 * a decision opens the history entry that carries the feedback.
 */
export function NotificationBell({
  items,
  onOpen,
}: {
  items: ParticipantNotification[];
  onOpen: (n: ParticipantNotification) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        onClick={() => setOpen(true)}
        aria-label={t('participant.notifications.title')}
        size="small"
      >
        {/*
          The count is on the badge and repeated in the aria-label, because a number rendered
          as a coloured dot is invisible to a screen reader and this is the only surface that
          tells a participant they have work waiting.
        */}
        <Badge badgeContent={items.length} color="secondary" max={99}>
          <NotificationsNoneIcon />
        </Badge>
      </IconButton>

      <Drawer
        anchor="bottom"
        open={open}
        onClose={() => setOpen(false)}
        slotProps={{
          paper: {
            sx: {
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              maxHeight: '70dvh',
              pb: 'env(safe-area-inset-bottom, 0px)',
            },
          },
        }}
      >
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="h3" sx={{ fontSize: '1.1rem' }}>
            {t('participant.notifications.title')}
          </Typography>
        </Box>
        <Divider />

        {items.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="text.secondary">{t('participant.notifications.none')}</Typography>
          </Box>
        ) : (
          <List disablePadding>
            {items.map((n) => (
              <ListItemButton
                key={`${n.kind}:${n.sessionId}`}
                onClick={() => {
                  setOpen(false);
                  onOpen(n);
                }}
                sx={{ alignItems: 'flex-start', py: 1.5 }}
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography component="span" sx={{ fontWeight: 600 }}>
                        {n.kind === 'assignment'
                          ? t('participant.notifications.newAssignment')
                          : n.outcome === 'approved'
                            ? t('participant.notifications.outcomeApproved')
                            : t('participant.notifications.outcomeNotApproved')}
                      </Typography>
                      {n.kind === 'outcome' && <OutcomeChip outcome={n.outcome} />}
                    </Stack>
                  }
                  secondary={
                    <>
                      {n.taskTitle} · {n.venueName}
                      <br />
                      {new Date(n.at).toLocaleString()}
                    </>
                  }
                />
              </ListItemButton>
            ))}
          </List>
        )}

        <Box sx={{ p: 2 }}>
          <Button fullWidth onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
        </Box>
      </Drawer>
    </>
  );
}
