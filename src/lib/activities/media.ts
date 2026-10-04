// ── Activity photos (251) — the pure rules ──────────────────────────────────
// A photo or clip taken during a recording (a tile at once, the pencil
// after) or added on the activity page. ADD / EDIT / REMOVE are the OWNER's
// (the athlete or a guardian acting for them) — the activity's one gate
// decides who may VIEW (read-server.ts). The file is uploaded through the
// one media door (uploadPostMedia → posts/<owner>/…), so the stored URL must
// parse to that prefix for THIS profile — no one attaches another athlete's
// bytes, and the sweep keeps the file alive through URL_SOURCE_COLUMNS.

import { parsePublicUrl } from '@/lib/media/proxy-url';

export const ACTIVITY_MEDIA_MAX = 20;
export const ACTIVITY_MEDIA_CAPTION_MAX = 500;
export const ACTIVITY_MEDIA_URL_MAX = 2000;
/** 48 h, the activities table's own ceiling for a duration. */
export const ACTIVITY_MEDIA_AT_MAX_S = 172_800;

export interface ActivityMediaInput {
  media_url: string;
  media_type: 'image' | 'video';
  thumbnail_url: string | null;
  duration_seconds: number | null;
  caption: string | null;
  at_s: number | null;
}

export type ParsedMedia<T> = { ok: true; value: T } | { ok: false; error: string };

/** A stored `uploads` URL under THIS profile's posts/ prefix (the direct upload's final key). */
export function isOwnUploadUrl(url: string, profileId: string): boolean {
  const parsed = parsePublicUrl(url);
  return !!parsed && parsed.bucket === 'uploads' && parsed.key.startsWith(`posts/${profileId}/`);
}

function parseUrl(raw: unknown, field: string, profileId: string): ParsedMedia<string> {
  if (typeof raw !== 'string') return { ok: false, error: `${field} must be the uploaded file's URL` };
  const url = raw.trim();
  if (!url || url.length > ACTIVITY_MEDIA_URL_MAX || !/^https:\/\//.test(url)) return { ok: false, error: `${field} must be the uploaded file's URL` };
  if (!isOwnUploadUrl(url, profileId)) return { ok: false, error: `${field} must be a file you uploaded` };
  return { ok: true, value: url };
}

/** The POST body after `uploadPostMedia`. `profileId` is the acting profile — the owner. */
export function parseActivityMediaBody(body: unknown, profileId: string): ParsedMedia<ActivityMediaInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'A JSON body is required' };
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (!['media_url', 'media_type', 'thumbnail_url', 'duration_seconds', 'caption', 'at_s', 'targetProfileId'].includes(key)) return { ok: false, error: `Unknown field: ${key}` };
  }
  const url = parseUrl(b.media_url, 'media_url', profileId);
  if (!url.ok) return url;
  if (b.media_type !== 'image' && b.media_type !== 'video') return { ok: false, error: "media_type must be 'image' or 'video'" };
  let thumbnail: string | null = null;
  if (b.thumbnail_url !== undefined && b.thumbnail_url !== null) {
    const t = parseUrl(b.thumbnail_url, 'thumbnail_url', profileId);
    if (!t.ok) return t;
    thumbnail = t.value;
  }
  let duration: number | null = null;
  if (b.duration_seconds !== undefined && b.duration_seconds !== null) {
    if (typeof b.duration_seconds !== 'number' || !Number.isFinite(b.duration_seconds) || b.duration_seconds <= 0 || b.duration_seconds > 86_400) return { ok: false, error: 'duration_seconds must be a positive number' };
    duration = Math.round(b.duration_seconds * 100) / 100;
  }
  const caption = parseCaption(b.caption);
  if (!caption.ok) return caption;
  const at = parseAt(b.at_s);
  if (!at.ok) return at;
  return { ok: true, value: { media_url: url.value, media_type: b.media_type, thumbnail_url: thumbnail, duration_seconds: duration, caption: caption.value, at_s: at.value } };
}

export function parseCaption(raw: unknown): ParsedMedia<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'caption must be text' };
  const t = raw.trim();
  if (t.length > ACTIVITY_MEDIA_CAPTION_MAX) return { ok: false, error: `caption must be at most ${ACTIVITY_MEDIA_CAPTION_MAX} characters` };
  return { ok: true, value: t.length > 0 ? t : null };
}

export function parseAt(raw: unknown): ParsedMedia<number | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > ACTIVITY_MEDIA_AT_MAX_S) return { ok: false, error: 'at_s must be whole seconds into the activity' };
  return { ok: true, value: raw };
}

/** The PATCH body: a caption, a moment, or a re-rendered file (the pencil). */
export function parseActivityMediaPatch(body: unknown, profileId: string): ParsedMedia<Partial<Pick<ActivityMediaInput, 'caption' | 'at_s' | 'media_url' | 'thumbnail_url'>>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'A JSON body is required' };
  const b = body as Record<string, unknown>;
  const out: Partial<Pick<ActivityMediaInput, 'caption' | 'at_s' | 'media_url' | 'thumbnail_url'>> = {};
  for (const key of Object.keys(b)) {
    if (!['caption', 'at_s', 'media_url', 'thumbnail_url', 'targetProfileId'].includes(key)) return { ok: false, error: `Unknown field: ${key}` };
  }
  if ('caption' in b) {
    const c = parseCaption(b.caption);
    if (!c.ok) return c;
    out.caption = c.value;
  }
  if ('at_s' in b) {
    const a = parseAt(b.at_s);
    if (!a.ok) return a;
    out.at_s = a.value;
  }
  if ('media_url' in b) {
    const u = parseUrl(b.media_url, 'media_url', profileId);
    if (!u.ok) return u;
    out.media_url = u.value;
  }
  if ('thumbnail_url' in b) {
    if (b.thumbnail_url === null) out.thumbnail_url = null;
    else {
      const t = parseUrl(b.thumbnail_url, 'thumbnail_url', profileId);
      if (!t.ok) return t;
      out.thumbnail_url = t.value;
    }
  }
  if (Object.keys(out).length === 0) return { ok: false, error: 'Nothing to change' };
  return { ok: true, value: out };
}
