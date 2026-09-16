/**
 * Event media, the I/O half (Events program, phase 4 — 216): the gallery
 * read (URLs through the media proxy as `sport_event` entities — the
 * proxy re-authorizes against the event's gate), and the completion
 * mirror into the round's post (`post_media`, `buildMirrorMedia` verbatim,
 * `segment_number` null, deduped on `media_url`, `mirrored_at` stamped so
 * a late upload re-mirrors once). Best-effort, like the golf mirror.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildMirrorMedia, type RoundMediaInput } from '@/lib/golf/round-mirror';
import { toProxyUrl } from '@/lib/media/proxy-url';
import { publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import { projectMedia, type EventMediaRow, type EventMediaView } from './media';
import type { SportEventRoundRow, SportEventRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export const MEDIA_COLUMNS = 'id, sport_event_id, sport_event_round_id, uploaded_by, created_by_user_id, media_url, media_type, thumbnail_url, duration_seconds, caption, mirrored_at, created_at';

export async function readEventMedia(admin: Admin, event: SportEventRow, viewer: { profileId: string | null; canManage: boolean }): Promise<EventMediaView[]> {
  const { data, error } = await admin.from('sport_event_media').select(MEDIA_COLUMNS).eq('sport_event_id', event.id).order('created_at', { ascending: false }).limit(500);
  if (error) {
    console.error('[sport-events media] read failed:', error);
    return [];
  }
  const rows = (data ?? []) as EventMediaRow[];
  const ids = [...new Set(rows.map(r => r.uploaded_by))];
  const { data: profs } = ids.length > 0 ? await admin.from('profiles').select('id, first_name, last_name, full_name, visibility, email, supervision_state, handle, avatar_url').in('id', ids) : { data: [] };
  const names = new Map(((profs ?? []) as Array<MaskableProfile & { id: string; avatar_url: string | null }>).map(p => [p.id, { name: publicDisplayName(p), avatar_url: p.avatar_url }]));
  return projectMedia(rows, names, { profileId: viewer.profileId, canManage: viewer.canManage, eventStatus: event.status }).map(v => ({
    ...v,
    media_url: toProxyUrl(v.media_url, { type: 'sport_event', id: v.id }) ?? v.media_url,
    thumbnail_url: v.thumbnail_url ? toProxyUrl(v.thumbnail_url, { type: 'sport_event', id: v.id }) ?? v.thumbnail_url : null,
  }));
}

/** At completion: this round's rows + the event-level rows not yet mirrored → the round's post's `post_media`. */
export async function mirrorEventMedia(admin: Admin, event: Pick<SportEventRow, 'id'>, round: Pick<SportEventRoundRow, 'id'>): Promise<void> {
  try {
    const { data: post } = await admin.from('posts').select('id').eq('sport_event_round_id', round.id).maybeSingle();
    if (!post?.id) return;
    const { data: rows, error } = await admin.from('sport_event_media').select(MEDIA_COLUMNS).eq('sport_event_id', event.id).is('mirrored_at', null).or(`sport_event_round_id.eq.${round.id},sport_event_round_id.is.null`);
    if (error || !rows || rows.length === 0) return;
    const media = rows as EventMediaRow[];
    const { data: existing } = await admin.from('post_media').select('media_url, display_order').eq('post_id', post.id);
    const startOrder = ((existing ?? []) as Array<{ display_order: number | null }>).reduce((max, m) => Math.max(max, m.display_order ?? 0), 0) + 1;
    const inputs: RoundMediaInput[] = media.map(m => ({ media_url: m.media_url, media_type: m.media_type, segment_number: null, created_at: m.created_at, thumbnail_url: m.thumbnail_url }));
    const toInsert = buildMirrorMedia(inputs, ((existing ?? []) as Array<{ media_url: string }>).map(m => m.media_url), startOrder);
    if (toInsert.length > 0) {
      const { error: insertError } = await admin.from('post_media').insert(toInsert.map(r => ({ ...r, post_id: post.id })));
      if (insertError) { console.error('[sport-events media] mirror insert failed:', insertError); return; }
    }
    const { error: stampError } = await admin.from('sport_event_media').update({ mirrored_at: new Date().toISOString() }).in('id', media.map(m => m.id));
    if (stampError) console.error('[sport-events media] mirror stamp failed:', stampError);
  } catch (e) {
    console.error('[sport-events media] mirror failed:', e);
  }
}
