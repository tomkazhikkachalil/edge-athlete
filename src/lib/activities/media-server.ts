// ── Activity photos (251), the I/O half ────────────────────────────────────
// The read hands the projection rows whose URLs already go through the media
// proxy as `activity` entities (authorize.ts re-runs the activity's gate per
// byte); the mirror copies the rows into the shared post's `post_media` on
// "Share to feed" (the event-media pattern verbatim: `buildMirrorMedia`,
// deduped on `media_url`, `mirrored_at` stamped so a later photo re-mirrors
// once). Best-effort, like every mirror here.

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildMirrorMedia, type RoundMediaInput } from '@/lib/golf/round-mirror';
import { toProxyUrl } from '@/lib/media/proxy-url';
import type { ActivityMediaRow } from './visibility';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export const ACTIVITY_MEDIA_COLUMNS = 'id, activity_id, media_url, media_type, thumbnail_url, duration_seconds, caption, at_s, display_order, mirrored_at, created_at';

/** The activity's photos with proxied URLs — the projection adds the pins. */
export async function readActivityMedia(admin: Admin, activityId: string): Promise<ActivityMediaRow[]> {
  const { data, error } = await admin.from('activity_media').select(ACTIVITY_MEDIA_COLUMNS).eq('activity_id', activityId).order('display_order').order('created_at').limit(100);
  if (error) {
    console.error('[activities media] read failed:', error.message);
    return [];
  }
  return ((data ?? []) as ActivityMediaRow[]).map(r => ({
    ...r,
    media_url: toProxyUrl(r.media_url, { type: 'activity', id: r.id }) ?? r.media_url,
    thumbnail_url: r.thumbnail_url ? toProxyUrl(r.thumbnail_url, { type: 'activity', id: r.id }) ?? r.thumbnail_url : null,
  }));
}

/** On share: every not-yet-mirrored photo → the post's `post_media`. */
export async function mirrorActivityMedia(admin: Admin, activityId: string, postId: string): Promise<void> {
  try {
    const { data: rows, error } = await admin.from('activity_media').select(ACTIVITY_MEDIA_COLUMNS).eq('activity_id', activityId).is('mirrored_at', null);
    if (error || !rows || rows.length === 0) return;
    const media = rows as ActivityMediaRow[];
    const { data: existing } = await admin.from('post_media').select('media_url, display_order').eq('post_id', postId);
    const startOrder = ((existing ?? []) as Array<{ display_order: number | null }>).reduce((max, m) => Math.max(max, m.display_order ?? 0), 0) + 1;
    const inputs: RoundMediaInput[] = media
      .slice()
      .sort((a, b) => a.display_order - b.display_order || (a.at_s ?? Infinity) - (b.at_s ?? Infinity))
      .map(m => ({ media_url: m.media_url, media_type: m.media_type, segment_number: null, created_at: m.created_at, thumbnail_url: m.thumbnail_url }));
    const toInsert = buildMirrorMedia(inputs, ((existing ?? []) as Array<{ media_url: string }>).map(m => m.media_url), startOrder);
    if (toInsert.length > 0) {
      const { error: insertError } = await admin.from('post_media').insert(toInsert.map(r => ({ ...r, post_id: postId })));
      if (insertError) {
        console.error('[activities media] mirror insert failed:', insertError.message);
        return;
      }
    }
    const { error: stampError } = await admin.from('activity_media').update({ mirrored_at: new Date().toISOString() }).in('id', media.map(m => m.id));
    if (stampError) console.error('[activities media] mirror stamp failed:', stampError.message);
  } catch (e) {
    console.error('[activities media] mirror failed:', e);
  }
}
