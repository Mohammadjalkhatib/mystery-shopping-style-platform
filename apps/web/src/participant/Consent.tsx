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
    <Box sx={{ p: 2, maxWidth: 560, mx: 'auto' }}>
      <Typography variant="h1" sx={{ fontSize: '1.4rem', mb: 0.5 }}>
        {t('consentTitle')}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {venueName}
      </Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
                {t('consentCollectedTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('consentCollectedBody')}
              </Typography>
            </Box>

            <Box>
              <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
                {t('consentUsedTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('consentUsedBody')}
              </Typography>
            </Box>

            <Box>
              <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
                {t('consentKeptTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('consentKeptBody')}
              </Typography>
            </Box>

            <Box>
              <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
                {t('consentCannotTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('consentCannotBody')}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {!read && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('consentReadPrompt')}
        </Alert>
      )}

      <Stack spacing={1.5}>
        <Button variant="outlined" onClick={() => setRead(true)} disabled={read}>
          {read ? t('consentHasRead') : t('consentMarkRead')}
        </Button>
        <Button
          variant="contained"
          size="large"
          disabled={!read || busy}
          onClick={onAgree}
          fullWidth
        >
          {busy ? t('consentRecording') : t('consentAgree')}
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        {t('consentVersionNote', { version: CONSENT_VERSION })}
      </Typography>
    </Box>
  );
}
