import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ParticipantRow,
  type TaskRow,
  type VenueRow,
} from '../api/client.js';
import { MapPicker } from '../components/MapPicker.js';
import { useAuth } from '../auth/AuthContext.js';
import { useT } from '../i18n/LocaleContext.js';

/**
 * Authoring: create a venue, define a task against it, assign it to a participant.
 *
 * This is the surface that replaces `npm run db:seed` as the only way work enters the system.
 * It is deliberately three plain forms rather than a wizard -- the three objects have a strict
 * order (a task needs a venue, an assignment needs a task) and showing all three at once makes
 * that dependency visible instead of hiding it behind steps.
 *
 * Assigning is what actually produces a visit: the server opens a `pending` session in the
 * same transaction (D-018), so the participant sees it the next time they open the app.
 */
export function TasksTab() {
  const { user } = useAuth();
  const t = useT();
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  /** The venue currently being corrected, or null when the form is creating a new one. */
  const [editing, setEditing] = useState<VenueRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [v, t, p] = await Promise.all([api.venues(), api.tasks(), api.participants()]);
      setVenues(v);
      setTasks(t);
      setParticipants(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.failedToLoad'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const announce = (message: string): void => {
    setOk(message);
    setError(null);
  };
  const fail = (e: unknown): void => {
    setError(e instanceof Error ? e.message : t('common.somethingWentWrong'));
    setOk(null);
  };

  if (loading) {
    return (
      <Box sx={{ p: 6, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={{ xs: 2, sm: 3 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {ok && (
        <Alert severity="success" onClose={() => setOk(null)}>
          {ok}
        </Alert>
      )}

      <VenueForm
        isAdmin={user?.role === 'admin'}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onCreated={(v) => {
          setVenues((prev) => [...prev, v].sort((a, b) => a.name.localeCompare(b.name)));
          announce(t('admin.venueForm.created', { name: v.name, radius: v.radiusM }));
        }}
        onUpdated={(v) => {
          setVenues((prev) =>
            prev.map((x) => (x.id === v.id ? v : x)).sort((a, b) => a.name.localeCompare(b.name)),
          );
          setEditing(null);
          announce(
            t('admin.venueForm.updated', {
              name: v.name,
              lat: v.lat,
              lng: v.lng,
              radius: v.radiusM,
            }),
          );
        }}
        onError={fail}
      />

      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Typography variant="h3" sx={{ fontSize: '1rem', mb: 0.5 }}>
          {t('admin.venueList.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('admin.venueList.explain')}
        </Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.venueList.name')}</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                  {t('admin.venueList.coordinates')}
                </TableCell>
                <TableCell align="right">{t('admin.venueList.fence')}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {venues.map((v) => (
                <TableRow key={v.id} selected={editing?.id === v.id}>
                  <TableCell>
                    {v.name}
                    {v.indoor && (
                      <Chip size="small" variant="outlined" label={t('admin.venueForm.indoor')} sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  {/* The widest column and the least scannable; it survives on a tablet up. */}
                  <TableCell
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      display: { xs: 'none', sm: 'table-cell' },
                    }}
                  >
                    {v.lat}, {v.lng}
                  </TableCell>
                  <TableCell align="right">{v.radiusM} m</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setEditing(v)}>
                      {t('admin.venueList.edit')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {venues.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      {t('admin.venueList.empty')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>

      <TaskForm
        venues={venues}
        // `nt`, not `t`: the translator is `t` in this scope now.
        onCreated={(nt) => {
          setTasks((prev) => [nt, ...prev]);
          announce(t('admin.taskForm.created', { title: nt.title, venue: nt.venueName }));
        }}
        onError={fail}
      />

      <AssignForm
        tasks={tasks}
        participants={participants}
        onAssigned={(taskId, who) => {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskId ? { ...t, assignmentCount: t.assignmentCount + 1 } : t,
            ),
          );
          announce(t('admin.assignForm.assigned', { who }));
        }}
        onError={fail}
      />

      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Typography variant="h3" sx={{ fontSize: '1rem', mb: 1.5 }}>
          {t('admin.taskList.title')}
        </Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.taskList.titleCol')}</TableCell>
                <TableCell>{t('admin.taskList.venue')}</TableCell>
                <TableCell align="right">{t('admin.taskList.dwell')}</TableCell>
                <TableCell align="right">{t('admin.taskList.assigned')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.title}</TableCell>
                  <TableCell>{t.venueName}</TableCell>
                  <TableCell align="right">{Math.round(t.expectedDwellSeconds / 60)} min</TableCell>
                  <TableCell align="right">
                    <Chip size="small" variant="outlined" label={t.assignmentCount} />
                  </TableCell>
                </TableRow>
              ))}
              {tasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      {t('admin.taskList.empty')}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>
    </Stack>
  );
}

/* ----------------------------------------------------------------- venue */

function VenueForm({
  isAdmin,
  editing,
  onCancelEdit,
  onCreated,
  onUpdated,
  onError,
}: {
  isAdmin: boolean;
  editing: VenueRow | null;
  onCancelEdit: () => void;
  onCreated: (v: VenueRow) => void;
  onUpdated: (v: VenueRow) => void;
  onError: (e: unknown) => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState('');
  const [radiusM, setRadiusM] = useState('120');
  const [indoor, setIndoor] = useState(false);
  const [clientOrgId, setClientOrgId] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * The map is the default way in, and typing is the escape hatch.
   *
   * A coordinate taken from a pin cannot be imprecise or transposed, which is the entire class
   * of failure behind D-020. Typing stays available because pasting a known-good pair is still
   * the fastest path when you already have one.
   */
  const [mode, setMode] = useState<'map' | 'type'>('map');

  /**
   * Load the venue being corrected into the form.
   *
   * Keyed on the id rather than the object so that re-fetching the list does not stamp over
   * whatever the user has half-typed.
   */
  useEffect(() => {
    if (!editing) return;
    setName(editing.name);
    setAddress(editing.address);
    setCoords(`${editing.lat}, ${editing.lng}`);
    setRadiusM(String(editing.radiusM));
    setIndoor(editing.indoor);
  }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * One "lat, lng" field rather than two.
   *
   * This is what Google Maps puts on the clipboard when you right-click a spot, so the common
   * case is a paste with nothing to retype and nothing to transpose. Two boxes invite exactly
   * the axis-swap the GeoPoint schema exists to catch.
   */
  const parsed = ((): { lat: number; lng: number } | null => {
    const m = coords.split(',').map((x) => Number(x.trim()));
    if (m.length !== 2 || !m.every((n) => Number.isFinite(n))) return null;
    const [lat, lng] = m as [number, number];
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  })();

  /**
   * A share link is not a coordinate.
   *
   * `https://maps.app.goo.gl/...` cannot be resolved from here -- it needs a redirect the
   * browser will not let us follow -- so the only useful thing is to say what to do instead.
   * This is the mistake that actually happened: the link went in the address field and
   * approximate numbers went in here.
   */
  const looksLikeLink = /https?:\/\/|goo\.gl|maps\.app|google\.[a-z]+\/maps/i.test(coords);

  /**
   * How many decimal places the coarser half carries.
   *
   * Deliberately NOT a copy of the server's rule, which scales the requirement against the
   * radius. Duplicating that here would be a second copy of a threshold, free to drift; the
   * server stays the authority and returns a message naming both numbers. This is only an
   * early nudge, because four decimals is the answer at every radius the schema permits.
   */
  const decimalsGiven = parsed
    ? Math.min(
        ...coords.split(',').map((x) => {
          const frac = x.trim().split('.')[1];
          return frac ? frac.length : 0;
        }),
      )
    : null;
  const coarse = decimalsGiven !== null && decimalsGiven < 4;

  const clear = (): void => {
    setName('');
    setAddress('');
    setCoords('');
  };

  const submit = async (): Promise<void> => {
    if (!parsed) return;
    setBusy(true);
    try {
      if (editing) {
        // PATCH: send everything the form holds. The server changes only what differs and
        // re-checks precision against the RESULTING coordinate and radius, so tightening the
        // fence alone can legitimately fail here.
        const v = await api.updateVenue(editing.id, {
          name,
          address,
          lat: parsed.lat,
          lng: parsed.lng,
          radiusM: Number(radiusM),
          indoor,
        });
        onUpdated(v);
        clear();
      } else {
        const v = await api.createVenue({
          name,
          address,
          lat: parsed.lat,
          lng: parsed.lng,
          radiusM: Number(radiusM),
          indoor,
          ...(isAdmin && clientOrgId ? { clientOrgId } : {}),
        });
        onCreated(v);
        clear();
      }
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const ready = name.length >= 2 && address.length >= 2 && parsed !== null && !coarse && !looksLikeLink && !busy;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Typography variant="h3" sx={{ fontSize: '1rem' }}>
        {editing
          ? t('admin.venueForm.editTitle', { name: editing.name })
          : t('admin.venueForm.stepTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('admin.venueForm.explain')}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label={t('admin.venueForm.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label={t('admin.venueForm.address')}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            fullWidth
            size="small"
          />
        </Stack>
        <Box>
          <Stack
            direction="row"
            spacing={1}
            sx={{ mb: 1, alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t('admin.venueForm.coordinates')}
            </Typography>
            <Button size="small" onClick={() => setMode(mode === 'map' ? 'type' : 'map')}>
              {mode === 'map' ? t('admin.venueForm.useTyping') : t('admin.venueForm.useMap')}
            </Button>
          </Stack>
          {mode === 'map' && (
            <MapPicker
              lat={parsed?.lat ?? null}
              lng={parsed?.lng ?? null}
              onPick={(la, ln) => setCoords(`${la}, ${ln}`)}
            />
          )}
        </Box>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ display: mode === 'type' ? 'flex' : 'none' }}
        >
          <TextField
            label={t('admin.venueForm.coordinates')}
            placeholder={t('admin.venueForm.coordinatesPlaceholder')}
            helperText={
              looksLikeLink
                ? t('admin.venueForm.coordinatesLink')
                : coords && !parsed
                  ? t('admin.venueForm.coordinatesExpected')
                  : coarse
                    ? t('admin.venueForm.coordinatesCoarse', { count: decimalsGiven ?? 0 })
                    : t('admin.venueForm.coordinatesHelp')
            }
            error={Boolean(coords) && (!parsed || looksLikeLink || coarse)}
            value={coords}
            onChange={(e) => setCoords(e.target.value)}
            fullWidth
            size="small"
          />
        </Stack>

        {/*
          Radius lives OUTSIDE the coordinates row: it applies in both modes, and leaving it
          inside meant switching to the map hid the geofence field entirely.
        */}
        <TextField
          label={t('admin.venueForm.radius')}
          type="number"
          value={radiusM}
          onChange={(e) => setRadiusM(e.target.value)}
          size="small"
          sx={{ width: { xs: '100%', sm: 200 } }}
        />
        {isAdmin && (
          <TextField
            label={t('admin.venueForm.clientOrgId')}
            helperText={t('admin.venueForm.clientOrgIdHelp')}
            value={clientOrgId}
            onChange={(e) => setClientOrgId(e.target.value)}
            size="small"
          />
        )}
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <FormControlLabel
            control={<Switch checked={indoor} onChange={(e) => setIndoor(e.target.checked)} />}
            label={t('admin.venueForm.indoor')}
          />
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {t('admin.venueForm.indoorExplain')}
          </Typography>
          {editing && (
            <Button
              onClick={() => {
                clear();
                onCancelEdit();
              }}
            >
              {t('common.cancel')}
            </Button>
          )}
          <Button variant="contained" disabled={!ready} onClick={() => void submit()}>
            {editing ? t('admin.venueForm.save') : t('admin.venueForm.create')}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

/* ------------------------------------------------------------------ task */

function TaskForm({
  venues,
  onCreated,
  onError,
}: {
  venues: VenueRow[];
  onCreated: (t: TaskRow) => void;
  onError: (e: unknown) => void;
}) {
  const t = useT();
  const [venueId, setVenueId] = useState('');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [minutes, setMinutes] = useState('5');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const t = await api.createTask({
        venueId,
        title,
        brief,
        expectedDwellSeconds: Math.round(Number(minutes) * 60),
      });
      onCreated(t);
      setTitle('');
      setBrief('');
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const ready = venueId !== '' && title.length >= 3 && brief.length >= 10 && !busy;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Typography variant="h3" sx={{ fontSize: '1rem' }}>
        {t('admin.taskForm.stepTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('admin.taskForm.explain')}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label={t('admin.taskForm.venue')}
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
            size="small"
            fullWidth
            helperText={venues.length === 0 ? t('admin.taskForm.venueFirst') : ' '}
            disabled={venues.length === 0}
          >
            {venues.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.name} · {v.radiusM} m {v.indoor ? '· indoor' : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('admin.taskForm.dwell')}
            type="number"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            size="small"
            sx={{ width: { xs: '100%', sm: 200 } }}
            helperText=" "
          />
        </Stack>
        <TextField
          label={t('admin.taskForm.title')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          size="small"
          fullWidth
        />
        <TextField
          label={t('admin.taskForm.brief')}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          size="small"
          fullWidth
          multiline
          minRows={2}
          helperText={t('admin.taskForm.briefHelp')}
        />
        <Box sx={{ textAlign: 'right' }}>
          <Button variant="contained" disabled={!ready} onClick={() => void submit()}>
            {t('admin.taskForm.create')}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

/* ------------------------------------------------------------ assignment */

function AssignForm({
  tasks,
  participants,
  onAssigned,
  onError,
}: {
  tasks: TaskRow[];
  participants: ParticipantRow[];
  onAssigned: (taskId: string, who: string) => void;
  onError: (e: unknown) => void;
}) {
  const t = useT();
  const [taskId, setTaskId] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * The confirmation, held here rather than announced only at the top of the page.
   *
   * The banner is still written -- it belongs in the page's running log of what has been
   * created -- but on a phone the form is below the fold by the time it is filled in, so the
   * banner appears somewhere the person who pressed the button is not looking. Assigning work
   * to a real person is the one action on this screen with a consequence outside the screen,
   * and it was the one giving the weakest acknowledgement. A dialog cannot be missed at any
   * viewport, and it also has somewhere to say what the participant will now see.
   */
  const [confirmed, setConfirmed] = useState<{ who: string; venue: string } | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const task = tasks.find((x) => x.id === taskId);
      const who = participants.find((p) => p.id === participantId)?.displayName ?? participantId;
      await api.createAssignment(taskId, participantId);
      onAssigned(taskId, who);
      setConfirmed({ who, venue: task?.venueName ?? '' });
      setParticipantId('');
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const ready = taskId !== '' && participantId !== '' && !busy;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Typography variant="h3" sx={{ fontSize: '1rem' }}>
        {t('admin.assignForm.stepTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('admin.assignForm.explain')}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
        <TextField
          select
          label={t('admin.assignForm.task')}
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          size="small"
          fullWidth
          disabled={tasks.length === 0}
          helperText={tasks.length === 0 ? t('admin.assignForm.taskFirst') : ' '}
        >
          {tasks.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.title} · {t.venueName}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t('admin.assignForm.participant')}
          value={participantId}
          onChange={(e) => setParticipantId(e.target.value)}
          size="small"
          fullWidth
          helperText=" "
        >
          {participants.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.displayName} · {p.id}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" disabled={!ready} onClick={() => void submit()} sx={{ mt: 0.5 }}>
          {t('admin.assignForm.assign')}
        </Button>
      </Stack>

      {/*
        `fullWidth` with `xs` max width so it is a readable card on a laptop and close to full
        bleed on a phone, which is where the banner it replaces was invisible.
      */}
      <Dialog
        open={confirmed !== null}
        onClose={() => setConfirmed(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{t('admin.assignForm.dialogTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('admin.assignForm.dialogBody', {
              who: confirmed?.who ?? '',
              venue: confirmed?.venue ?? '',
            })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          {/*
            Two ways out, because there are two things a person does next and neither should
            need a second thought: assign the next one, or stop. "Assign another" leaves the
            task selected and the participant cleared, which is the state `submit` already put
            the form in.
          */}
          <Button onClick={() => setConfirmed(null)}>
            {t('admin.assignForm.dialogAgain')}
          </Button>
          <Button variant="contained" onClick={() => setConfirmed(null)} autoFocus>
            {t('admin.assignForm.dialogClose')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
