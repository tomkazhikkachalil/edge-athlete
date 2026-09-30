// ── The ONE writer of activities (245) ──────────────────────────────────────
// Every import — a GPX/TCX payload from the browser, a FIT decoded on the
// server, later a provider's delivery — lands here as a NormalizedActivity.
// The server recomputes every total (normalize.summarize), refuses the
// implausible with the reason, and writes the stream to storage BEFORE the
// row (a row never points at a missing stream; a failed row write removes
// the object it just wrote). A re-import of the same activity (the dedupe
// key: the start second) refreshes the data and keeps what the athlete
// chose — the name, the type, "Only me", the feed post.

import { gzipSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidTimeZone } from '@/lib/calendar/time-zones';
import { cleanPoints, defaultActivityName, fileExternalId, implausibility, localParts, summarize } from './normalize';
import { buildStream, routePreview } from './stream';
import type { NormalizedActivity } from './types';

type Admin = SupabaseClient;

export const STREAM_BUCKET = 'uploads';
/** Bare paths under this prefix are kept alive by storage-sweep's PROTECTED_PREFIXES. */
export const ACTIVITY_STREAM_PREFIX = 'activities/';

export function streamPathFor(profileId: string, activityId: string): string {
  return `${ACTIVITY_STREAM_PREFIX}${profileId}/${activityId}.json.gz`;
}

export type ImportOutcome =
  | { ok: true; id: string; duplicate: boolean }
  | { ok: false; status: 400 | 409 | 422 | 500; error: string };

export async function importActivity(
  admin: Admin,
  profileId: string,
  n: NormalizedActivity,
  opts: { timeZone: string | null; now?: number }
): Promise<ImportOutcome> {
  const cleaned = cleanPoints(n);
  if (cleaned.length < 2) return { ok: false, status: 422, error: 'This file has too few samples to be an activity.' };
  const summary = summarize(n, cleaned);
  const why = implausibility(n, summary, opts.now);
  if (why) return { ok: false, status: 422, error: why };

  const timeZone = opts.timeZone && isValidTimeZone(opts.timeZone) ? opts.timeZone : null;
  const local = localParts(summary.startedAt, n.tzOffsetMin, timeZone);
  const externalId = fileExternalId(summary.startedAt);

  const { data: existing, error: readError } = await admin
    .from('activities')
    .select('id')
    .eq('profile_id', profileId)
    .eq('source', 'file')
    .eq('external_id', externalId)
    .maybeSingle();
  if (readError) {
    console.error('[activities] dedupe read failed:', readError.message);
    return { ok: false, status: 500, error: 'Could not save the activity.' };
  }

  const id: string = existing?.id ?? crypto.randomUUID();
  const stream = buildStream(cleaned);
  const path = streamPathFor(profileId, id);
  const { error: upErr } = await admin.storage
    .from(STREAM_BUCKET)
    .upload(path, gzipSync(Buffer.from(JSON.stringify(stream))), { contentType: 'application/gzip', upsert: true });
  if (upErr) {
    console.error('[activities] stream upload failed:', upErr.message);
    return { ok: false, status: 500, error: 'Could not save the activity.' };
  }

  const data = {
    source_format: n.format,
    started_at: new Date(summary.startedAt).toISOString(),
    timezone: timeZone,
    occurred_on: local.date,
    elapsed_s: summary.elapsedS,
    moving_s: summary.movingS,
    distance_m: summary.distanceM,
    elev_gain_m: summary.elevGainM,
    elev_loss_m: summary.elevLossM,
    avg_hr: summary.avgHr,
    max_hr: summary.maxHr,
    avg_power: summary.avgPower,
    avg_cadence: summary.avgCadence,
    calories: summary.calories,
    has_route: summary.hasRoute,
    route_preview: summary.hasRoute ? routePreview(stream) : null,
    stream_path: path,
  };

  if (existing) {
    const { error } = await admin.from('activities').update(data).eq('id', id).eq('profile_id', profileId);
    if (error) {
      console.error('[activities] refresh failed:', error.message);
      return { ok: false, status: 500, error: 'Could not save the activity.' };
    }
    return { ok: true, id, duplicate: true };
  }

  const { error: insErr } = await admin.from('activities').insert({
    id,
    profile_id: profileId,
    activity_type: n.type,
    source: 'file',
    external_id: externalId,
    name: (n.name && n.name.trim()) || defaultActivityName(n.type, local.hour),
    ...data,
  });
  if (insErr) {
    // The object we just wrote belongs to no row now.
    await admin.storage.from(STREAM_BUCKET).remove([path]);
    if (insErr.code === '23505') {
      // Two tabs imported the same file at once: the other one won.
      const { data: winner } = await admin
        .from('activities')
        .select('id')
        .eq('profile_id', profileId)
        .eq('source', 'file')
        .eq('external_id', externalId)
        .maybeSingle();
      if (winner?.id) return { ok: true, id: winner.id as string, duplicate: true };
      return { ok: false, status: 409, error: 'This activity was just imported — reload to see it.' };
    }
    console.error('[activities] insert failed:', insErr.message);
    return { ok: false, status: 500, error: 'Could not save the activity.' };
  }
  return { ok: true, id, duplicate: false };
}

/** Delete an activity: its stream, its feed post (the athlete confirmed
 *  both), then the row. The caller has already authorized the owner. */
export async function deleteActivity(admin: Admin, row: { id: string; profile_id: string; stream_path: string | null; post_id: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (row.post_id) {
    const { error } = await admin.from('posts').delete().eq('id', row.post_id).eq('profile_id', row.profile_id);
    if (error) {
      console.error('[activities] post delete failed:', error.message);
      return { ok: false, error: 'Could not delete the feed post for this activity.' };
    }
  }
  const { error } = await admin.from('activities').delete().eq('id', row.id).eq('profile_id', row.profile_id);
  if (error) {
    console.error('[activities] delete failed:', error.message);
    return { ok: false, error: 'Could not delete the activity.' };
  }
  if (row.stream_path) {
    // After the row: a failed remove leaves an orphan under a protected
    // prefix (logged), never a row pointing at nothing.
    const { error: rmErr } = await admin.storage.from(STREAM_BUCKET).remove([row.stream_path]);
    if (rmErr) console.error('[activities] stream remove failed (orphan left):', row.stream_path, rmErr.message);
  }
  return { ok: true };
}
