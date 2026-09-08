import {
  Box,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type GeocodeResult } from '../api/client.js';
import { useT } from '../i18n/LocaleContext.js';
import {
  clampZoom,
  decimalsForZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  panCentre,
  tilesForViewport,
} from './slippy.js';

/**
 * Long enough that typing a word does not fire a request per keystroke, short enough that it
 * still feels like search. Nominatim's limit is one request per second for the whole
 * application, so this is politeness with teeth.
 */
const SEARCH_DEBOUNCE_MS = 450;

const HEIGHT = 260;

/**
 * Pick a venue location on a map instead of typing coordinates.
 *
 * This is the structural fix for D-020. A typed coordinate can be imprecise (`31.98, 35.83`
 * put a venue 4.8 km from where the participant stood) or transposed; a coordinate taken from
 * a map is neither, because it is derived from where the pin is rather than from what someone
 * remembered. The precision guard stays as the backstop, but this removes the way in.
 *
 * **The pin is fixed at the centre and the map moves under it.** Deliberately, not for novelty:
 * a draggable pin needs click-versus-drag disambiguation, which is fiddly with a mouse and
 * genuinely bad with a thumb, and it puts the target under the finger that is covering it.
 *
 * No mapping library. Leaflet would give smoother inertia and pinch-zoom for ~150 KB and a
 * dependency; the projection maths it would replace is thirty lines and is separately tested
 * (`slippy.ts`). Worth revisiting if this ever needs markers, layers or clustering — see D-029.
 */
