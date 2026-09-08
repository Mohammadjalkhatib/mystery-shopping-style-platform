import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { useT } from '../i18n/LocaleContext.js';

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
      <Typography variant="h1" sx={{ fontSize: '1.4rem', mb: 0.5 }}>
        {t('participant.consent.title')}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {venueName}
      </Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
                {t('participant.consent.collectedTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('participant.consent.collectedBody')}
              </Typography>
            </Box>

            <Box>
              <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
                {t('participant.consent.usedTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('participant.consent.usedBody')}
              </Typography>
            </Box>

            <Box>
              <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
                {t('participant.consent.keptTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('participant.consent.keptBody')}
              </Typography>
            </Box>

            <Box>
              <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
                {t('participant.consent.cannotTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('participant.consent.cannotBody')}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {!read && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('participant.consent.readPrompt')}
        </Alert>
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
