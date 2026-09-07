import { Alert, Box, CircularProgress, Container, Typography } from '@mui/material';
import { AuthProvider, useAuth } from './auth/AuthContext.js';
import { Console } from './pages/Console.js';
import { Login } from './pages/Login.js';

/**
 * Routing by role rather than by URL, for now.
 *
 * The participant app is a separate surface and is not built yet (feat/participant-flow), so
 * a participant signing in is told so plainly instead of being dropped into a console they
 * have no permission to read.
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
  if (user.role === 'participant') {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Typography variant="h1" sx={{ fontSize: '1.5rem', mb: 2 }}>
          Hello, {user.displayName}
        </Typography>
        <Alert severity="info">
          The participant visit screen is not built yet. Sign in as <code>business</code> to see
          the visit console.
        </Alert>
      </Container>
    );
  }
  return <Console />;
}

export function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
