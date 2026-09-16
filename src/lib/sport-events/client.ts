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
    join: () => call<{ participant: unknown }>(`${base}/participants/join${q(token)}`, { method: 'POST', body: '{}' }),
    follow: () => call<{ following: boolean }>(`${base}/follow${q(token)}`, { method: 'POST', body: '{}' }),
    unfollow: () => call<{ following: boolean }>(`${base}/follow${q(token)}`, { method: 'DELETE' }),
    inviteHandles: (handles: string[]) => call<{ invited: string[]; skipped: Record<string, number> }>(`${base}/participants`, { method: 'POST', body: JSON.stringify({ handles }) }),
    invite: (profileIds: string[], recorder = false) => call<{ invited: string[]; skipped: Record<string, number> }>(`${base}/participants`, { method: 'POST', body: JSON.stringify({ profile_ids: profileIds, ...(recorder ? { recorder: true } : {}) }) }),
    rotateLink: () => call<{ link_token: string }>(`${base}/link-token`, { method: 'POST', body: '{}' }),
    patchEvent: (patch: Record<string, unknown>) => call<SportEventViewPayload>(base, { method: 'PATCH', body: JSON.stringify(patch) }),
    saveFlights: (assignments: Array<{ participant_id: string; flight: string | null }>) => call<SportEventViewPayload>(`${base}/flights`, { method: 'PUT', body: JSON.stringify({ assignments }) }),
    setContest: (competitionId: string | null) => call<{ counts_toward: unknown; reason?: string }>(`${base}/contest`, { method: 'PUT', body: JSON.stringify({ competition_id: competitionId }) }),
    roundTransition: (roundId: string, to: string, extra: Record<string, unknown> = {}) => call<SportEventViewPayload>(`${base}/rounds/${roundId}/transition`, { method: 'POST', body: JSON.stringify({ to, ...extra }) }),
    addRound: (body: Record<string, unknown>) => call<SportEventViewPayload>(`${base}/rounds`, { method: 'POST', body: JSON.stringify(body) }),
    updateRound: (roundId: string, body: Record<string, unknown>) => call<SportEventViewPayload>(`${base}/rounds/${roundId}`, { method: 'PUT', body: JSON.stringify(body) }),
    deleteRound: (roundId: string) => call<SportEventViewPayload>(`${base}/rounds/${roundId}`, { method: 'DELETE' }),
    saveGroups: (roundId: string, body: unknown) => call<SportEventViewPayload>(`${base}/rounds/${roundId}/groups`, { method: 'PUT', body: JSON.stringify(body) }),
    scorecard: (groupPostId: string) => call<{ scorecard: { participants: import('./cards-view').ScorecardParticipant[] } }>(`/api/group-posts/${groupPostId}/scorecard`),
    submitCard: (pid: string) => call<{ card: { status: string } }>(`${base}/cards/${pid}/submit`, { method: 'POST', body: '{}' }),
    finalizeCard: (pid: string, reopen = false) => call<{ card: { status: string } }>(`${base}/cards/${pid}/finalize`, { method: 'POST', body: JSON.stringify({ reopen }) }),
    leaderboard: (roundId: string, flight?: string | null) => call<import('./leaderboard-server').RoundLeaderboard>(`${base}/rounds/${roundId}/leaderboard${qs(token, flight)}`),
    breakdown: (round: 'all' | string = 'all', participant?: string | null) => {
      const p = new URLSearchParams();
      if (token) p.set('token', token);
      p.set('round', round);
      if (participant) p.set('participant', participant);
      return call<import('./breakdown-server').EventBreakdown>(`${base}/breakdown?${p.toString()}`);
    },
    overall: (flight?: string | null) => call<import('./leaderboard-server').OverallLeaderboard>(`${base}/leaderboard${qs(token, flight)}`),
    // Phase 3: the matches (every round's, or one round's) and the three intent writes — each carries the match `version` (409 conflict = re-read and replay).
    matches: (roundId?: string | null) => {
      const p = new URLSearchParams();
      if (token) p.set('token', token);
      if (roundId) p.set('round', roundId);
      const str = p.toString();
      return call<import('./match-view').EventMatchesPayload>(`${base}/matches${str ? `?${str}` : ''}`);
    },
    concede: (matchId: string, body: { hole: number | null; side: 1 | 2; version: number }) => call<{ match: import('./match-view').MatchView }>(`${base}/matches/${matchId}/concede`, { method: 'POST', body: JSON.stringify(body) }),
    extraHole: (matchId: string, body: { n: number; hole_number?: number; strokes: Record<string, number | null>; version: number }) => call<{ match: import('./match-view').MatchView }>(`${base}/matches/${matchId}/extra-hole`, { method: 'POST', body: JSON.stringify(body) }),
    // Phase 4: a team round's stats (polled), the whole-line CAS write and the game score's CAS write.
    roundStats: (roundId: string) => call<import('./stats-server').RoundStatsPayload>(`${base}/rounds/${roundId}/stats${q(token)}`),
    putStatLine: (roundId: string, lineId: string, body: { stats: Record<string, number>; expected_version: number }) => call<{ line: import('./stats-server').StatLineRow }>(`${base}/rounds/${roundId}/stats/${lineId}`, { method: 'PUT', body: JSON.stringify(body) }),
    putScore: (roundId: string, body: { side1_score: number; side2_score: number; period?: number; expected_version: number }) => call<{ score: { side1_score: number; side2_score: number; period: number; version: number } }>(`${base}/rounds/${roundId}/score`, { method: 'PUT', body: JSON.stringify(body) }),
    decideMatch: (matchId: string, body: { winner_side: 1 | 2 | null; version: number }) => call<{ match: import('./match-view').MatchView }>(`${base}/matches/${matchId}/decide`, { method: 'POST', body: JSON.stringify(body) }),
  };
}

export type EventApi = ReturnType<typeof eventApi>;
