import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type OrgRow, type UserRow } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.js';
import { useT } from '../i18n/LocaleContext.js';

/**
 * Accounts: an admin creates business accounts, a business creates its own participants.
 *
 * Named "Accounts" and not "People" because `People.tsx` already exists and answers a
 * completely different question -- results per participant, worst pass rate first. Merging
 * the two would put "who needs looking at" and "who can sign in" on one screen, and they are
 * read by different people at different times.
 *
 * The screen only ever offers what the caller may actually do. A business sees one form, for
 * a participant in its own organisation, with no organisation picker at all -- because it has
 * no choice to make, and rendering a disabled control for a decision that does not exist is
 * just noise. The server refuses the rest regardless (D-037); this is the UI agreeing with it
 * rather than the UI enforcing it.
 */
export function AccountsTab() {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [orgOpen, setOrgOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [o, u] = await Promise.all([api.orgs(), api.users()]);
      setOrgs(o);
      setUsers(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const orgName = useCallback(
    (id: string | null): string => orgs?.find((o) => o.id === id)?.name ?? id ?? '—',
    [orgs],
  );

  /** Grouped by organisation, because that is the boundary everything else in here respects. */
  const grouped = useMemo(() => {
    if (!users) return [];
    const by = new Map<string, UserRow[]>();
    for (const u of users) {
      const key = u.clientOrgId ?? '';
      by.set(key, [...(by.get(key) ?? []), u]);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [users]);

  const toggleActive = async (row: UserRow): Promise<void> => {
    try {
      await api.setUserActive(row.id, !row.active);
      setToast(
        row.active
          ? t('console.accounts.deactivated', { name: row.displayName })
          : t('console.accounts.reactivated', { name: row.displayName }),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading && !users) {
    return (
      <Box sx={{ p: 6, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={{ xs: 2, sm: 3 }}>
      <Box>
        <Typography variant="h6">{t('console.accounts.title')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {isAdmin ? t('console.accounts.subtitleAdmin') : t('console.accounts.subtitleBusiness')}
        </Typography>
      </Box>

      {/*
        Said once, plainly, at the top. Every account created here gets the same password, and
        somebody will otherwise assume an email went out. There is no mail transport in this
        build and no reset flow, so this is the only place a new user's password is stated.
      */}
      <Alert severity="info">{t('console.accounts.passwordNotice')}</Alert>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {isAdmin && (
          <Button variant="contained" onClick={() => setOrgOpen(true)}>
            {t('console.accounts.newBusiness')}
          </Button>
        )}
        <Button variant={isAdmin ? 'outlined' : 'contained'} onClick={() => setUserOpen(true)}>
          {isAdmin ? t('console.accounts.newUser') : t('console.accounts.newParticipant')}
        </Button>
      </Stack>

      {grouped.map(([orgId, rows]) => (
        <Paper key={orgId || 'platform'} variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1.5 }}>
            <Typography variant="subtitle2">
              {orgId ? orgName(orgId) : t('console.accounts.platform')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {orgId || t('console.accounts.noOrg')}
            </Typography>
          </Box>
          <Divider />
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('console.accounts.name')}</TableCell>
                  <TableCell>{t('console.accounts.username')}</TableCell>
                  <TableCell>{t('console.accounts.role')}</TableCell>
                  <TableCell align="right">{t('console.accounts.active')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} sx={{ opacity: r.active ? 1 : 0.55 }}>
                    <TableCell>{r.displayName}</TableCell>
                    <TableCell>
                      <code>{r.username}</code>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={t(`console.accounts.role_${r.role}` as never)}
                        color={r.role === 'admin' ? 'secondary' : 'default'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      {/*
                        Your own row has no switch. Deactivating yourself is the one mistake
                        here with no way back through the product -- the account that could
                        undo it is the one just switched off -- and the server refuses it too.
                      */}
                      {r.id === user?.id ? (
                        <Typography variant="caption" color="text.secondary">
                          {t('console.accounts.you')}
                        </Typography>
                      ) : (
                        <Tooltip
                          title={
                            r.active
                              ? t('console.accounts.deactivateHint')
                              : t('console.accounts.reactivateHint')
                          }
                        >
                          <Switch
                            size="small"
                            checked={r.active}
                            onChange={() => void toggleActive(r)}
                            slotProps={{ input: { 'aria-label': r.username } }}
                          />
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      ))}

      {isAdmin && (
        <NewBusinessDialog
          open={orgOpen}
          onClose={() => setOrgOpen(false)}
          onDone={async (name) => {
            setOrgOpen(false);
            setToast(t('console.accounts.businessCreated', { name }));
            await load();
          }}
        />
      )}

      <NewUserDialog
        open={userOpen}
        isAdmin={isAdmin}
        orgs={orgs ?? []}
        onClose={() => setUserOpen(false)}
        onDone={async (name) => {
          setUserOpen(false);
          setToast(t('console.accounts.userCreated', { name }));
          await load();
        }}
      />

      <Snackbar
        open={toast !== null}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setToast(null)} variant="filled">
          {toast}
        </Alert>
      </Snackbar>
    </Stack>
  );
}

/* -------------------------------------------------------------------------- */

function NewBusinessDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (name: string) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True once the user edits the slug, after which the name stops driving it. */
  const [slugTouched, setSlugTouched] = useState(false);

  const reset = (): void => {
    setName('');
    setSlug('');
    setUsername('');
    setDisplayName('');
    setSlugTouched(false);
    setError(null);
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.createOrg({
        name: name.trim(),
        slug: slug.trim(),
        businessUsername: username.trim().toLowerCase(),
        businessDisplayName: displayName.trim() || name.trim(),
      });
      reset();
      await onDone(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('console.accounts.newBusiness')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('console.accounts.newBusinessHint')}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('console.accounts.orgName')}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              // The slug follows the name until somebody edits it themselves. It ends up
              // inside the organisation id, which is permanent, so it is shown rather than
              // generated invisibly.
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            fullWidth
            autoFocus
          />
          <TextField
            label={t('console.accounts.orgSlug')}
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            helperText={t('console.accounts.orgSlugHint', { id: slug ? `org-${slug}` : 'org-…' })}
            fullWidth
          />
          <Divider />
          <TextField
            label={t('console.accounts.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            helperText={t('console.accounts.usernameHint')}
            fullWidth
          />
          <TextField
            label={t('console.accounts.name')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={busy || !name.trim() || !slug.trim() || username.trim().length < 3}
        >
          {t('console.accounts.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function NewUserDialog({
  open,
  isAdmin,
  orgs,
  onClose,
  onDone,
}: {
  open: boolean;
  isAdmin: boolean;
  orgs: OrgRow[];
  onClose: () => void;
  onDone: (name: string) => Promise<void>;
}) {
  const t = useT();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'participant' | 'business'>('participant');
  const [orgId, setOrgId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.createUser({
        username: username.trim().toLowerCase(),
        displayName: displayName.trim() || username.trim(),
        role,
        // Sent only by an admin. A business user has no organisation to choose, and a body
        // field that disagreed with their token would be refused by the server anyway (D-017).
        ...(isAdmin ? { clientOrgId: orgId } : {}),
      });
      setUsername('');
      setDisplayName('');
      setError(null);
      await onDone(displayName.trim() || username.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {isAdmin ? t('console.accounts.newUser') : t('console.accounts.newParticipant')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('console.accounts.username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            helperText={t('console.accounts.usernameHint')}
            fullWidth
            autoFocus
          />
          <TextField
            label={t('console.accounts.name')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            fullWidth
          />
          {isAdmin && (
            <>
              <TextField
                select
                label={t('console.accounts.role')}
                value={role}
                onChange={(e) => setRole(e.target.value as 'participant' | 'business')}
                fullWidth
              >
                <MenuItem value="participant">{t('console.accounts.role_participant')}</MenuItem>
                <MenuItem value="business">{t('console.accounts.role_business')}</MenuItem>
              </TextField>
              <TextField
                select
                label={t('console.accounts.org')}
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                helperText={t('console.accounts.orgRequiredHint')}
                fullWidth
              >
                {orgs.map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.name}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={busy || username.trim().length < 3 || (isAdmin && !orgId)}
        >
          {t('console.accounts.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Name to slug. Kept in step with the server's `^[a-z0-9]+(-[a-z0-9]+)*$`, and only ever a
 * suggestion -- the field stays editable and the server is the one that decides.
 */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
