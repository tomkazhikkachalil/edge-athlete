/**
 * A tag on a highlight (Sprint 3 PR 3, migration 307) — pure rules. One
 * runtime import: the sheets. A highlight may carry an EVENT (the game
 * sheet's: a made three, a goal, a takedown), its period and side, a value,
 * and the PEOPLE in it by role. The shape is checked here; what the event
 * and the roles may be is the sheet's (checkTag). Every stat is derived
 * from these fields (game-derive.ts) — nothing else is typed.
 * Pinned by src/lib/videos/__tests__/tag-rules.test.ts.
 */
import { sheetEvent, type GameSheet, type Side } from './game-sheets';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const TAG_PEOPLE_MAX = 12;
export const TAG_NAME_MAX = 80;
export const TAG_PERIOD_MAX = 99;
export const TAG_VALUE_MAX = 86_400_000;
/** Someone who is simply IN the clip: the clip is theirs, no stat is. Allowed on any highlight, game or not. */
export const ROLE_IN_CLIP = 'in_clip';

export interface TagPersonInput {
  profile_id: string | null;
  name: string | null;
  role: string;
  side: Side | null;
}

export interface TagInput {
  event_key: string | null;
  period: number | null;
  side: Side | null;
  value: number | null;
  people: TagPersonInput[];
}

export const TAG_KEYS = ['event_key', 'period', 'side', 'value', 'people'] as const;
export const EMPTY_TAG: TagInput = { event_key: null, period: null, side: null, value: null, people: [] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9_]{2,32}$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const none = (v: unknown): v is null | undefined => v === null || v === undefined;

function parseSide(v: unknown, field: string): Parsed<Side | null> {
  if (none(v)) return { ok: true, value: null };
  if (v !== 1 && v !== 2) return { ok: false, error: `${field} must be 1 or 2` };
  return { ok: true, value: v };
}

function wholeNumber(v: unknown, field: string, min: number, max: number): Parsed<number | null> {
  if (none(v)) return { ok: true, value: null };
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return { ok: false, error: `${field} must be a whole number from ${min} to ${max}` };
  return { ok: true, value: v };
}

export function parseTagPerson(raw: unknown): Parsed<TagPersonInput> {
  if (!isObject(raw)) return { ok: false, error: 'Each person must be an object' };
  for (const k of Object.keys(raw)) if (!['profile_id', 'name', 'role', 'side'].includes(k)) return { ok: false, error: `Unknown field on a person: ${k}` };
  const hasProfile = !none(raw.profile_id);
  const typed = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
  if (hasProfile && (typeof raw.profile_id !== 'string' || !UUID.test(raw.profile_id))) return { ok: false, error: 'profile_id must be a profile id' };
  if (!none(raw.name) && typeof raw.name !== 'string') return { ok: false, error: 'name must be text' };
  if (hasProfile && typed) return { ok: false, error: 'A person is a profile or a typed name, not both' };
  if (!hasProfile && !typed) return { ok: false, error: 'A person needs a profile or a name' };
  if (typed.length > TAG_NAME_MAX) return { ok: false, error: `A name is ${TAG_NAME_MAX} characters at most` };
  if (typeof raw.role !== 'string' || !KEY.test(raw.role)) return { ok: false, error: 'Each person needs a role' };
  const side = parseSide(raw.side, 'A person\'s side');
  if (!side.ok) return side;
  return { ok: true, value: { profile_id: hasProfile ? (raw.profile_id as string).toLowerCase() : null, name: hasProfile ? null : typed, role: raw.role, side: side.value } };
}

/** One key per person on a tag: the profile, or the name whatever its case. */
export function tagPersonKey(p: Pick<TagPersonInput, 'profile_id' | 'name'>): string {
  return p.profile_id ? `p:${p.profile_id}` : `n:${(p.name ?? '').toLowerCase()}`;
}

/** The tag fields of a highlight body — the shape only. Absent fields are null / nobody. */
export function parseTagFields(body: Record<string, unknown>): Parsed<TagInput> {
  let event_key: string | null = null;
  if (!none(body.event_key)) {
    if (typeof body.event_key !== 'string' || !KEY.test(body.event_key)) return { ok: false, error: 'event_key is not an event' };
    event_key = body.event_key;
  }
  const period = wholeNumber(body.period, 'period', 1, TAG_PERIOD_MAX);
  if (!period.ok) return period;
  const side = parseSide(body.side, 'side');
  if (!side.ok) return side;
  const value = wholeNumber(body.value, 'value', 0, TAG_VALUE_MAX);
  if (!value.ok) return value;
  const people: TagPersonInput[] = [];
  if (!none(body.people)) {
    if (!Array.isArray(body.people)) return { ok: false, error: 'people must be a list' };
    if (body.people.length > TAG_PEOPLE_MAX) return { ok: false, error: `A tag names ${TAG_PEOPLE_MAX} people at most` };
    const seen = new Set<string>();
    for (const raw of body.people) {
      const p = parseTagPerson(raw);
      if (!p.ok) return p;
      const key = `${tagPersonKey(p.value)}|${p.value.role}`;
      if (seen.has(key)) return { ok: false, error: 'The same person is in the same role twice' };
      seen.add(key);
      people.push(p.value);
    }
  }
  return { ok: true, value: { event_key, period: period.value, side: side.value, value: value.value, people } };
}

