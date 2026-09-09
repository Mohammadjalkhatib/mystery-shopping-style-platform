import type { NotificationKind, Signal, Verdict, VisitOutcome } from '@msp/shared';

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

export interface SessionView {
  id: string;
  state: 'pending' | 'active' | 'ended' | 'submitted' | 'abandoned' | 'expired';
  consentedAt: string | null;
  venue: { name: string; lat: number; lng: number; radiusM: number; indoor: boolean };
  startedAt: string | null;
  endedAt: string | null;
  pingCount: number;
  /** Why a terminal visit ended, in words. Null while it is still live. */
  terminalReason: string | null;
  /** The same thing as a code, so the participant screen can say it in Arabic (D-022). */
  terminalReasonCode: 'never_started' | 'went_quiet' | 'no_report' | 'expired' | null;
  /** The configured timers, so a localised message can name them. */
  timeouts: { abandonMinutes: number; hardCapHours: number };
}

/**
 * One row of the participant's own history.
 *
 * Note what is NOT here: no score, no signals, no engine version. A participant is told the
 * OUTCOME of their visit and the reviewer's feedback, and nothing about the rules that
 * produced it -- the signals are the anti-spoof rules and publishing them is a tutorial for
 * beating the engine (D-034). The console keeps the full picture.
 */
export interface ParticipantVisit {
  sessionId: string;
  state: SessionView['state'];
  outcome: VisitOutcome;
  taskTitle: string;
  taskBrief: string;
  venueName: string;
  venueAddress: string;
  assignedAt: string;
  consentedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  submittedAt: string | null;
  /** The reviewer's words, or null. Never the internal note. */
  feedback: string | null;
  decidedAt: string | null;
  /** True when a person signed this, false when the engine released it with nobody needed. */
  decidedByHuman: boolean;
  report: { notes: string; rating: number } | null;
  terminalReasonCode: SessionView['terminalReasonCode'];
  seen: { assignment: boolean; outcome: boolean };
}

export interface ParticipantSummary {
  /** Lifetime, counted server-side. */
  assigned: number;
  /** How many of the newest visits the rest of these numbers cover. */
  countedOver: number;
  submitted: number;
  approved: number;
  notApproved: number;
  inReview: number;
  openNow: number;
  closed: number;
  approvalRate: number | null;
  averageRating: number | null;
}

export interface ParticipantDashboard {
  summary: ParticipantSummary;
  visits: ParticipantVisit[];
  timeouts: { abandonMinutes: number; hardCapHours: number };
}

export interface ParticipantNotification {
  kind: NotificationKind;
  sessionId: string;
  taskTitle: string;
  venueName: string;
  at: string;
  outcome: VisitOutcome;
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejectedOutOfWindow: number;
  pingCount: number;
  remainingBudget: number;
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
  report: { notes: string; rating: number; submittedAt: string; evidenceKey: string | null } | null;
  review: {
    decision: string;
    note: string;
    reviewerId: string;
    at: string;
    /** What the participant was told, or null. The `note` above stays internal. */
    feedbackToParticipant: string | null;
  } | null;
  venue: { name: string; radiusM: number; indoor: boolean } | null;
}

export interface VenueRow {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusM: number;
  nearBufferM: number;
  indoor: boolean;
}

export interface NewVenue {
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusM: number;
  nearBufferM?: number;
  indoor?: boolean;
  /** Admins only. A business user's org comes from their token and this is refused. */
  clientOrgId?: string;
}

export interface TaskRow {
  id: string;
  title: string;
  brief: string;
  venueId: string;
  venueName: string;
  expectedDwellSeconds: number;
  active: boolean;
  assignmentCount: number;
}

export interface ParticipantRow {
  id: string;
  displayName: string;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
  kind: string;
}

export interface ParticipantStats {
  participantId: string;
  displayName: string;
  visits: number;
  auto_verified: number;
  needs_review: number;
  rejected: number;
  passRate: number;
  medianScore: number | null;
  topSignal: { code: string; visits: number } | null;
  lastVisitAt: string | null;
}

export interface ConsoleStats {
  days: number;
  totals: { visits: number; auto_verified: number; needs_review: number; rejected: number };
  medianCoverageRatio: number | null;
  medianScore: number | null;
  byDay: { date: string; auto_verified: number; needs_review: number; rejected: number }[];
  topFailingSignals: { code: string; visits: number; totalPenalty: number; reason: string }[];
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
  mySessions: () => req<SessionView[]>('/sessions/mine'),
  session: (id: string) => req<SessionView>(`/sessions/${id}`),
  consent: (id: string, consentVersion: string) =>
    req<{ consentedAt: string; consentVersion: string }>(`/sessions/${id}/consent`, {
      method: 'POST',
      body: JSON.stringify({ consentVersion }),
    }),
  startVisit: (id: string) => req<SessionView>(`/sessions/${id}/start`, { method: 'POST' }),
  endVisit: (id: string) => req<SessionView>(`/sessions/${id}/end`, { method: 'POST' }),
  postPings: (id: string, fixes: unknown[]) =>
    req<IngestResult>(`/sessions/${id}/pings`, { method: 'POST', body: JSON.stringify({ fixes }) }),
  submitReport: (id: string, notes: string, rating: number, evidenceKey?: string) =>
    req<{ sessionId: string; submittedAt: string }>(`/sessions/${id}/report`, {
      method: 'POST',
      body: JSON.stringify({ notes, rating, ...(evidenceKey ? { evidenceKey } : {}) }),
    }),

