import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  isUsableQuery,
  mapResults,
  normaliseQuery,
  searchUrl,
  type GeocodeResult,
} from './nominatim.js';

/**
 * Nominatim's absolute maximum is one request per second, for everybody. Exceeding it gets an
 * application blocked, so this is a hard serialisation, not a nicety.
 */
const MIN_INTERVAL_MS = 1_100;
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_MAX = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Address search, proxied through the API rather than called from the browser.
 *
 * Three reasons it is a proxy and not a `fetch` in the web app, and the first is the binding
 * one: Nominatim's usage policy requires a genuine identifying `User-Agent`, and a browser will
 * not let a page set that header. Second, the rate limit is per APPLICATION, so it can only be
 * honoured somewhere requests converge — ten admins typing in ten browsers cannot coordinate.
 * Third, it keeps the search terms and the user's IP off a third party.
 *
 * The cost is an outbound call from our own service, and it is the correct one to pay.
 */
@Injectable()
export class GeocodeService {
  private readonly logger = new Logger('Geocode');
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly cache = new Map<string, { at: number; results: GeocodeResult[] }>();

  async search(rawQuery: string): Promise<GeocodeResult[]> {
    if (!isUsableQuery(rawQuery)) {
      throw new BadRequestException('Search for at least 3 characters');
    }
    const query = normaliseQuery(rawQuery).toLowerCase();

    const hit = this.cache.get(query);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

    // Serialised through one promise chain: parallel callers queue rather than race, which is
    // what makes the interval below an actual guarantee instead of a hope.
    const run = this.queue.then(() => this.fetchThrottled(query));
    this.queue = run.catch(() => undefined);
    const results = await run;

    this.remember(query, results);
    return results;
  }

  private async fetchThrottled(query: string): Promise<GeocodeResult[]> {
    const wait = Math.max(0, this.lastRequestAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(searchUrl(query), {
        signal: controller.signal,
        headers: {
          // Required by the usage policy: a real contact point, not a browser string.
          'User-Agent': 'theQA-visit-verification/1.0 (mystery-shopping assessment build)',
          Accept: 'application/json',
        },
      });
      if (res.status === 429 || res.status === 403) {
        // Being throttled or blocked is not a bug in the caller's query. Say so plainly.
        throw new ServiceUnavailableException('Address search is rate limited right now');
      }
      if (!res.ok) throw new ServiceUnavailableException('Address search is unavailable');
      return mapResults(await res.json());
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      this.logger.warn(`Nominatim lookup failed: ${e instanceof Error ? e.message : 'unknown'}`);
      throw new ServiceUnavailableException('Address search is unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Bounded, oldest-first. A cache that grows without limit is a slow leak, not a cache. */
  private remember(query: string, results: GeocodeResult[]): void {
    this.cache.set(query, { at: Date.now(), results });
    while (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
