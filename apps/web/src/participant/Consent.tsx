import { Box, Button, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { useT } from '../i18n/LocaleContext.js';
import { qa } from '../theme/theme.js';

/** Bump this when the text below changes. The server records which version was agreed to. */
export const CONSENT_VERSION = 'v1';

/**
 * The consent screen.
 *
 * Written to be read, not skipped past. It says what is collected, for how long, what the
 * system can and cannot conclude from it, and that the participant can stop. The claim that
 * the raw trace is deleted is not marketing -- it is the TTL index in
 * `apps/api/src/db/schemas/ping.schema.ts`, reconciled on every boot against
 * `PING_RETENTION_DAYS` (rule 10).
 */
export function Consent({
  venueName,
  onAgree,
  busy,
}: {
  venueName: string;
  onAgree: () => void;
  busy: boolean;
}) {
  const [read, setRead] = useState(false);
  const t = useT();

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 560, mx: 'auto' }}>
      <Typography variant="h1" sx={{ fontSize: '1.6rem', mb: 0.5 }}>
        {t('participant.consent.title')}
      </Typography>
      <Typography color="text.secondary" variant="body2" sx={{ mb: 2.5 }}>
        {venueName}
      </Typography>

      {/*
        Four bordered sections rather than four headings inside one card.

        The four things this screen has to say are separate claims -- what is taken, what it is
        for, how long it is kept, what the app cannot do -- and running them together inside a
        single card made them read as one wall to scroll past. Giving each its own edge is the
        whole change; the gate below is unchanged and still a single acknowledgement, because
        per-section gating would be a different consent flow and not a restyle.
      */}
          <Stack spacing={1.25} sx={{ mb: 2.5 }}>
            <Box
              sx={{
                p: 1.75,
                border: `1px solid ${qa.neutral[200]}`,
                borderRadius: `${qa.radius.md}px`,
              }}
            >
              <Typography variant="h3" sx={{ fontSize: '0.95rem', mb: 0.5 }}>
                {t('participant.consent.collectedTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('participant.consent.collectedBody')}
              </Typography>
            </Box>

            <Box
              sx={{
                p: 1.75,
                border: `1px solid ${qa.neutral[200]}`,
                borderRadius: `${qa.radius.md}px`,
              }}
            >
              <Typography variant="h3" sx={{ fontSize: '0.95rem', mb: 0.5 }}>
                {t('participant.consent.usedTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('participant.consent.usedBody')}
              </Typography>
            </Box>

            <Box
              sx={{
                p: 1.75,
                border: `1px solid ${qa.neutral[200]}`,
                borderRadius: `${qa.radius.md}px`,
              }}
            >
              <Typography variant="h3" sx={{ fontSize: '0.95rem', mb: 0.5 }}>
                {t('participant.consent.keptTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('participant.consent.keptBody')}
              </Typography>
            </Box>

            <Box
              sx={{
                p: 1.75,
                border: `1px solid ${qa.neutral[200]}`,
                borderRadius: `${qa.radius.md}px`,
              }}
            >
              <Typography variant="h3" sx={{ fontSize: '0.95rem', mb: 0.5 }}>
                {t('participant.consent.cannotTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('participant.consent.cannotBody')}
              </Typography>
            </Box>
          </Stack>

      {/*
        The prompt is a line of text, not an `Alert`. It is a standing instruction that is true
        every time this screen loads -- nothing has gone wrong when it shows -- and an Alert's
        icon and fill announce it as a problem.
      */}
      {!read && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ textAlign: 'center', mb: 1.5 }}
        >
          {t('participant.consent.readPrompt')}
        </Typography>
      )}

      <Stack spacing={1.5}>
        <Button variant="outlined" onClick={() => setRead(true)} disabled={read}>
          {read ? t('participant.consent.hasRead') : t('participant.consent.markRead')}
        </Button>
        <Button
          variant="contained"
          size="large"
          disabled={!read || busy}
          onClick={onAgree}
          fullWidth
        >
          {busy ? t('participant.consent.recording') : t('participant.consent.agree')}
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        {t('participant.consent.versionNote', { version: CONSENT_VERSION })}
      </Typography>
    </Box>
  );
}
