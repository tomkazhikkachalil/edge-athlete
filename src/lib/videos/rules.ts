/**
 * Videos (296) — the pure rules. Zero runtime imports (one type import, erased); every rule pinned by
 * src/lib/videos/__tests__/rules.test.ts.
 *
 * A linked video is owned by a profile XOR an org and may sit on a sport
 * event XOR a contest. Who may MANAGE it: the owner (or their guardian) for a
 * profile's video; anyone the org lets manage video (the ladder, or the
 * website section's grant) for an org's. Who may VIEW it: a manager always;
 * otherwise only a PUBLISHED video, and then whoever may see the owner —
 * the profile's privacy for a profile's video (the account decides, never a
 * per-video audience), the org's visibility for an org's. `hidden` is the
 * owner's "Only me" / the org's "Managers only".
 *
 * A highlight is a playback cue: a start in milliseconds, an optional end
 * (a label on the marker, never a clip boundary), a label, and sport
 * metadata. The list is ordered by start — "reorder" is editing the time.
 */

import type { OrgKind } from '@/lib/orgs/org-ref';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type VideoStatus = 'published' | 'hidden';
export const VIDEO_STATUSES: readonly VideoStatus[] = ['published', 'hidden'];

export const VIDEO_TITLE_MAX = 160;
export const VIDEO_DESCRIPTION_MAX = 2000;
export const VIDEO_URL_MAX = 2000;
export const HIGHLIGHT_LABEL_MAX = 120;
export const HIGHLIGHT_NOTE_MAX = 200;
/** 24 hours — longer than any broadcast, well inside int4 in milliseconds. */
export const HIGHLIGHT_MAX_MS = 24 * 3600 * 1000;
export const HIGHLIGHT_HOLE_MAX = 36;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── The rights ──────────────────────────────────────────────────────────────

export interface VideoRightFacts {
  viewerId: string | null;
  status: VideoStatus;
  owner: 'profile' | 'org';
  /** Profile-owned: the viewer is the profile. */
  isOwner?: boolean;
  /** Profile-owned: the viewer is an approved guardian of the profile. */
  isGuardian?: boolean;
  /** Profile-owned: the viewer may see the profile at all (its privacy, or public for a stranger). */
  profileCanView?: boolean;
  /** Org-owned: how the viewer reaches the org — public, a member, or not at all. */
  orgAccess?: 'public' | 'member' | null;
  /** Org-owned: the viewer holds the org's manage_video capability. */
  orgCanManage?: boolean;
}

export type VideoRight =
  | { allowed: true; via: 'owner' | 'guardian' | 'org' | 'public' | 'member' | 'viewer' }
  | { allowed: false; status: 401 | 403 | 404; error: string };

const NOT_FOUND: VideoRight = { allowed: false, status: 404, error: 'Video not found' };

/** May the viewer manage (edit, hide, delete, mark) this video? */
export function manageRight(f: VideoRightFacts): VideoRight {
  if (!f.viewerId) return { allowed: false, status: 401, error: 'Log in to manage videos.' };
  if (f.owner === 'profile') {
    if (f.isOwner) return { allowed: true, via: 'owner' };
    if (f.isGuardian) return { allowed: true, via: 'guardian' };
    return { allowed: false, status: 403, error: 'Only the profile owner can manage this video.' };
  }
  if (f.orgCanManage) return { allowed: true, via: 'org' };
  return { allowed: false, status: 403, error: 'Only the organization\'s managers can manage this video.' };
}

/** May the viewer see this video? A refusal is a 404 — the page never
 *  confirms a hidden or private video exists (the contest rule). */
export function viewRight(f: VideoRightFacts): VideoRight {
  const manage = manageRight(f);
  if (manage.allowed) return manage;
  if (f.status !== 'published') return NOT_FOUND;
  if (f.owner === 'profile') return f.profileCanView ? { allowed: true, via: 'viewer' } : NOT_FOUND;
  if (f.orgAccess === 'public') return { allowed: true, via: 'public' };
  if (f.orgAccess === 'member') return { allowed: true, via: 'member' };
  return NOT_FOUND;
}

