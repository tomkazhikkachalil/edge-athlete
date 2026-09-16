import { existsSync } from 'fs';
import { join } from 'path';
import { expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { adminClient, apiAs, E2E_BASE_URL, loadQaUser, readErrorBody, resetRateBucket, type QaUser } from './qa-user';

/**
 * The sport-events e2e helper (Events program, phase 2). One place for the
 * flows every spec used to inline: the two QA users' API contexts (A hosts,
 * B plays), create with one round or a list, invite → accept, groups, go
 * live, scoring, the board, and a cleanup that never throws. The rate
 * buckets are reset up front — a tournament spec makes several times the
 * calls of a phase-1 spec and the `sport-event` bucket is 120/h per user.
 *
 * Every function asserts its own success (with the error body in the
 * message) EXCEPT `cleanupEvent`, which is best-effort by design: an
 * assertion in a spec's `finally` masks the real failure.
 */

export interface RoundBody {
  scheduled_on: string;
  course_name?: string;
  course_id?: string;
  tee?: string;
  holes?: 9 | 18;
  starting_hole?: 1 | 10;
  /** Phase 4 (215): a team round's start (ISO). */
  starts_at?: string;
}

export interface EventView {
  event: {
    id: string;
    name: string;
    status: string;
    visibility: string;
    format: string;
    capacity: number | null;
    starts_on: string | null;
    link_token: string | null;
    opened_at: string | null;
    went_live_at: string | null;
    completed_at: string | null;
    /** 207 (phase 2): the organizer's format options. */
    format_config?: { cut?: { after_round: number; top_n?: number; to_par?: number } | null; match?: { sides: string; bracket: boolean; allowance?: number } | null };
    /** Phase 3: the match options (defaults filled) — null on a stroke format. */
    match?: { sides: 'singles' | 'fourball' | 'foursomes'; bracket: boolean; allowance: number } | null;
    /** Phase 4 (214). */
    self_entry?: boolean;
    /** Phase 4 (215). */
    shape?: 'round' | 'game' | 'session';
    game?: { side_names: [string, string] } | null;
  };
  rounds: Array<{ id: string; sequence: number; scheduled_on: string; course_name: string; holes: number; starting_hole: number; status: string; group_post_id: string | null; name?: string | null; starts_at?: string | null; side1_score?: number | null; side2_score?: number | null; period?: number | null; score_version?: number }>;
  participants: Array<{ id: string; profile_id: string; status: string; role: string; playing: boolean; waitlist_position: number | null; handicap_index: number | null; recorder?: boolean }>;
  groups: Array<{ id: string; sport_event_round_id: string; sequence: number; name?: string | null; starting_hole?: number; members: Array<{ participant_id: string; position: number; side?: 1 | 2 | null }> }>;
  counts: { playing: number; followers: number; waitlisted: number };
  viewer: { role: string | null; can_manage: boolean; participant_id: string | null; participant_status: string | null; playing?: boolean; recorder?: boolean };
}

export interface EventSession {
  apiA: APIRequestContext;
  apiB: APIRequestContext;
  /** Phase 3: the third and fourth QA users (four-ball, foursomes, a bracket) — null when the setup minted two only (an older checkout). */
  apiC: APIRequestContext | null;
  apiD: APIRequestContext | null;
  userC: QaUser | null;
  userD: QaUser | null;
  /** A real stranger: the config's `use.storageState` reaches even a bare newContext, so this one carries an EMPTY state. */
  anon: APIRequestContext;
  userA: QaUser;
  userB: QaUser;
  stamp: number;
  dispose: () => Promise<void>;
}

/** The two QA users' contexts + a stranger, with the event rate buckets reset for both. */
export async function openEventSession(): Promise<EventSession> {
  const userA = loadQaUser('user.json');
  const userB = loadQaUser('user-b.json');
  const four = existsSync(join(process.cwd(), 'e2e', '.auth', 'user-d.json'));
  const userC = four ? loadQaUser('user-c.json') : null;
  const userD = four ? loadQaUser('user-d.json') : null;
  const admin = adminClient();
  for (const u of [userA, userB, userC, userD]) {
    if (!u) continue;
    await resetRateBucket(admin, 'sport-event', u.id);
    await resetRateBucket(admin, 'sport-event-join', u.id);
  }
  const apiA = await apiAs('state.json');
  const apiB = await apiAs('state-b.json');
  const apiC = four ? await apiAs('state-c.json') : null;
  const apiD = four ? await apiAs('state-d.json') : null;
  const anon = await pwRequest.newContext({ baseURL: E2E_BASE_URL, storageState: { cookies: [], origins: [] } });
  return {
    apiA,
    apiB,
    apiC,
    apiD,
    anon,
    userA,
    userB,
    userC,
    userD,
    stamp: Date.now(),
    dispose: async () => {
      await Promise.all([apiA.dispose(), apiB.dispose(), anon.dispose(), apiC?.dispose(), apiD?.dispose()]);
    },
  };
}

export interface CreateEventOptions {
  name: string;
  /** Phase 4 (215): a stat-line sport makes a game (default) or a session. */
  sport_key?: string;
  shape?: 'round' | 'game' | 'session';
  visibility?: 'public' | 'link' | 'private';
  join_mode?: 'invite' | 'request' | 'open';
  format?: 'stroke_gross' | 'stroke_net' | 'match_gross' | 'match_net';
  /** Phase 3: the match shape at creation. */
  format_config?: { match?: { sides: 'singles' | 'fourball' | 'foursomes'; bracket?: boolean; allowance?: number } | null; cut?: { after_round: number; top_n?: number; to_par?: number } | null; game?: { side_names: [string, string] } | null };
  capacity?: number;
  publish?: boolean;
  host_plays?: boolean;
  /** Phase 4 (214): players enter their own (default true); false = recorders / organizers only. */
  self_entry?: boolean;
  /** Hosted for an org (phase 2b): the create route gates on manage_competitions. */
  club_id?: string;
  league_id?: string;
  /** One round (phase 1's body) … */
  round?: RoundBody;
  /** … or the list (phase 2). Exactly one of the two. */
  rounds?: RoundBody[];
}

const DEFAULT_ROUND: RoundBody = { scheduled_on: '2030-06-01', course_name: 'QA Links', holes: 18, starting_hole: 1 };

/** Create an event as `api` and assert the 201; defaults to one 18-hole round on 2030-06-01. */
export async function createEvent(api: APIRequestContext, opts: CreateEventOptions): Promise<EventView> {
  const { round, rounds, ...rest } = opts;
  const data: Record<string, unknown> = { visibility: 'private', ...rest };
  if (rounds) data.rounds = rounds;
  else data.round = round ?? DEFAULT_ROUND;
  const res = await api.post('/api/sport-events', { data });
  expect(res.status(), await readErrorBody(res)).toBe(201);
  return (await res.json()) as EventView;
}

export async function readView(api: APIRequestContext, eventId: string, token?: string | null): Promise<EventView> {
  const res = await api.get(`/api/sport-events/${eventId}${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  expect(res.ok(), await readErrorBody(res)).toBe(true);
  return (await res.json()) as EventView;
}

/** A invites B by profile id; B accepts. Returns B's participant row id and the host's. */
export async function inviteAndAccept(s: Pick<EventSession, 'apiA' | 'apiB' | 'userB'>, eventId: string): Promise<{ participantId: string; hostRowId: string; view: EventView }> {
  return inviteAndAcceptAs(s.apiA, s.apiB, s.userB, eventId);
}

/** A invites `user` (any QA user) by profile id; they accept through `api`. */
export async function inviteAndAcceptAs(apiA: APIRequestContext, api: APIRequestContext, user: QaUser, eventId: string): Promise<{ participantId: string; hostRowId: string; view: EventView }> {
  const s = { apiA, apiB: api, userB: user };
  const invited = await s.apiA.post(`/api/sport-events/${eventId}/participants`, { data: { profile_ids: [s.userB.id] } });
  expect(invited.ok(), await readErrorBody(invited)).toBe(true);
  const asB = await readView(s.apiB, eventId);
  expect(asB.viewer.participant_id, 'B has a participant row after the invite').toBeTruthy();
  const accepted = await s.apiB.post(`/api/sport-events/${eventId}/participants/${asB.viewer.participant_id}`, { data: { action: 'accept' } });
  expect(accepted.ok(), await readErrorBody(accepted)).toBe(true);
  const hostRow = asB.participants.find(p => p.role === 'organizer');
  expect(hostRow, 'the host row is visible').toBeTruthy();
  return { participantId: asB.viewer.participant_id as string, hostRowId: hostRow!.id, view: asB };
}

/** Replace a round's groups (organizer). */
export type GroupMemberBody = string | { participant_id: string; side: 1 | 2 };
export async function setGroups(apiA: APIRequestContext, eventId: string, roundId: string, groups: Array<{ name?: string; tee_time?: string; starting_hole?: number; members: GroupMemberBody[] }>): Promise<EventView> {
  const res = await apiA.put(`/api/sport-events/${eventId}/rounds/${roundId}/groups`, { data: { groups } });
  expect(res.ok(), await readErrorBody(res)).toBe(true);
  return (await res.json()) as EventView;
}

/** The event-level transition (open · live · completed · cancelled). */
export async function transition(apiA: APIRequestContext, eventId: string, to: string, extra: Record<string, unknown> = {}): Promise<EventView> {
  const res = await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to, ...extra } });
  expect(res.ok(), await readErrorBody(res)).toBe(true);
  return (await res.json()) as EventView;
}

/** The round-level transition (phase 2): live · completed · cancelled. */
export async function roundTransition(apiA: APIRequestContext, eventId: string, roundId: string, to: 'live' | 'completed' | 'cancelled', extra: Record<string, unknown> = {}): Promise<EventView> {
  const res = await apiA.post(`/api/sport-events/${eventId}/rounds/${roundId}/transition`, { data: { to, ...extra } });
  expect(res.ok(), await readErrorBody(res)).toBe(true);
  return (await res.json()) as EventView;
}

export const startRound = (apiA: APIRequestContext, eventId: string, roundId: string, today?: string) => roundTransition(apiA, eventId, roundId, 'live', today ? { today } : {});
export const completeRound = (apiA: APIRequestContext, eventId: string, roundId: string, override = true) => roundTransition(apiA, eventId, roundId, 'completed', { override });
export const cancelRound = (apiA: APIRequestContext, eventId: string, roundId: string) => roundTransition(apiA, eventId, roundId, 'cancelled');

/** Go live on the organizer's date (defaults to the first round's). */
export async function goLive(apiA: APIRequestContext, eventId: string, today?: string): Promise<EventView> {
  return transition(apiA, eventId, 'live', today ? { today } : {});
}

export interface Scorecard {
  scorecard: {
    group_post: { id: string; status: string; sport_event_round_id: string | null };
    participants: Array<{ participant: { id: string; profile_id: string; role: string; status: string; position: number }; scores: { status?: string; updated_at: string | null; hole_scores?: Array<{ hole_number: number; strokes: number; version?: number }> } | null }>;
    sport_event: { id: string; name: string; round_id?: string; group: { members: Array<{ profile_id: string; position: number }> } | null } | null;
  };
}

export async function readScorecard(api: APIRequestContext, groupPostId: string): Promise<Scorecard['scorecard']> {
  const res = await api.get(`/api/group-posts/${groupPostId}/scorecard`);
  expect(res.ok(), await readErrorBody(res)).toBe(true);
  return ((await res.json()) as Scorecard).scorecard;
}

/** The round's `group_post_participants` row id for a profile (the id the score routes take). */
export function cardRowFor(card: Scorecard['scorecard'], profileId: string): string {
  const row = card.participants.find(p => p.participant.profile_id === profileId);
  expect(row, `a card row for ${profileId}`).toBeTruthy();
  return row!.participant.id;
}

/** Score holes on a card (the single-card route; the caller must hold the scoring right). */
export async function scoreHoles(api: APIRequestContext, cardRowId: string, scores: Array<{ hole_number: number; strokes: number; putts?: number }>): Promise<void> {
  const res = await api.post(`/api/golf/scorecards/${cardRowId}/scores`, { data: { scores } });
  expect(res.status(), await readErrorBody(res)).toBe(201);
}

export async function submitCard(api: APIRequestContext, eventId: string, cardRowId: string): Promise<void> {
  const res = await api.post(`/api/sport-events/${eventId}/cards/${cardRowId}/submit`);
  expect(res.ok(), await readErrorBody(res)).toBe(true);
}

export async function finalizeCard(apiA: APIRequestContext, eventId: string, cardRowId: string): Promise<void> {
  const res = await apiA.post(`/api/sport-events/${eventId}/cards/${cardRowId}/finalize`, { data: {} });
  expect(res.ok(), await readErrorBody(res)).toBe(true);
}

export interface BoardRow {
  participantId: string;
  profileId: string;
  name: string;
  rank: number | null;
  rankLabel: string;
  thru: number;
  gross: number | null;
  toPar: number | null;
  net: number | null;
}

export async function roundBoard(api: APIRequestContext, eventId: string, roundId: string, token?: string | null): Promise<{ rows: BoardRow[] }> {
  const res = await api.get(`/api/sport-events/${eventId}/rounds/${roundId}/leaderboard${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  expect(res.ok(), await readErrorBody(res)).toBe(true);
  return (await res.json()) as { rows: BoardRow[] };
}

/**
 * Best-effort teardown — NEVER throws. A live event refuses DELETE, so it
 * is completed with the override first; a draft / open one is deleted
 * outright; a stale id is a no-op. Pass null when nothing was created.
 */
export async function cleanupEvent(apiA: APIRequestContext, eventId: string | null | undefined): Promise<void> {
  if (!eventId) return;
  try {
    const res = await apiA.get(`/api/sport-events/${eventId}`);
    if (res.status() === 404) return;
    const view = (await res.json()) as EventView;
    if (view.event.status === 'live') {
      // A live tournament: every scheduled round is cancelled first (the
      // event-level complete refuses `rounds_remaining`), then the live
      // round completes with the override — the event follows its rounds.
      for (const r of view.rounds.filter(x => x.status === 'scheduled')) {
        await apiA.post(`/api/sport-events/${eventId}/rounds/${r.id}/transition`, { data: { to: 'cancelled' } }).catch(() => null);
      }
      const live = view.rounds.find(x => x.status === 'live');
      if (live) await apiA.post(`/api/sport-events/${eventId}/rounds/${live.id}/transition`, { data: { to: 'completed', override: true } }).catch(() => null);
      else await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'completed', override: true } }).catch(() => null);
    } else if (view.event.status === 'open') {
      await apiA.post(`/api/sport-events/${eventId}/transition`, { data: { to: 'cancelled' } }).catch(() => null);
    }
    await apiA.delete(`/api/sport-events/${eventId}`).catch(() => null);
  } catch {
    // best-effort
  }
}