/**
 * The tag against the game's sheet (null = the video is not a game):
 *  - an event needs a game, and must be one of the sheet's;
 *  - an event that moves the board needs its side (whose point is it?);
 *  - a value only where the event takes one, inside its range;
 *  - each person's role is one of the event's (or `in_clip`), no more than the role allows.
 * A highlight with no event is a plain marker: people may still be `in_clip`.
 */
export function checkTag(sheet: GameSheet | null, tag: TagInput): Parsed<TagInput> {
  if (!tag.event_key) {
    if (tag.value !== null) return { ok: false, error: 'A value needs an event' };
    for (const p of tag.people) if (p.role !== ROLE_IN_CLIP) return { ok: false, error: 'Without an event, people can only be marked as in the clip' };
    return { ok: true, value: tag };
  }
  if (!sheet) return { ok: false, error: 'Add the game details before tagging events' };
  const event = sheetEvent(sheet, tag.event_key);
  if (!event) return { ok: false, error: 'That event is not one of this sport\'s' };
  const twoSided = sheet.family === 'team' || sheet.family === 'combat';
  if (!twoSided && tag.side !== null) return { ok: false, error: 'This sport has no sides' };
  if (twoSided && tag.side === null && (event.score || event.finish || event.roles.length > 0 || event.team)) return { ok: false, error: `Choose which ${sheet.sideNoun.toLowerCase()} this is for` };
  if (event.takesValue) {
    if (tag.value !== null && (tag.value < event.takesValue.min || tag.value > event.takesValue.max)) return { ok: false, error: `${event.takesValue.label} must be from ${event.takesValue.min} to ${event.takesValue.max}` };
    if (tag.value === null && event.takesValue.default === undefined) return { ok: false, error: `${event.takesValue.label} is needed for ${event.label.toLowerCase()}` };
  } else if (tag.value !== null) {
    return { ok: false, error: `${event.label} does not take a value` };
  }
  const counts = new Map<string, number>();
  for (const p of tag.people) {
    if (p.role === ROLE_IN_CLIP) continue;
    const role = event.roles.find(r => r.key === p.role);
    if (!role) return { ok: false, error: `${event.label} has no role "${p.role}"` };
    const n = (counts.get(p.role) ?? 0) + 1;
    if (n > (role.max ?? 1)) return { ok: false, error: `${event.label} takes ${role.max ?? 1} ${role.label.toLowerCase()}${(role.max ?? 1) === 1 ? '' : 's'} at most` };
    counts.set(p.role, n);
  }
  return { ok: true, value: tag };
}

/** The label a tag gets when the tagger typed none: the event's own name, with the scorer when there is one. */
export function defaultTagLabel(sheet: GameSheet | null, tag: Pick<TagInput, 'event_key'>, firstName?: string | null): string | null {
  const event = sheet ? sheetEvent(sheet, tag.event_key) : null;
  if (!event) return null;
  const who = firstName?.trim();
  return (who ? `${event.label} — ${who}` : event.label).slice(0, 120);
}

/** Nudge a time by a step, kept inside the video. */
export function nudgeMs(ms: number, deltaMs: number, durationMs: number | null): number {
  const top = durationMs && durationMs > 0 ? durationMs : TAG_VALUE_MAX;
  return Math.min(top, Math.max(0, Math.round(ms + deltaMs)));
}

/** The default clip around a moment: a few seconds before (the build-up), a few after. */
export const CLIP_LEAD_MS = 8_000;
export const CLIP_TAIL_MS = 4_000;
export function clipAround(momentMs: number, durationMs: number | null): { start_ms: number; end_ms: number } {
  const start = nudgeMs(momentMs, -CLIP_LEAD_MS, durationMs);
  const end = nudgeMs(momentMs, CLIP_TAIL_MS, durationMs);
  return { start_ms: start, end_ms: end > start ? end : start + 1_000 };
}
