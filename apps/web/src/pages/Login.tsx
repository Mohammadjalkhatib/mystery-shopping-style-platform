import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useLocale } from '../i18n/LocaleContext.js';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';

/**
 * Demo login.
 *
 * The demo accounts are listed on the page on purpose (D-008): this is a demo build with
 * public credentials, and a reviewer should not have to read source to get in. Clicking one
 * fills the form rather than signing in directly, so it stays obvious what is being sent.
 *
 * The list is now held HERE rather than fetched. It used to come from
 * `GET /auth/demo-credentials`, which was unauthenticated and enumerated every account --
 * fine when the roster was a fixed array of twelve fakes, and an open directory of every
 * account on the platform once a business can create its own staff. The endpoint is gone
 * (D-037), so these three names are hard-coded: they are the seeded demo accounts, they are
 * already published in the README, and an account created through the console is deliberately
 * not advertised here.
 */

/** The seeded roster, from apps/api/src/auth/demo-users.ts. */
const DEMO_PASSWORD = 'demo1234';
const DEMO_ACCOUNTS: { username: string; role: string }[] = [
  { username: 'admin', role: 'admin' },
  { username: 'business', role: 'business' },
  { username: 'user1', role: 'participant' },
];
export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('business');
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const { t, toggle } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const accounts = DEMO_ACCOUNTS;

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

          {accounts.length > 0 && (
            <>
              <Divider sx={{ my: 3 }}>{t('auth.demoAccounts')}</Divider>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {t('auth.demoPasswordFor')} <code>demo1234</code>
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {accounts.map((a) => (
                  <Button
                    key={a.username}
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      setUsername(a.username);
                      setPassword(DEMO_PASSWORD);
                    }}
                  >
                    {a.username}
                    <Typography component="span" variant="caption" sx={{ ml: 0.75, opacity: 0.7 }}>
                      {a.role}
                    </Typography>
                  </Button>
                ))}
              </Stack>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
