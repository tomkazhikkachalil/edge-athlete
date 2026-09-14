/**
 * Request-body validation for the sport-events routes (Events program,
 * PR 4) — pure. A miss is a 400 naming the field, never a clamp and never a
 * silent strip (the stat-line rule). The vocabularies are the literal
 * unions in ./types, so a widened CHECK is one edit on each side.
 */
import {
  SPORT_EVENT_FORMATS,
  SPORT_EVENT_JOIN_MODES,
  SPORT_EVENT_SPORTS,
  SPORT_EVENT_VISIBILITIES,
  type SportEventFormat,
  type SportEventJoinMode,
  type SportEventVisibility,
} from './types';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export interface RoundInput {
  scheduled_on: string;
  course_id: string | null;
  course_name: string | null;
  tee: string | null;
  holes: 9 | 18;
  starting_hole: 1 | 10;
}

export interface CreateEventInput {
  name: string;
  description: string | null;
  sport_key: (typeof SPORT_EVENT_SPORTS)[number];
  visibility: SportEventVisibility;
  join_mode: SportEventJoinMode;
  format: SportEventFormat;
  capacity: number | null;
  club_id: string | null;
  league_id: string | null;
  /** The host plays (default true); false = organizes only. */
  host_plays: boolean;
  /** true = create as `open` (the wizard's Publish); false = draft. */
  publish: boolean;
  /** Acting-as (guardian hosting for a supervised athlete). */
  profile_id: string | null;
  round: RoundInput;
}

export interface EventPatchInput {
  name?: string;
  description?: string | null;
  visibility?: SportEventVisibility;
  join_mode?: SportEventJoinMode;
  format?: SportEventFormat;
  capacity?: number | null;
  club_id?: string | null;
  league_id?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const COURSE_NAME_MAX = 200;
export const TEE_MAX = 40;
export const CAPACITY_MAX = 500;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A real calendar date in YYYY-MM-DD (the date-only class — never through Date's local parser). */
export function isDateOnly(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = DATE_ONLY.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const utc = new Date(Date.UTC(y, mo - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === mo - 1 && utc.getUTCDate() === d;
}

function optionalUuid(v: unknown, field: string): Parsed<string | null> {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  if (typeof v !== 'string' || !UUID.test(v)) return { ok: false, error: `${field} must be a uuid` };
  return { ok: true, value: v };
}

function optionalText(v: unknown, field: string, max: number): Parsed<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: `${field} must be text` };
  const t = v.trim();
  if (t.length === 0) return { ok: true, value: null };
  if (t.length > max) return { ok: false, error: `${field} must be at most ${max} characters` };
  return { ok: true, value: t };
}

function oneOf<T extends string>(v: unknown, list: readonly T[], field: string, fallback: T): Parsed<T> {
  if (v === undefined) return { ok: true, value: fallback };
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) return { ok: false, error: `${field} must be one of ${list.join(', ')}` };
  return { ok: true, value: v as T };
}

function capacity(v: unknown): Parsed<number | null> {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > CAPACITY_MAX) return { ok: false, error: `capacity must be a whole number from 1 to ${CAPACITY_MAX}` };
  return { ok: true, value: v };
}

export function parseRoundInput(body: unknown): Parsed<RoundInput> {
  if (!isRecord(body)) return { ok: false, error: 'round is required' };
  if (!isDateOnly(body.scheduled_on)) return { ok: false, error: 'round.scheduled_on must be a date (YYYY-MM-DD)' };
  const courseId = optionalUuid(body.course_id, 'round.course_id');
  if (!courseId.ok) return courseId;
  const courseName = optionalText(body.course_name, 'round.course_name', COURSE_NAME_MAX);
  if (!courseName.ok) return courseName;
  if (courseId.value === null && courseName.value === null) return { ok: false, error: 'round.course_name is required when no course is picked' };
  const tee = optionalText(body.tee, 'round.tee', TEE_MAX);
  if (!tee.ok) return tee;
  const holes = body.holes === undefined ? 18 : body.holes;
  if (holes !== 9 && holes !== 18) return { ok: false, error: 'round.holes must be 9 or 18' };
  const startingHole = body.starting_hole === undefined ? 1 : body.starting_hole;
  if (startingHole !== 1 && startingHole !== 10) return { ok: false, error: 'round.starting_hole must be 1 or 10' };
  if (holes === 18 && startingHole === 10) return { ok: false, error: 'an 18-hole round starts on hole 1' };
  return { ok: true, value: { scheduled_on: body.scheduled_on, course_id: courseId.value, course_name: courseName.value, tee: tee.value, holes, starting_hole: startingHole } };
}

