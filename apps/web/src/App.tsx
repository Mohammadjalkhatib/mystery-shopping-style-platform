import { Alert, Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { VERDICTS } from '@msp/shared';
import { verdictPalette } from './theme/theme';

const API = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

/**
 * Scaffold screen only. Exists to prove the toolchain end to end: MUI theme applied,
 * @msp/shared resolving across the workspace, and the API reachable through CORS.
 * feat/participant-flow replaces this entirely.
 */
export function App() {
  const [health, setHealth] = useState<string>('checking...');

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json())
      .then((d) => setHealth(`${d.status} (mongo: ${d.mongo})`))
      .catch(() => setHealth('unreachable'));
  }, []);

  return (
    <Box sx={{ p: 3, maxWidth: 640, mx: 'auto' }}>
      <Typography variant="h1" gutterBottom>
        theQA Visits
      </Typography>
      <Alert severity="info" sx={{ mb: 3 }}>
        Scaffold only. No features yet.
      </Alert>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h3" gutterBottom>
            API health
          </Typography>
          <Typography color="text.secondary">{health}</Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3" gutterBottom>
            Verdicts
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Deliberately not green/red. See D-001.
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {VERDICTS.map((v) => (
              <Chip
                key={v}
                label={v}
                sx={{
                  bgcolor: verdictPalette[v].main,
                  color: verdictPalette[v].contrastText,
                }}
              />
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
