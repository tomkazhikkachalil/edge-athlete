/**
 * The event page's fetch helpers (Events program, the event page) — one
 * place for the routes, the token and the error body. Client-only.
 */
import type { SportEventViewPayload } from './view';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    const error = !res.ok ? ((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`) : null;
    return { ok: res.ok, status: res.status, data: res.ok ? (body as T) : null, error };
  } catch {
    return { ok: false, status: 0, data: null, error: 'You appear to be offline.' };
  }
}

const q = (token: string | null) => (token ? `?token=${encodeURIComponent(token)}` : '');
/** The token plus an optional flight filter. */
const qs = (token: string | null, flight?: string | null) => {
  const p = new URLSearchParams();
  if (token) p.set('token', token);
  if (flight) p.set('flight', flight);
  const str = p.toString();
  return str ? `?${str}` : '';
};

export function eventApi(eventId: string, token: string | null) {
  const base = `/api/sport-events/${eventId}`;
  return {
    view: () => call<SportEventViewPayload>(`${base}${q(token)}`),
    transition: (to: string, extra: Record<string, unknown> = {}) => call<SportEventViewPayload>(`${base}/transition`, { method: 'POST', body: JSON.stringify({ to, ...extra }) }),
    participantAction: (pid: string, action: string) => call<{ participant: unknown }>(`${base}/participants/${pid}`, { method: 'POST', body: JSON.stringify({ action }) }),
    participantPatch: (pid: string, patch: Record<string, unknown>) => call<{ participant: unknown }>(`${base}/participants/${pid}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    request: () => call<{ participant: unknown }>(`${base}/participants/request${q(token)}`, { method: 'POST', body: '{}' }),
    follow: () => call<{ following: boolean }>(`${base}/follow${q(token)}`, { method: 'POST', body: '{}' }),
    unfollow: () => call<{ following: boolean }>(`${base}/follow${q(token)}`, { method: 'DELETE' }),
    inviteHandles: (handles: string[]) => call<{ invited: string[]; skipped: Record<string, number> }>(`${base}/participants`, { method: 'POST', body: JSON.stringify({ handles }) }),
    invite: (profileIds: string[]) => call<{ invited: string[]; skipped: Record<string, number> }>(`${base}/participants`, { method: 'POST', body: JSON.stringify({ profile_ids: profileIds }) }),
    rotateLink: () => call<{ link_token: string }>(`${base}/link-token`, { method: 'POST', body: '{}' }),
    roundTransition: (roundId: string, to: string, extra: Record<string, unknown> = {}) => call<SportEventViewPayload>(`${base}/rounds/${roundId}/transition`, { method: 'POST', body: JSON.stringify({ to, ...extra }) }),
    addRound: (body: Record<string, unknown>) => call<SportEventViewPayload>(`${base}/rounds`, { method: 'POST', body: JSON.stringify(body) }),
    updateRound: (roundId: string, body: Record<string, unknown>) => call<SportEventViewPayload>(`${base}/rounds/${roundId}`, { method: 'PUT', body: JSON.stringify(body) }),
    deleteRound: (roundId: string) => call<SportEventViewPayload>(`${base}/rounds/${roundId}`, { method: 'DELETE' }),
    saveGroups: (roundId: string, body: unknown) => call<SportEventViewPayload>(`${base}/rounds/${roundId}/groups`, { method: 'PUT', body: JSON.stringify(body) }),
    scorecard: (groupPostId: string) => call<{ scorecard: { participants: import('./cards-view').ScorecardParticipant[] } }>(`/api/group-posts/${groupPostId}/scorecard`),
    submitCard: (pid: string) => call<{ card: { status: string } }>(`${base}/cards/${pid}/submit`, { method: 'POST', body: '{}' }),
    finalizeCard: (pid: string, reopen = false) => call<{ card: { status: string } }>(`${base}/cards/${pid}/finalize`, { method: 'POST', body: JSON.stringify({ reopen }) }),
    leaderboard: (roundId: string, flight?: string | null) => call<import('./leaderboard-server').RoundLeaderboard>(`${base}/rounds/${roundId}/leaderboard${qs(token, flight)}`),
    overall: (flight?: string | null) => call<import('./leaderboard-server').OverallLeaderboard>(`${base}/leaderboard${qs(token, flight)}`),
  };
}

export type EventApi = ReturnType<typeof eventApi>;