export function parseCreateBody(body: unknown): Parsed<CreateEventInput> {
  if (!isRecord(body)) return { ok: false, error: 'A JSON body is required' };
  const name = optionalText(body.name, 'name', NAME_MAX);
  if (!name.ok) return name;
  if (name.value === null) return { ok: false, error: 'name is required' };
  const description = optionalText(body.description, 'description', DESCRIPTION_MAX);
  if (!description.ok) return description;
  const sport = oneOf(body.sport_key, SPORT_EVENT_SPORTS, 'sport_key', 'golf');
  if (!sport.ok) return sport;
  const visibility = oneOf(body.visibility, SPORT_EVENT_VISIBILITIES, 'visibility', 'private');
  if (!visibility.ok) return visibility;
  const joinMode = oneOf(body.join_mode, SPORT_EVENT_JOIN_MODES, 'join_mode', 'invite');
  if (!joinMode.ok) return joinMode;
  const format = oneOf(body.format, SPORT_EVENT_FORMATS, 'format', 'stroke_gross');
  if (!format.ok) return format;
  const cap = capacity(body.capacity);
  if (!cap.ok) return cap;
  const club = optionalUuid(body.club_id, 'club_id');
  if (!club.ok) return club;
  const league = optionalUuid(body.league_id, 'league_id');
  if (!league.ok) return league;
  if (club.value && league.value) return { ok: false, error: 'An event belongs to a club or a league, not both' };
  const profile = optionalUuid(body.profile_id, 'profile_id');
  if (!profile.ok) return profile;
  if (body.host_plays !== undefined && typeof body.host_plays !== 'boolean') return { ok: false, error: 'host_plays must be true or false' };
  if (body.publish !== undefined && typeof body.publish !== 'boolean') return { ok: false, error: 'publish must be true or false' };
  const round = parseRoundInput(body.round);
  if (!round.ok) return round;
  return {
    ok: true,
    value: {
      name: name.value,
      description: description.value,
      sport_key: sport.value,
      visibility: visibility.value,
      join_mode: joinMode.value,
      format: format.value,
      capacity: cap.value,
      club_id: club.value,
      league_id: league.value,
      host_plays: body.host_plays !== false,
      publish: body.publish === true,
      profile_id: profile.value,
      round: round.value,
    },
  };
}

/** A PATCH names only the fields it changes; an unknown field is refused (a typo must never be a silent no-op). */
export function parseEventPatch(body: unknown): Parsed<EventPatchInput> {
  if (!isRecord(body)) return { ok: false, error: 'A JSON body is required' };
  const out: EventPatchInput = {};
  const known = new Set(['name', 'description', 'visibility', 'join_mode', 'format', 'capacity', 'club_id', 'league_id']);
  for (const key of Object.keys(body)) if (!known.has(key)) return { ok: false, error: `Unknown field: ${key}` };
  if ('name' in body) {
    const name = optionalText(body.name, 'name', NAME_MAX);
    if (!name.ok) return name;
    if (name.value === null) return { ok: false, error: 'name cannot be empty' };
    out.name = name.value;
  }
  if ('description' in body) {
    const d = optionalText(body.description, 'description', DESCRIPTION_MAX);
    if (!d.ok) return d;
    out.description = d.value;
  }
  if ('visibility' in body) {
    const v = oneOf(body.visibility, SPORT_EVENT_VISIBILITIES, 'visibility', 'private');
    if (!v.ok) return v;
    out.visibility = v.value;
  }
  if ('join_mode' in body) {
    const v = oneOf(body.join_mode, SPORT_EVENT_JOIN_MODES, 'join_mode', 'invite');
    if (!v.ok) return v;
    out.join_mode = v.value;
  }
  if ('format' in body) {
    const v = oneOf(body.format, SPORT_EVENT_FORMATS, 'format', 'stroke_gross');
    if (!v.ok) return v;
    out.format = v.value;
  }
  if ('capacity' in body) {
    const c = capacity(body.capacity);
    if (!c.ok) return c;
    out.capacity = c.value;
  }
  if ('club_id' in body) {
    const c = optionalUuid(body.club_id, 'club_id');
    if (!c.ok) return c;
    out.club_id = c.value;
  }
  if ('league_id' in body) {
    const l = optionalUuid(body.league_id, 'league_id');
    if (!l.ok) return l;
    out.league_id = l.value;
  }
  if (out.club_id && out.league_id) return { ok: false, error: 'An event belongs to a club or a league, not both' };
  if (Object.keys(out).length === 0) return { ok: false, error: 'Nothing to change' };
  return { ok: true, value: out };
}

