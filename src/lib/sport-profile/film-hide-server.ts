/**
 * What an athlete hid from their own page (migration 311, Sprint 4 PR 6a) —
 * the one reader and writer of `profile_film_hidden`. Server only. Tom, Nov
 * 15 2026: a game or a single clip can be hidden from the athlete's page;
 * the stat still counts. A database without the table answers "nothing
 * hidden" / "not available here yet".
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-agnostic helper, as in game-distinct-server.ts
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[SPORT PROFILE hide]';
const isMissing = (code: string | undefined) => code === '42P01' || code === 'PGRST205';
export const FILM_HIDDEN_MAX = 2000;

export interface FilmHidden { games: Set<string>; clips: Set<string> }

/** The videos (whole games) and the highlights (clips) this athlete hid. */
export async function readFilmHidden(admin: Admin, profileId: string): Promise<FilmHidden> {
  const out: FilmHidden = { games: new Set(), clips: new Set() };
  const { data, error } = await admin.from('profile_film_hidden').select('video_id, highlight_id').eq('profile_id', profileId).limit(FILM_HIDDEN_MAX);
  if (error) {
    if (!isMissing(error.code)) console.error(`${TAG} read failed:`, error.message);
    return out;
  }
  for (const r of (data ?? []) as Array<{ video_id: string; highlight_id: string | null }>) {
    if (r.highlight_id) out.clips.add(r.highlight_id);
    else out.games.add(r.video_id);
  }
  return out;
}

export type HideOutcome = { ok: true } | { ok: false; status: 404 | 500 | 503; error: string };

/**
 * Hide (or show again) a game or one clip on the athlete's own page. Only
 * something the athlete is actually tagged in can be hidden — anything else
 * is a 404, never a row. Hiding twice is hiding once.
 */
export async function setFilmHidden(admin: Admin, profileId: string, userId: string, target: { videoId: string; highlightId: string | null; hidden: boolean }): Promise<HideOutcome> {
  let tagged = admin.from('video_highlight_people').select('id').eq('profile_id', profileId).eq('video_id', target.videoId).eq('status', 'active').limit(1);
  if (target.highlightId) tagged = tagged.eq('highlight_id', target.highlightId);
  const { data: on, error: onError } = await tagged;
  if (onError) {
    console.error(`${TAG} tag check failed:`, onError.message);
    return { ok: false, status: 500, error: 'Could not save that' };
  }
  if (!on || on.length === 0) return { ok: false, status: 404, error: 'That is not on this profile' };

  if (!target.hidden) {
    let del = admin.from('profile_film_hidden').delete().eq('profile_id', profileId).eq('video_id', target.videoId);
    del = target.highlightId ? del.eq('highlight_id', target.highlightId) : del.is('highlight_id', null);
    const { error } = await del;
    if (error && !isMissing(error.code)) {
      console.error(`${TAG} delete failed:`, error.message);
      return { ok: false, status: 500, error: 'Could not save that' };
    }
    return { ok: true };
  }
  const { error } = await admin.from('profile_film_hidden').insert({ profile_id: profileId, video_id: target.videoId, highlight_id: target.highlightId, created_by_user_id: userId });
  if (error && error.code !== '23505') {
    if (isMissing(error.code)) return { ok: false, status: 503, error: 'This is not available here yet' };
    console.error(`${TAG} insert failed:`, error.message);
    return { ok: false, status: 500, error: 'Could not save that' };
  }
  return { ok: true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST …/film-hidden {video_id, highlight_id?, hidden}. */
export function parseHideBody(body: unknown): { ok: true; value: { videoId: string; highlightId: string | null; hidden: boolean } } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.video_id !== 'string' || !UUID.test(b.video_id)) return { ok: false, error: 'Choose the game' };
  if (b.highlight_id != null && (typeof b.highlight_id !== 'string' || !UUID.test(b.highlight_id))) return { ok: false, error: 'That is not a clip' };
  if (typeof b.hidden !== 'boolean') return { ok: false, error: 'Say whether to hide it' };
  return { ok: true, value: { videoId: b.video_id.toLowerCase(), highlightId: typeof b.highlight_id === 'string' ? b.highlight_id.toLowerCase() : null, hidden: b.hidden } };
}