export function videoRight(action: 'view' | 'manage', f: VideoRightFacts): VideoRight {
  return action === 'manage' ? manageRight(f) : viewRight(f);
}

// ── The bodies ──────────────────────────────────────────────────────────────

export interface HighlightMeta {
  hole?: number;
  score?: number;
  note?: string;
}

export interface HighlightInput {
  start_ms: number;
  end_ms: number | null;
  label: string;
  meta: HighlightMeta;
}

const HIGHLIGHT_KEYS = ['start_ms', 'end_ms', 'label', 'meta'] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function parseMs(v: unknown, field: string): Parsed<number> {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) return { ok: false, error: `${field} must be a whole number of milliseconds` };
  if (v < 0) return { ok: false, error: `${field} must be 0 or more` };
  if (v > HIGHLIGHT_MAX_MS) return { ok: false, error: `${field} must be within 24 hours` };
  return { ok: true, value: v };
}

/** The sport metadata — a closed vocabulary; unknown keys are refused, never stripped. */
export function parseHighlightMeta(raw: unknown): Parsed<HighlightMeta> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isPlainObject(raw)) return { ok: false, error: 'meta must be an object' };
  const out: HighlightMeta = {};
  for (const key of Object.keys(raw)) {
    const v = raw[key];
    if (v === undefined || v === null) continue;
    if (key === 'hole') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > HIGHLIGHT_HOLE_MAX) return { ok: false, error: `hole must be a whole number from 1 to ${HIGHLIGHT_HOLE_MAX}` };
      out.hole = v;
    } else if (key === 'score') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < -50 || v > 500) return { ok: false, error: 'score must be a whole number' };
      out.score = v;
    } else if (key === 'note') {
      if (typeof v !== 'string') return { ok: false, error: 'note must be text' };
      const t = v.trim();
      if (t.length > HIGHLIGHT_NOTE_MAX) return { ok: false, error: `note must be at most ${HIGHLIGHT_NOTE_MAX} characters` };
      if (t) out.note = t;
    } else {
      return { ok: false, error: `Unknown meta field: ${key}` };
    }
  }
  return { ok: true, value: out };
}

/** POST body of a highlight: every field, the range rule enforced here as in the DB. */
export function parseHighlightBody(body: unknown): Parsed<HighlightInput> {
  if (!isPlainObject(body)) return { ok: false, error: 'A JSON body is required' };
  for (const key of Object.keys(body)) if (!(HIGHLIGHT_KEYS as readonly string[]).includes(key)) return { ok: false, error: `Unknown field: ${key}` };
  const start = parseMs(body.start_ms, 'start_ms');
  if (!start.ok) return start;
  let end: number | null = null;
  if (body.end_ms !== undefined && body.end_ms !== null) {
    const e = parseMs(body.end_ms, 'end_ms');
    if (!e.ok) return e;
    if (e.value <= start.value) return { ok: false, error: 'end_ms must be after start_ms' };
    end = e.value;
  }
  if (typeof body.label !== 'string') return { ok: false, error: 'label is required' };
  const label = body.label.trim();
  if (!label) return { ok: false, error: 'label is required' };
  if (label.length > HIGHLIGHT_LABEL_MAX) return { ok: false, error: `label must be at most ${HIGHLIGHT_LABEL_MAX} characters` };
  const meta = parseHighlightMeta(body.meta);
  if (!meta.ok) return meta;
  return { ok: true, value: { start_ms: start.value, end_ms: end, label, meta: meta.value } };
}

/** PATCH body of a highlight: any subset; the range rule is checked against
 *  the stored row by the writer (`end_ms` alone must still be after the
 *  stored start). */
