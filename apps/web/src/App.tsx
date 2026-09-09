import { Box, CircularProgress } from '@mui/material';
import { AuthProvider, useAuth } from './auth/AuthContext.js';
import { Console } from './pages/Console.js';
import { Login } from './pages/Login.js';
import { ParticipantApp } from './participant/ParticipantApp.js';

/**
 * Routing by role rather than by URL.
 *
 * There are two surfaces and no overlap between them: a participant runs a visit and cannot
 * read the console, a business user reads the console and has no visit to run. A router with
 * paths would add URLs nobody can usefully share, since every screen is scoped to the signed
 * in user anyway.
 */
function Router() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!user) return <Login />;
  // Two surfaces, chosen by role. A participant has no permission to read the console and
  // a business user has no visit to run, so there is nothing to route between.
  if (user.role === 'participant') return <ParticipantApp />;
  return <Console />;
}

export function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
