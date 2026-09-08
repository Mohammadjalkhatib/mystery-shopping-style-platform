import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import { useAuth } from '../auth/AuthContext.js';

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
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [v, t, p] = await Promise.all([api.venues(), api.tasks(), api.participants()]);
      setVenues(v);
      setTasks(t);
      setParticipants(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
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
    setError(e instanceof Error ? e.message : 'Something went wrong');
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
    <Stack spacing={3}>
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
        onCreated={(v) => {
          setVenues((prev) => [...prev, v].sort((a, b) => a.name.localeCompare(b.name)));
          announce(`Venue "${v.name}" created with a ${v.radiusM} m geofence.`);
        }}
        onError={fail}
      />

      <TaskForm
        venues={venues}
        onCreated={(t) => {
          setTasks((prev) => [t, ...prev]);
          announce(`Task "${t.title}" created at ${t.venueName}.`);
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
          announce(`Assigned to ${who}. Their visit is now waiting in the participant app.`);
        }}
        onError={fail}
      />

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h3" sx={{ fontSize: '1rem', mb: 1.5 }}>
          Tasks
        </Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Title</TableCell>
                <TableCell>Venue</TableCell>
                <TableCell align="right">Expected dwell</TableCell>
                <TableCell align="right">Assigned</TableCell>
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
                      No tasks yet. Create a venue, then a task against it.
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
  onCreated,
  onError,
}: {
  isAdmin: boolean;
  onCreated: (v: VenueRow) => void;
  onError: (e: unknown) => void;
}) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [coords, setCoords] = useState('');
  const [radiusM, setRadiusM] = useState('120');
  const [indoor, setIndoor] = useState(false);
  const [clientOrgId, setClientOrgId] = useState('');
  const [busy, setBusy] = useState(false);

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

  const submit = async (): Promise<void> => {
    if (!parsed) return;
    setBusy(true);
    try {
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
      setName('');
      setAddress('');
      setCoords('');
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const ready = name.length >= 2 && address.length >= 2 && parsed !== null && !busy;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h3" sx={{ fontSize: '1rem' }}>
        1 · New venue
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The geofence radius is per venue, never a global constant — a kiosk and a hypermarket
        cannot share one. 25 to 500 m.
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            fullWidth
            size="small"
          />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Coordinates"
            placeholder="31.957, 35.9137"
            helperText={
              coords && !parsed
                ? 'Expected "lat, lng"'
                : 'Right-click the spot in Google Maps and paste'
            }
            error={Boolean(coords) && !parsed}
            value={coords}
            onChange={(e) => setCoords(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label="Radius (m)"
            type="number"
            value={radiusM}
            onChange={(e) => setRadiusM(e.target.value)}
            size="small"
            sx={{ width: { xs: '100%', sm: 160 } }}
          />
        </Stack>
        {isAdmin && (
          <TextField
            label="Client org id"
            helperText="Admins have no organisation of their own, so this is required"
            value={clientOrgId}
            onChange={(e) => setClientOrgId(e.target.value)}
            size="small"
          />
        )}
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <FormControlLabel
            control={<Switch checked={indoor} onChange={(e) => setIndoor(e.target.checked)} />}
            label="Indoor"
          />
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
            Indoor venues legitimately report far worse accuracy, and the engine is told not to
            punish it.
          </Typography>
          <Button variant="contained" disabled={!ready} onClick={() => void submit()}>
            Create venue
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
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h3" sx={{ fontSize: '1rem' }}>
        2 · New task
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        A task belongs to the venue it is defined against, and inherits its organisation from it.
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label="Venue"
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
            size="small"
            fullWidth
            helperText={venues.length === 0 ? 'Create a venue first' : ' '}
            disabled={venues.length === 0}
          >
            {venues.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.name} · {v.radiusM} m {v.indoor ? '· indoor' : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Expected dwell (min)"
            type="number"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            size="small"
            sx={{ width: { xs: '100%', sm: 200 } }}
            helperText=" "
          />
        </Stack>
        <TextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          size="small"
          fullWidth
        />
        <TextField
          label="Brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          size="small"
          fullWidth
          multiline
          minRows={2}
          helperText="What the participant should actually do. They read this before starting."
        />
        <Box sx={{ textAlign: 'right' }}>
          <Button variant="contained" disabled={!ready} onClick={() => void submit()}>
            Create task
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
  const [taskId, setTaskId] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.createAssignment(taskId, participantId);
      onAssigned(
        taskId,
        participants.find((p) => p.id === participantId)?.displayName ?? participantId,
      );
      setParticipantId('');
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const ready = taskId !== '' && participantId !== '' && !busy;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h3" sx={{ fontSize: '1rem' }}>
        3 · Assign
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        This opens a pending visit for that participant straight away. The same participant
        cannot be given the same task twice.
      </Typography>
      <Divider sx={{ mb: 2 }} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'flex-start' }}>
        <TextField
          select
          label="Task"
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          size="small"
          fullWidth
          disabled={tasks.length === 0}
          helperText={tasks.length === 0 ? 'Create a task first' : ' '}
        >
          {tasks.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.title} · {t.venueName}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Participant"
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
          Assign
        </Button>
      </Stack>
    </Paper>
  );
}