export function parseHighlightPatch(body: unknown): Parsed<Partial<HighlightInput>> {
  if (!isPlainObject(body)) return { ok: false, error: 'A JSON body is required' };
  const keys = Object.keys(body);
  if (keys.length === 0) return { ok: false, error: 'Nothing to change' };
  for (const key of keys) if (!(HIGHLIGHT_KEYS as readonly string[]).includes(key)) return { ok: false, error: `Unknown field: ${key}` };
  const out: Partial<HighlightInput> = {};
  if (body.start_ms !== undefined) {
    const s = parseMs(body.start_ms, 'start_ms');
    if (!s.ok) return s;
    out.start_ms = s.value;
  }
  if (body.end_ms !== undefined) {
    if (body.end_ms === null) out.end_ms = null;
    else {
      const e = parseMs(body.end_ms, 'end_ms');
      if (!e.ok) return e;
      out.end_ms = e.value;
    }
  }
  if (out.start_ms !== undefined && out.end_ms !== undefined && out.end_ms !== null && out.end_ms <= out.start_ms) return { ok: false, error: 'end_ms must be after start_ms' };
  if (body.label !== undefined) {
    if (typeof body.label !== 'string' || !body.label.trim()) return { ok: false, error: 'label is required' };
    const label = body.label.trim();
    if (label.length > HIGHLIGHT_LABEL_MAX) return { ok: false, error: `label must be at most ${HIGHLIGHT_LABEL_MAX} characters` };
    out.label = label;
  }
  if (body.meta !== undefined) {
    const meta = parseHighlightMeta(body.meta);
    if (!meta.ok) return meta;
    out.meta = meta.value;
  }
  return { ok: true, value: out };
}

/** The stored row + a patch → the range rule the DB will also enforce. */
export function highlightRangeOk(stored: { start_ms: number; end_ms: number | null }, patch: Partial<HighlightInput>): boolean {
  const start = patch.start_ms ?? stored.start_ms;
  const end = patch.end_ms === undefined ? stored.end_ms : patch.end_ms;
  return end === null || end > start;
}

export type VideoOwnerInput = { kind: 'profile'; profileId: string | null } | { kind: 'org'; side: OrgKind; orgId: string };

export interface VideoCreateInput {
  /** The pasted link, trimmed — the link helper turns it into an id. */
  url: string;
  title: string | null;
  description: string | null;
  sport_key: string | null;
  status: VideoStatus;
  owner: VideoOwnerInput;
  sport_event_id: string | null;
  contest_id: string | null;
}

const CREATE_KEYS = ['url', 'title', 'description', 'sport_key', 'status', 'profile_id', 'side', 'org_id', 'sport_event_id', 'contest_id'] as const;

function parseText(v: unknown, field: string, max: number): Parsed<string | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: `${field} must be text` };
  const t = v.trim();
  if (t.length > max) return { ok: false, error: `${field} must be at most ${max} characters` };
  return { ok: true, value: t || null };
}

function parseUuid(v: unknown, field: string): Parsed<string | null> {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  if (typeof v !== 'string' || !UUID.test(v)) return { ok: false, error: `${field} must be a uuid` };
  return { ok: true, value: v };
}

function parseStatus(v: unknown): Parsed<VideoStatus | null> {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (v !== 'published' && v !== 'hidden') return { ok: false, error: "status must be 'published' or 'hidden'" };
  return { ok: true, value: v };
}

/** POST /api/videos — the owner is an org when `side` + `org_id` are given,
 *  else the profile (`profile_id` = a guardian acting for an athlete, the
 *  posts pattern; absent = the session's own profile). A place is at most
 *  one of a sport event or a contest. */
