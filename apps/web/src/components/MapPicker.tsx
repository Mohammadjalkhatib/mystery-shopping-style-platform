import MyLocationIcon from '@mui/icons-material/MyLocation';
import {
  Box,
  Button,
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
  latToTileY,
  lngToTileX,
  MAX_ZOOM,
  metresPerPixel,
  MIN_ZOOM,
  panCentre,
  TILE_SIZE,
  tilesForViewport,
  zoomForAccuracy,
} from './slippy.js';

/**
 * Long enough that typing a word does not fire a request per keystroke, short enough that it
 * still feels like search. Nominatim's limit is one request per second for the whole
 * application, so this is politeness with teeth.
 */
const SEARCH_DEBOUNCE_MS = 450;

const HEIGHT = 260;

/**
 * How long to wait for a fix before giving up.
 *
 * Longer than the 20 s the visit tracker allows, because the cost of waiting is different:
 * there a slow fix is one missing sample in a long trace, here it is the only answer the user
 * asked for, and a receiver indoors routinely takes half a minute to settle.
 */
const LOCATE_TIMEOUT_MS = 30_000;

/**
 * Above this, the fix is shown with a warning rather than presented as the answer.
 *
 * 100 m is the accuracy ceiling the verification engine already treats as unusable, reused
 * deliberately: a fix too coarse to prove a participant stood somewhere is too coarse to define
 * where that somewhere is.
 */
const COARSE_ACCURACY_M = 100;

type LocateState =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'located'; lat: number; lng: number; accuracyM: number }
  | { kind: 'denied' }
  | { kind: 'unavailable' };

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
 * "Use my location" is the third way in, alongside search and dragging, and it is the fast path
 * for the common case: someone standing in the venue they are adding. It is deliberately not a
 * shortcut PAST the pin. The fix recentres the map, draws its own accuracy as a circle, and
 * leaves the user to confirm by looking -- because a browser fix ranges from 5 m to several
 * kilometres and only the bottom of that range is a venue coordinate. See D-049.
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
  const [locate, setLocate] = useState<LocateState>({ kind: 'idle' });

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
   * Centre the map on the device's own fix.
   *
   * `getCurrentPosition`, not `watchPosition`: this answers a question once, and a watch would
   * keep yanking the map out from under someone who has started fine-tuning the pin.
   *
   * The zoom comes from the reported accuracy rather than being fixed, so a 3 km IP-derived fix
   * lands showing a whole district and a 6 m GPS fix lands on a street. That is the difference
   * between the two, drawn instead of described.
   */
  const useMyLocation = (): void => {
    if (!('geolocation' in navigator)) {
      setLocate({ kind: 'unavailable' });
      return;
    }
    setLocate({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const z = zoomForAccuracy(accuracy, latitude, HEIGHT);
        setZoom(z);
        setCentre({ lat: latitude, lng: longitude });
        emit({ lat: latitude, lng: longitude }, z);
        setLocate({ kind: 'located', lat: latitude, lng: longitude, accuracyM: accuracy });
        // Whatever was typed stays in the search box, but a stale result list must not reappear
        // over a map that has already moved somewhere else.
        setResults(null);
      },
      (err) => {
        // Denial is separated from failure because only one of them is worth pressing again. A
        // denied permission needs a browser setting changed; a timeout just needs another go.
        setLocate({ kind: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' });
      },
      { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: 0 },
    );
  };

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
    setLocate({ kind: 'idle' });
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
    // The accuracy note described the fix, not the pin. Once the pin has been dragged it is true
    // of neither, so it goes rather than sitting there contradicting the map.
    setLocate((l) => (l.kind === 'idle' ? l : { kind: 'idle' }));
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
  const accuracyCircle = locate.kind === 'located' ? circleFor(locate, centre, zoom, width) : null;

  return (
    <Box>
      <Box sx={{ position: 'relative', mb: 1 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
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

          {/*
            Labelled, not a bare crosshair on the map. A crosshair is the convention in a map
            that IS the product; this one sits in a form next to a search box, where an
            unlabelled icon is one more thing to decode.
          */}
          <Button
            variant="outlined"
            size="small"
            onClick={useMyLocation}
            disabled={locate.kind === 'locating'}
            startIcon={
              locate.kind === 'locating' ? <CircularProgress size={16} /> : <MyLocationIcon />
            }
            sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            {locate.kind === 'locating'
              ? t('admin.venueForm.locating')
              : t('admin.venueForm.useMyLocation')}
          </Button>
        </Stack>

        {searchError && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
            {t('admin.venueForm.searchFailed')}
          </Typography>
        )}

        {/*
          Announced, because the visible feedback for this button is the map moving and that is
          exactly the feedback a screen reader does not get.
        */}
        <Box role="status" aria-live="polite">
          {locate.kind === 'denied' && (
            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
              {t('admin.venueForm.locateDenied')}
            </Typography>
          )}
          {locate.kind === 'unavailable' && (
            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
              {t('admin.venueForm.locateFailed')}
            </Typography>
          )}
          {locate.kind === 'located' && (
            <Typography
              variant="caption"
              color={locate.accuracyM > COARSE_ACCURACY_M ? 'warning.main' : 'text.secondary'}
              sx={{ display: 'block', mt: 0.5 }}
            >
              {locate.accuracyM > COARSE_ACCURACY_M
                ? t('admin.venueForm.locatedCoarse', { metres: Math.round(locate.accuracyM) })
                : t('admin.venueForm.located', { metres: Math.round(locate.accuracyM) })}
            </Typography>
          )}
        </Box>

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

        {/*
          The reported accuracy of the fix, drawn to scale. A number in a caption is easy to skim
          past; a circle covering half the district is not.
        */}
        {accuracyCircle && (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              left: accuracyCircle.left,
              top: accuracyCircle.top,
              width: accuracyCircle.size,
              height: accuracyCircle.size,
              borderRadius: '50%',
              border: '1px solid',
              borderColor: 'primary.main',
              bgcolor: 'rgba(25, 118, 210, 0.14)',
              pointerEvents: 'none',
            }}
          />
        )}

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
 * Where to draw the accuracy circle, in viewport pixels.
 *
 * Anchored to the fix rather than to the viewport centre, so it stays over the ground it
 * describes while the map is dragged away from it. That is the point of drawing it at all: the
 * moment the pin leaves the circle, the user has chosen a spot their device did not measure, and
 * they can see that they have.
 *
 * Returns null once the circle is entirely off screen, which happens quickly at street zoom and
 * is not worth a DOM node.
 */
function circleFor(
  fix: { lat: number; lng: number; accuracyM: number },
  centre: { lat: number; lng: number },
  zoom: number,
  width: number,
): { left: number; top: number; size: number } | null {
  const dx = (lngToTileX(fix.lng, zoom) - lngToTileX(centre.lng, zoom)) * TILE_SIZE;
  const dy = (latToTileY(fix.lat, zoom) - latToTileY(centre.lat, zoom)) * TILE_SIZE;
  const cx = width / 2 + dx;
  const cy = HEIGHT / 2 + dy;
  const radius = fix.accuracyM / metresPerPixel(fix.lat, zoom);
  if (cx + radius < 0 || cx - radius > width) return null;
  if (cy + radius < 0 || cy - radius > HEIGHT) return null;
  return { left: cx - radius, top: cy - radius, size: radius * 2 };
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
