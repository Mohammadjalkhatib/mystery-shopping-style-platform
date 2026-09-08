/**
 * Talking to Nominatim, the parts that are pure.
 *
 * Split out for the usual reason: the request building and the response mapping are where a
 * mistake is silent — a mis-parsed latitude puts a venue in the wrong country and still looks
 * like a coordinate — while the HTTP call itself either works or throws.
 *
 * Everything Nominatim returns is UNTRUSTED external data. It is parsed defensively, coordinates
 * are range-checked, and display names are truncated rather than trusted to be sane.
 */

export interface GeocodeResult {
  /** The human-readable place, e.g. "Mecca Street, Amman, Jordan". */
  label: string;
  lat: number;
  lng: number;
  /** Nominatim's own classification, useful for showing a shop apart from a whole city. */
  kind: string;
}

/** Nominatim refuses very short queries anyway, and they return noise when they do not. */
export const MIN_QUERY_LENGTH = 3;
export const MAX_QUERY_LENGTH = 120;
export const MAX_RESULTS = 6;

/** Longest label we will render. A pathological name should not break a dropdown. */
const MAX_LABEL_LENGTH = 160;

export function normaliseQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
}

export function isUsableQuery(raw: string): boolean {
  return normaliseQuery(raw).length >= MIN_QUERY_LENGTH;
}

/**
 * Build the search URL.
 *
 * `format=jsonv2` for a stable shape, `addressdetails=0` because only the display name is
 * used and asking for less is both faster and politer to a free service.
 */
export function searchUrl(query: string, limit = MAX_RESULTS): string {
  const params = new URLSearchParams({
    q: normaliseQuery(query),
    format: 'jsonv2',
    limit: String(Math.min(Math.max(1, limit), MAX_RESULTS)),
    addressdetails: '0',
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

/**
 * A coordinate, or null. Never a silent zero.
 *
 * `Number(null)`, `Number('')`, `Number([])` and `Number(false)` are all **0**, not NaN — so a
 * missing latitude parsed with a bare `Number()` becomes a venue at 0 degrees, in the Gulf of
 * Guinea, that looks like a perfectly ordinary coordinate. A test caught exactly that here.
 * Only a string or a number is considered at all.
 */
function toCoordinate(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map a Nominatim response into our shape, discarding anything malformed.
 *
 * Lat and lng arrive as STRINGS. Every row is range-checked and a bad one is DROPPED rather
 * than repaired: a half-understood result is worse than no result, because it still looks like
 * a place somebody can click.
 */
export function mapResults(payload: unknown): GeocodeResult[] {
  if (!Array.isArray(payload)) return [];

  const out: GeocodeResult[] = [];
  for (const row of payload) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;

    const lat = toCoordinate(r.lat);
    const lng = toCoordinate(r.lon);
    if (lat === null || lng === null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    const name = typeof r.display_name === 'string' ? r.display_name.trim() : '';
    if (!name) continue;

    out.push({
      label: name.length > MAX_LABEL_LENGTH ? `${name.slice(0, MAX_LABEL_LENGTH - 1)}…` : name,
      lat,
      lng,
      kind: typeof r.type === 'string' ? r.type : 'place',
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/**
 * A zoom that suits what was found.
 *
 * A country and a coffee shop are both "a result", and dropping the map at street level on a
 * country is as unhelpful as showing a whole province for a shop. Nominatim's `type` is the
 * only hint available without asking for address details.
 */
export function zoomForKind(kind: string): number {
  if (['country', 'state', 'region'].includes(kind)) return 7;
  if (['city', 'county', 'province', 'administrative'].includes(kind)) return 12;
  if (['suburb', 'neighbourhood', 'village', 'town'].includes(kind)) return 15;
  return 17;
}
