/**
 * Event media (Events program, phase 4 — 216 `sport_event_media`) — pure.
 * Tom: anyone who joined (playing or following) adds photos / videos; a
 * live gallery on the event page; the media rides the round's results
 * post under the existing consent gates. Rights: ADD = any accepted row of
 * any role (followers included) or an organizer, while the event is not
 * cancelled; REMOVE = the uploader or an organizer. Everyone who may view
 * the event may view its gallery (a public event: signed out too).
 */
import type { SportEventRole, SportEventStatus } from './types';
import type { Parsed } from './validate';

export const MEDIA_CAPTION_MAX = 500;
export const MEDIA_URL_MAX = 2000;

export interface MediaRightInput {
  viewerId: string | null;
  eventStatus: SportEventStatus;
  eventRole: SportEventRole | 'viewer' | null;
  participantStatus: string | null;
  canManage: boolean;
  /** The row's uploader (remove only). */
  uploadedBy?: string | null;
}

export type MediaRight = { allowed: true; via: 'organizer' | 'participant' | 'uploader' } | { allowed: false; status: 401 | 403 | 409; error: string };

export function mediaRight(action: 'add' | 'remove', i: MediaRightInput): MediaRight {
  if (!i.viewerId) return { allowed: false, status: 401, error: 'Log in to add photos.' };
  if (action === 'add') {
    if (i.eventStatus === 'cancelled') return { allowed: false, status: 409, error: 'This event was cancelled.' };
    if (i.canManage) return { allowed: true, via: 'organizer' };
    if (i.participantStatus === 'accepted') return { allowed: true, via: 'participant' };
    return { allowed: false, status: 403, error: 'Join or follow the event to add photos.' };
  }
  if (i.canManage) return { allowed: true, via: 'organizer' };
  if (i.uploadedBy && i.uploadedBy === i.viewerId) return { allowed: true, via: 'uploader' };
  return { allowed: false, status: 403, error: 'Only the person who added it, or an organizer, can remove a photo.' };
}

export interface MediaInput {
  media_url: string;
  media_type: 'image' | 'video';
  thumbnail_url: string | null;
  duration_seconds: number | null;
  caption: string | null;
  round_id: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The POST body after `uploadPostMedia`: the stored URL (the `uploads` bucket), its type, an optional poster / duration / caption / round. */
export function parseMediaBody(body: unknown): Parsed<MediaInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'A JSON body is required' };
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) if (!['media_url', 'media_type', 'thumbnail_url', 'duration_seconds', 'caption', 'round_id', 'profile_id'].includes(key)) return { ok: false, error: `Unknown field: ${key}` };
  const url = typeof b.media_url === 'string' ? b.media_url.trim() : '';
  if (!url || url.length > MEDIA_URL_MAX || !/^https?:\/\//.test(url)) return { ok: false, error: 'media_url must be the uploaded file\'s URL' };
  if (b.media_type !== 'image' && b.media_type !== 'video') return { ok: false, error: "media_type must be 'image' or 'video'" };
  let thumbnail: string | null = null;
  if (b.thumbnail_url !== undefined && b.thumbnail_url !== null) {
    if (typeof b.thumbnail_url !== 'string' || b.thumbnail_url.trim().length === 0 || b.thumbnail_url.length > MEDIA_URL_MAX || !/^https?:\/\//.test(b.thumbnail_url.trim())) return { ok: false, error: 'thumbnail_url must be an uploaded file\'s URL' };
    thumbnail = b.thumbnail_url.trim();
  }
  let duration: number | null = null;
  if (b.duration_seconds !== undefined && b.duration_seconds !== null) {
    if (typeof b.duration_seconds !== 'number' || !Number.isFinite(b.duration_seconds) || b.duration_seconds <= 0 || b.duration_seconds > 86_400) return { ok: false, error: 'duration_seconds must be a positive number' };
    duration = Math.round(b.duration_seconds * 100) / 100;
  }
  let caption: string | null = null;
  if (b.caption !== undefined && b.caption !== null) {
    if (typeof b.caption !== 'string') return { ok: false, error: 'caption must be text' };
    const t = b.caption.trim();
    if (t.length > MEDIA_CAPTION_MAX) return { ok: false, error: `caption must be at most ${MEDIA_CAPTION_MAX} characters` };
    caption = t.length > 0 ? t : null;
  }
  let roundId: string | null = null;
  if (b.round_id !== undefined && b.round_id !== null && b.round_id !== '') {
    if (typeof b.round_id !== 'string' || !UUID.test(b.round_id)) return { ok: false, error: 'round_id must be a uuid' };
    roundId = b.round_id;
  }
  return { ok: true, value: { media_url: url, media_type: b.media_type, thumbnail_url: thumbnail, duration_seconds: duration, caption, round_id: roundId } };
}

export interface EventMediaRow {
  id: string;
  sport_event_id: string;
  sport_event_round_id: string | null;
  uploaded_by: string;
  created_by_user_id: string | null;
  media_url: string;
  media_type: 'image' | 'video';
  thumbnail_url: string | null;
  duration_seconds: number | null;
  caption: string | null;
  mirrored_at: string | null;
  created_at: string;
}

export interface EventMediaView {
  id: string;
  round_id: string | null;
  media_url: string;
  media_type: 'image' | 'video';
  thumbnail_url: string | null;
  duration_seconds: number | null;
  caption: string | null;
  created_at: string;
  uploader: { profile_id: string; name: string; avatar_url: string | null };
  mine: boolean;
  can_remove: boolean;
}

/** Newest first; `can_remove` from the remove right. The URLs are the caller's (the server proxies them). */
export function projectMedia(rows: ReadonlyArray<EventMediaRow>, names: ReadonlyMap<string, { name: string; avatar_url: string | null }>, viewer: { profileId: string | null; canManage: boolean; eventStatus: SportEventStatus }): EventMediaView[] {
  return [...rows]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
    .map(r => {
      const who = names.get(r.uploaded_by) ?? { name: 'Athlete', avatar_url: null };
      const remove = mediaRight('remove', { viewerId: viewer.profileId, eventStatus: viewer.eventStatus, eventRole: null, participantStatus: null, canManage: viewer.canManage, uploadedBy: r.uploaded_by });
      return {
        id: r.id,
        round_id: r.sport_event_round_id,
        media_url: r.media_url,
        media_type: r.media_type,
        thumbnail_url: r.thumbnail_url,
        duration_seconds: r.duration_seconds,
        caption: r.caption,
        created_at: r.created_at,
        uploader: { profile_id: r.uploaded_by, name: who.name, avatar_url: who.avatar_url },
        mine: viewer.profileId !== null && viewer.profileId === r.uploaded_by,
        can_remove: remove.allowed,
      };
    });
}
