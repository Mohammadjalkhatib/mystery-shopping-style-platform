import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { useState } from 'react';

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

  return (
    <Box sx={{ p: 2, maxWidth: 560, mx: 'auto' }}>
      <Typography variant="h1" sx={{ fontSize: '1.4rem', mb: 0.5 }}>
        Before you start
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {venueName}
      </Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
                What is collected
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Your device&apos;s location, sampled while this page is open and in front of
                you, from the moment you start the visit until you end it. Nothing is collected
                before you start or after you end.
              </Typography>
            </Box>

            <Box>
              <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
                What it is used for
              </Typography>
              <Typography variant="body2" color="text.secondary">
                To judge how well the evidence supports the visit having happened. It produces
                a score and a list of reasons — never a simple yes or no, and never proof that
                you were somewhere. A human reviews anything uncertain.
              </Typography>
            </Box>

            <Box>
              <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
                How long it is kept
              </Typography>
              <Typography variant="body2" color="text.secondary">
                The raw location trail is deleted automatically after the retention window,
                by the database itself rather than by a job someone has to remember to run.
                The summary of the visit is kept.
              </Typography>
            </Box>

            <Box>
              <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
                What this app cannot do
              </Typography>
              <Typography variant="body2" color="text.secondary">
                It cannot follow you in the background. If you lock your phone or switch apps,
                it stops receiving your location, and the gap is recorded as a gap. You can end
                the visit at any time.
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {!read && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Please read the four sections above before agreeing.
        </Alert>
      )}

      <Stack spacing={1.5}>
        <Button variant="outlined" onClick={() => setRead(true)} disabled={read}>
          {read ? 'Read ✓' : 'I have read this'}
        </Button>
        <Button
          variant="contained"
          size="large"
          disabled={!read || busy}
          onClick={onAgree}
          fullWidth
        >
          {busy ? 'Recording…' : 'I agree — continue'}
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        Consent version {CONSENT_VERSION}. Your agreement is recorded with a server timestamp.
      </Typography>
    </Box>
  );
}
