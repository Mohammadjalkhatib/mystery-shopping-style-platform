import type { Signal, Verdict } from '@msp/shared';

const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'msp.token';

export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (t: string): void => localStorage.setItem(TOKEN_KEY, t),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    const message =
      (body as { message?: string | string[] }).message instanceof Array
        ? ((body as { message: string[] }).message[0] ?? res.statusText)
        : ((body as { message?: string }).message ?? res.statusText);
    throw new ApiError(res.status, message, body);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/* ------------------------------------------------------------------- types */

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'business' | 'participant';
  clientOrgId: string | null;
}

export interface VisitRow {
  sessionId: string;
  venueName: string;
  participantId: string;
  endedAt: string | null;
  verdict: Verdict | null;
  score: number | null;
}

export interface VisitDetail extends VisitRow {
  startedAt: string | null;
  signals: Signal[];
  engineVersion: string | null;
  rollups: {
    fixCount: number;
    dwellSeconds: number;
    coverageRatio: number;
    minDistanceM: number | null;
    medianAccuracyM: number | null;
    unusableFixCount: number;
  } | null;
  report: { notes: string; rating: number; submittedAt: string } | null;
  review: { decision: string; note: string; reviewerId: string; at: string } | null;
  venue: { name: string; radiusM: number; indoor: boolean } | null;
}

/* ------------------------------------------------------------------- calls */

export const api = {
  login: (username: string, password: string) =>
    req<{ token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => req<AuthUser>('/auth/me'),
  demoCredentials: () =>
    req<{ password: string; accounts: { username: string; role: string }[] }>(
      '/auth/demo-credentials',
    ),
  visits: (verdict?: Verdict) =>
    req<VisitRow[]>(`/console/visits${verdict ? `?verdict=${verdict}` : ''}`),
  counts: () => req<Record<string, number>>('/console/visits/counts'),
  visit: (id: string) => req<VisitDetail>(`/console/visits/${id}`),
  review: (id: string, decision: 'approve' | 'reject', note: string) =>
    req<{ ok: true }>(`/console/visits/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    }),
};

export { BASE as API_BASE };
