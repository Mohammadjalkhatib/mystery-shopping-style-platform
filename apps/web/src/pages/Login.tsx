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
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';

/**
 * Demo login.
 *
 * The accounts are listed on the page on purpose (D-008): this is a demo build with public
 * credentials, and a reviewer should not have to read source to get in. Clicking one fills
 * the form rather than logging straight in, so it is still obvious what is being sent.
 */
export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('business');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<{ username: string; role: string }[]>([]);

  useEffect(() => {
    api
      .demoCredentials()
      .then((d) => setAccounts(d.accounts))
      .catch(() => setAccounts([]));
  }, []);

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
          <Typography variant="h1" sx={{ fontSize: '1.5rem', mb: 0.5 }}>
            theQA Visits
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Location-verified field visits.
          </Typography>

          <form onSubmit={submit}>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                fullWidth
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                fullWidth
              />
              <Button type="submit" variant="contained" size="large" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </Stack>
          </form>

          {accounts.length > 0 && (
            <>
              <Divider sx={{ my: 3 }}>Demo accounts</Divider>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Password for all: <code>demo1234</code>
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {accounts.map((a) => (
                  <Button
                    key={a.username}
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      setUsername(a.username);
                      setPassword('demo1234');
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