/** The invite body: profile ids and / or handles, at most 50 a call. */
export function parseInviteBody(body: unknown): Parsed<{ profileIds: string[]; handles: string[] }> {
  if (!isRecord(body)) return { ok: false, error: 'A JSON body is required' };
  const ids = body.profile_ids === undefined ? [] : body.profile_ids;
  const handles = body.handles === undefined ? [] : body.handles;
  if (!Array.isArray(ids) || !ids.every(v => typeof v === 'string' && UUID.test(v))) return { ok: false, error: 'profile_ids must be a list of uuids' };
  if (!Array.isArray(handles) || !handles.every(v => typeof v === 'string' && /^[a-z0-9_.]{2,40}$/i.test(v))) return { ok: false, error: 'handles must be a list of handles' };
  if (ids.length + handles.length === 0) return { ok: false, error: 'Nobody to invite' };
  if (ids.length + handles.length > 50) return { ok: false, error: 'At most 50 invites a call' };
  return { ok: true, value: { profileIds: [...new Set(ids as string[])], handles: [...new Set((handles as string[]).map(h => h.toLowerCase()))] } };
}

/** The participant PATCH: an organizer's index override, or the player's own toggles. */
export function parseParticipantPatch(body: unknown): Parsed<{ handicap_index?: number | null; hide_from_profile?: boolean; playing?: boolean }> {
  if (!isRecord(body)) return { ok: false, error: 'A JSON body is required' };
  const out: { handicap_index?: number | null; hide_from_profile?: boolean; playing?: boolean } = {};
  for (const key of Object.keys(body)) if (!['handicap_index', 'hide_from_profile', 'playing'].includes(key)) return { ok: false, error: `Unknown field: ${key}` };
  if ('handicap_index' in body) {
    const v = body.handicap_index;
    if (v === null) out.handicap_index = null;
    else if (typeof v !== 'number' || !Number.isFinite(v) || v < -10 || v > 54) return { ok: false, error: 'handicap_index must be a number from -10.0 to 54.0, or null to clear' };
    else out.handicap_index = Math.round(v * 10) / 10;
  }
  if ('hide_from_profile' in body) {
    if (typeof body.hide_from_profile !== 'boolean') return { ok: false, error: 'hide_from_profile must be true or false' };
    out.hide_from_profile = body.hide_from_profile;
  }
  if ('playing' in body) {
    if (typeof body.playing !== 'boolean') return { ok: false, error: 'playing must be true or false' };
    out.playing = body.playing;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: 'Nothing to change' };
  return { ok: true, value: out };
}

export const LIST_SCOPES = ['mine', 'hosting', 'upcoming', 'live', 'past'] as const;
export type ListScope = (typeof LIST_SCOPES)[number];
export function parseListScope(v: string | null): ListScope {
  return (LIST_SCOPES as readonly string[]).includes(v ?? '') ? (v as ListScope) : 'mine';
}