export function MapPicker({
  lat,
  lng,
  onPick,
}: {
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number) => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(16);
  const [centre, setCentre] = useState({ lat: lat ?? 31.9539, lng: lng ?? 35.9106 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Tiles are laid out in pixels, so the actual rendered width has to be known, not assumed.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * Follow the typed value, but only when it is genuinely elsewhere.
   *
   * Without the distance guard this fights the user: every pan emits a coordinate, the parent
   * echoes it back, and the map jumps to re-centre on the value it just produced.
   */
  useEffect(() => {
    if (lat === null || lng === null) return;
    if (Math.abs(lat - centre.lat) < 1e-6 && Math.abs(lng - centre.lng) < 1e-6) return;
    setCentre({ lat, lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  /**
   * Debounced search, with the in-flight request aborted when the query moves on.
   *
   * Both halves matter. The debounce keeps us inside Nominatim's one-request-per-second budget;
   * the abort stops a slow early request landing AFTER a fast later one and repainting the list
   * with results for a query the user has already replaced.
   */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults(null);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      api
        .geocode(q, controller.signal)
        .then((r) => setResults(r))
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          setResults(null);
          setSearchError(e instanceof Error ? e.message : 'search failed');
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const emit = useCallback(
    (c: { lat: number; lng: number }, z: number) => {
      const d = decimalsForZoom(z);
      onPick(Number(c.lat.toFixed(d)), Number(c.lng.toFixed(d)));
    },
    [onPick],
  );

  /**
   * Jump to a result, then hand the coordinate straight to the form.
   *
   * The zoom is chosen from what was found (`zoomForKind` on the server): dropping street level
   * on a whole country is as useless as showing a province for a coffee shop. The pin is still
   * draggable afterwards, because a geocoder puts you on the building, not the doorway.
   */
  const choose = (r: GeocodeResult): void => {
    const z = clampZoom(zoomFor(r.kind));
    setZoom(z);
    setCentre({ lat: r.lat, lng: r.lng });
    emit({ lat: r.lat, lng: r.lng }, z);
    setResults(null);
    setQuery(r.label.split(',')[0] ?? r.label);
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (dx === 0 && dy === 0) return;
    drag.current = { x: e.clientX, y: e.clientY };
    setCentre((c) => panCentre(c, zoom, dx, dy));
  };

  const onPointerUp = (e: React.PointerEvent): void => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    // Emitted on release, not on every move: a coordinate per pointermove would be a hundred
    // parent re-renders a second and a form that fights back.
    setCentre((c) => {
      emit(c, zoom);
      return c;
    });
  };

  const changeZoom = (delta: number): void => {
    setZoom((z) => {
      const next = clampZoom(z + delta);
      setCentre((c) => {
        emit(c, next);
        return c;
      });
      return next;
    });
  };

  const tiles = tilesForViewport(centre, zoom, width, HEIGHT);
  const decimals = decimalsForZoom(zoom);

  return (
    <Box>
      <Box sx={{ position: 'relative', mb: 1 }}>
        <TextField
          fullWidth
          size="small"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.venueForm.searchPlaceholder')}
          slotProps={{
            input: {
              endAdornment: searching ? <CircularProgress size={16} /> : undefined,
            },
          }}
        />

        {searchError && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
            {t('admin.venueForm.searchFailed')}
          </Typography>
        )}

        {results !== null && (
          <Paper
            variant="outlined"
            sx={{
              position: 'absolute',
              zIndex: 5,
              left: 0,
              right: 0,
              mt: 0.5,
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            {results.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
                {t('admin.venueForm.noResults')}
              </Typography>
            ) : (
              <List dense disablePadding>
                {results.map((r) => (
                  <ListItemButton key={`${r.lat},${r.lng},${r.label}`} onClick={() => choose(r)}>
                    {/*
                      `label` is text from a third party. React escapes it, and it was length
                      capped on the server -- it is rendered as text and never as markup.
                    */}
                    <ListItemText
                      primary={r.label}
                      secondary={r.kind}
                      slotProps={{ primary: { variant: 'body2' } }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Paper>
        )}
      </Box>

      <Box
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // `dir="ltr"` whatever the locale: a map is not text and does not mirror.
        dir="ltr"
        sx={{
          position: 'relative',
          height: HEIGHT,
          overflow: 'hidden',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: '#e8e6e1',
          cursor: 'grab',
          touchAction: 'none',
          userSelect: 'none',
          '&:active': { cursor: 'grabbing' },
        }}
      >
        {tiles.map((tile) => (
          <Box
            key={`${tile.z}/${tile.x}/${tile.y}`}
            component="img"
            src={`https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`}
            alt=""
            draggable={false}
            loading="lazy"
            sx={{
              position: 'absolute',
              left: tile.left,
              top: tile.top,
              width: 256,
              height: 256,
              pointerEvents: 'none',
            }}
          />
        ))}

        {/* The pin. Fixed at the centre; the map moves beneath it. */}
        <Box
          sx={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            fontSize: 30,
            lineHeight: 1,
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.45))',
          }}
        >
          📍
        </Box>

        <Stack sx={{ position: 'absolute', top: 8, right: 8, gap: 0.5 }}>
          <ZoomButton label="+" disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(1)} />
          <ZoomButton label="−" disabled={zoom <= MIN_ZOOM} onClick={() => changeZoom(-1)} />
        </Stack>

        {/* Required by the OpenStreetMap tile usage policy, not decoration. */}
        <Typography
          sx={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            fontSize: 10,
            px: 0.5,
            bgcolor: 'rgba(255,255,255,0.75)',
            color: 'rgba(0,0,0,0.7)',
          }}
        >
          © OpenStreetMap contributors
        </Typography>
      </Box>

      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: 1, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant="caption" color="text.secondary">
          {t('admin.venueForm.searchHint')}
        </Typography>
        <Typography
          variant="caption"
          sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
          dir="ltr"
        >
          {centre.lat.toFixed(decimals)}, {centre.lng.toFixed(decimals)}
        </Typography>
      </Stack>
    </Box>
  );
}

/**
 * Mirrors `zoomForKind` on the server.
 *
 * Duplicated deliberately and kept trivial: sending a zoom per result would put a presentation
 * decision in the API payload, and the alternative -- a shared package for four `if`s -- is not
 * worth a module boundary. If this grows past a handful of cases it belongs in `@msp/shared`.
 */
function zoomFor(kind: string): number {
  if (['country', 'state', 'region'].includes(kind)) return 7;
  if (['city', 'county', 'province', 'administrative'].includes(kind)) return 12;
  if (['suburb', 'neighbourhood', 'village', 'town'].includes(kind)) return 15;
  return 17;
}

function ZoomButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <IconButton
      size="small"
      disabled={disabled}
      // Stops the press from starting a drag on the map underneath.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      sx={{
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        width: 28,
        height: 28,
        fontSize: 16,
        '&:hover': { bgcolor: 'background.paper' },
      }}
    >
      {label}
    </IconButton>
  );
}