  /**
   * Upload one photo as a raw body, not multipart.
   *
   * `req()` is not reused: it sets a JSON content-type and stringifies, and both are wrong
   * here. The browser must NOT set a boundary or re-encode — the server reads the bytes and
   * checks them against the declared type.
   */
  uploadEvidence: async (
    sessionId: string,
    file: File,
  ): Promise<{ evidenceKey: string; bytes: number; contentType: string }> => {
    const token = tokenStore.get();
    const res = await fetch(`${BASE}/sessions/${sessionId}/evidence`, {
      method: 'POST',
      headers: {
        'content-type': file.type,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: file,
    });
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => ({}));
      const m = (body as { message?: string | string[] }).message;
      throw new ApiError(res.status, Array.isArray(m) ? (m[0] ?? res.statusText) : (m ?? res.statusText), body);
    }
    return (await res.json()) as { evidenceKey: string; bytes: number; contentType: string };
  },

  /**
   * Fetch a stored photo as an object URL.
   *
   * The read route is token-guarded, so `<img src>` cannot be pointed at it directly — a plain
   * URL carries no Authorization header. The caller must revoke the URL when done.
   */
  evidenceObjectUrl: async (evidenceKey: string): Promise<string> => {
    const token = tokenStore.get();
    // Encoded, because the key is opaque by contract: GridFS issues an ObjectId and S3 issues
    // `<sessionId>.<uuid>`, and the next backend may issue something else again.
    const res = await fetch(`${BASE}/evidence/${encodeURIComponent(evidenceKey)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, 'Could not load the photo');
    return URL.createObjectURL(await res.blob());
  },
  visits: (verdict?: Verdict) =>
    req<VisitRow[]>(`/console/visits${verdict ? `?verdict=${verdict}` : ''}`),
  counts: () => req<Record<string, number>>('/console/visits/counts'),
  stats: (days = 30) => req<ConsoleStats>(`/console/stats?days=${days}`),
  /** Per-participant results for the People tab. Distinct from `participants`, which is the
   * roster the assign form picks from. */
  participantStats: (days = 30) =>
    req<ParticipantStats[]>(`/console/participants?days=${days}`),
  visit: (id: string) => req<VisitDetail>(`/console/visits/${id}`),
  /**
   * Record an override.
   *
   * Two texts, deliberately. `note` is the internal reason and stays required; the optional
   * `feedbackToParticipant` is the only part of this the participant will ever read (D-034).
   */
  review: (
    id: string,
    decision: 'approve' | 'reject',
    note: string,
    feedbackToParticipant?: string,
  ) =>
    req<{ ok: true }>(`/console/visits/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({
        decision,
        note,
        ...(feedbackToParticipant?.trim() ? { feedbackToParticipant: feedbackToParticipant.trim() } : {}),
      }),
    }),

  /* the participant's own record */

  /** History, totals and the configured timers, in one round trip. */
  myDashboard: (limit?: number) =>
    req<ParticipantDashboard>(`/me/dashboard${limit ? `?limit=${limit}` : ''}`),
  myNotifications: () => req<ParticipantNotification[]>('/me/notifications'),
  /** Acknowledge one notification. The read timestamp is the server's (rule 2). */
  markNotificationSeen: (sessionId: string, kind: NotificationKind) =>
    req<{ ok: true }>(`/me/notifications/${sessionId}/seen`, {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }),

  /* authoring -- venues, tasks, assignments */
  venues: () => req<VenueRow[]>('/venues'),
  createVenue: (body: NewVenue) =>
    req<VenueRow>('/venues', { method: 'POST', body: JSON.stringify(body) }),
  /** Partial. Only the fields sent are changed; a venue cannot change organisation. */
  updateVenue: (id: string, body: Partial<Omit<NewVenue, 'clientOrgId'>>) =>
    req<VenueRow>(`/venues/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  tasks: () => req<TaskRow[]>('/tasks'),
  createTask: (body: {
    venueId: string;
    title: string;
    brief: string;
    expectedDwellSeconds?: number;
  }) => req<TaskRow>('/tasks', { method: 'POST', body: JSON.stringify(body) }),
  createAssignment: (taskId: string, participantId: string) =>
    req<{ assignmentId: string; sessionId: string; participantId: string }>('/assignments', {
      method: 'POST',
      body: JSON.stringify({ taskId, participantId }),
    }),
  participants: () => req<ParticipantRow[]>('/participants'),
  /** Address search for the venue map. Proxied by the API — see D-030. */
  geocode: (q: string, signal?: AbortSignal) =>
    req<GeocodeResult[]>(`/geocode?q=${encodeURIComponent(q)}`, { signal }),
};

export { BASE as API_BASE };