export function parseVideoBody(body: unknown): Parsed<VideoCreateInput> {
  if (!isPlainObject(body)) return { ok: false, error: 'A JSON body is required' };
  for (const key of Object.keys(body)) if (!(CREATE_KEYS as readonly string[]).includes(key)) return { ok: false, error: `Unknown field: ${key}` };
  if (typeof body.url !== 'string' || !body.url.trim()) return { ok: false, error: 'Paste a YouTube link' };
  const url = body.url.trim();
  if (url.length > VIDEO_URL_MAX) return { ok: false, error: 'That link is too long' };
  const title = parseText(body.title, 'title', VIDEO_TITLE_MAX);
  if (!title.ok) return title;
  const description = parseText(body.description, 'description', VIDEO_DESCRIPTION_MAX);
  if (!description.ok) return description;
  const sport = parseText(body.sport_key, 'sport_key', 40);
  if (!sport.ok) return sport;
  const status = parseStatus(body.status);
  if (!status.ok) return status;
  const side = body.side;
  const orgId = parseUuid(body.org_id, 'org_id');
  if (!orgId.ok) return orgId;
  const profileId = parseUuid(body.profile_id, 'profile_id');
  if (!profileId.ok) return profileId;
  let owner: VideoOwnerInput;
  if (side !== undefined || orgId.value) {
    if (side !== 'league' && side !== 'club') return { ok: false, error: "side must be 'league' or 'club'" };
    if (!orgId.value) return { ok: false, error: 'org_id is required with side' };
    if (profileId.value) return { ok: false, error: 'A video is owned by a profile or an organization, not both' };
    owner = { kind: 'org', side, orgId: orgId.value };
  } else {
    owner = { kind: 'profile', profileId: profileId.value };
  }
  const eventId = parseUuid(body.sport_event_id, 'sport_event_id');
  if (!eventId.ok) return eventId;
  const contestId = parseUuid(body.contest_id, 'contest_id');
  if (!contestId.ok) return contestId;
  if (eventId.value && contestId.value) return { ok: false, error: 'A video sits on an event or a contest, not both' };
  return {
    ok: true,
    value: {
      url,
      title: title.value,
      description: description.value,
      sport_key: sport.value,
      status: status.value ?? 'published',
      owner,
      sport_event_id: eventId.value,
      contest_id: contestId.value,
    },
  };
}

export interface VideoPatch {
  title?: string;
  description?: string | null;
  sport_key?: string | null;
  status?: VideoStatus;
  sport_event_id?: string | null;
  contest_id?: string | null;
}

const PATCH_KEYS = ['title', 'description', 'sport_key', 'status', 'sport_event_id', 'contest_id'] as const;

/** PATCH /api/videos/[id] — any subset; the link itself never changes (a different video is a new row). */
export function parseVideoPatch(body: unknown): Parsed<VideoPatch> {
  if (!isPlainObject(body)) return { ok: false, error: 'A JSON body is required' };
  const keys = Object.keys(body);
  if (keys.length === 0) return { ok: false, error: 'Nothing to change' };
  for (const key of keys) if (!(PATCH_KEYS as readonly string[]).includes(key)) return { ok: false, error: `Unknown field: ${key}` };
  const out: VideoPatch = {};
  if (body.title !== undefined) {
    const t = parseText(body.title, 'title', VIDEO_TITLE_MAX);
    if (!t.ok) return t;
    if (!t.value) return { ok: false, error: 'title is required' };
    out.title = t.value;
  }
  if (body.description !== undefined) {
    const d = parseText(body.description, 'description', VIDEO_DESCRIPTION_MAX);
    if (!d.ok) return d;
    out.description = d.value;
  }
  if (body.sport_key !== undefined) {
    const s = parseText(body.sport_key, 'sport_key', 40);
    if (!s.ok) return s;
    out.sport_key = s.value;
  }
  if (body.status !== undefined) {
    const s = parseStatus(body.status);
    if (!s.ok) return s;
    if (s.value) out.status = s.value;
  }
  if (body.sport_event_id !== undefined) {
    const e = parseUuid(body.sport_event_id, 'sport_event_id');
    if (!e.ok) return e;
    out.sport_event_id = e.value;
  }
  if (body.contest_id !== undefined) {
    const c = parseUuid(body.contest_id, 'contest_id');
    if (!c.ok) return c;
    out.contest_id = c.value;
  }
  if (out.sport_event_id && out.contest_id) return { ok: false, error: 'A video sits on an event or a contest, not both' };
  return { ok: true, value: out };
}

/** The title when the person typed none. */
export function defaultVideoTitle(now: Date = new Date()): string {
  return `Full game · ${now.toISOString().slice(0, 10)}`;
}

/** `1:02:03` / `2:03` / `0:07` — the marker's time as a player shows it. */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** `1:30`, `90`, `1:02:03` typed by a person → milliseconds; null when it is not a time. */
export function parseTypedTimestamp(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  const parts = t.split(':');
  if (parts.length < 2 || parts.length > 3 || !parts.every(p => /^\d{1,2}$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some(n => n >= 60)) return null;
  const seconds = nums.length === 3 ? nums[0] * 3600 + nums[1] * 60 + nums[2] : nums[0] * 60 + nums[1];
  return seconds * 1000;
}
