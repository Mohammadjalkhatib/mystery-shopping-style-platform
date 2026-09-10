import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { useLocale } from '../i18n/LocaleContext.js';
import { useAuth } from '../auth/AuthContext.js';

/**
 * Sign in.
 *
 * The page used to list the seeded demo accounts and their shared password, so a reviewer
 * could click one to fill the form (D-008). That is gone (D-038): the credentials are still
 * in the README, where a reviewer looks anyway, and a sign-in screen that hands out a
 * password reads as a toy rather than as the product. The fields start empty for the same
 * reason -- a form arriving pre-filled with `business` / `demo1234` is the same advertisement
 * with the password behind dots.
 */
export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { t, toggle } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 460 }}>
        <CardContent sx={{ p: 3 }}>
          <Stack
            direction="row"
            sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5 }}
          >
            <Typography variant="h1" sx={{ fontSize: '1.5rem' }}>
              theQA Visits
            </Typography>
            {/*
              The toggle is here as well as on the visit screen: a participant who arrives with
              an Arabic browser meets this page first, and a sign-in form they cannot read is a
              poor place to discover the language exists.
            */}
            <Button size="small" onClick={toggle}>
              {t('common.language')}
            </Button>
          </Stack>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Location-verified field visits.
          </Typography>

          <form onSubmit={submit}>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label={t('auth.username')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                fullWidth
              />
              <TextField
                label={t('auth.password')}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                fullWidth
              />
              <Button type="submit" variant="contained" size="large" disabled={busy}>
                {busy ? t('auth.signingIn') : t('auth.signIn')}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
}
