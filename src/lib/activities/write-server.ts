// ── The ONE writer of activities (245) ──────────────────────────────────────
// Every import — a GPX/TCX payload from the browser, a FIT decoded on the
// server, later a provider's delivery — lands here as a NormalizedActivity.
// The server recomputes every total (normalize.summarize), refuses the
// implausible with the reason, and writes the stream to storage BEFORE the
// row (a row never points at a missing stream; a failed row write removes
// the object it just wrote). A re-import of the same activity (the dedupe
// key: the source's own id, for a file the start second) refreshes the data
// and keeps what the athlete chose — the name, the type, "Only me", the feed
// post. The SAME activity arriving from a second source (mig 247: a
// provider, the upload link, a file) is still one activity — dedupe.ts.

import { gzipSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidTimeZone } from '@/lib/calendar/time-zones';
import type { ActivitySource } from './catalog';
import { DEDUPE_START_WINDOW_S, findDuplicate, incomingIsRicher } from './dedupe';
import { cleanPoints, defaultActivityName, estimateSteps, fileExternalId, implausibility, localParts, summarize } from './normalize';
import { normalizeSegments, segmentsFromRow, type ActivitySegment } from './segments';
import { buildStream, routePreview } from './stream';
import { liveRoute } from './gps-filter';
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
  opts: {
    timeZone: string | null;
    now?: number;
    /** Where it came from. Default: a file import. */
    source?: ActivitySource;
    /** The source's own id for the activity. Default (and a file's): the start second. */
    externalId?: string | null;
    /** The phone recorder (251): the segments marked during the recording. */
    live?: { segments: ActivitySegment[] };
    /** The acting profile's height, for the step estimate (null → the fallback stride). */
    heightCm?: number | null;
  }
): Promise<ImportOutcome> {
  const source0: ActivitySource = opts.source ?? 'file';
  const raw = cleanPoints(n, { jumps: source0 !== 'live' });
  // A LIVE recording is the phone's raw fixes: the GPS filter (gps-filter.ts)
  // draws and totals it exactly as the phone did; the raw fixes are kept,
  // server-only, for re-processing. A watch or file was smoothed by its device.
  const isLive = source0 === 'live';
  const cleaned = isLive ? liveRoute(raw, n.type) : raw;
  if (cleaned.length < 2) return { ok: false, status: 422, error: 'This file has too few samples to be an activity.' };
  const summary = summarize(n, cleaned);
  const why = implausibility(n, summary, opts.now);
  if (why) return { ok: false, status: 422, error: why };

  const timeZone = opts.timeZone && isValidTimeZone(opts.timeZone) ? opts.timeZone : null;
  const local = localParts(summary.startedAt, n.tzOffsetMin, timeZone);
  const source: ActivitySource = opts.source ?? 'file';
  const externalId = (opts.externalId && opts.externalId.trim().slice(0, 200)) || fileExternalId(summary.startedAt);
  // 251: the recorder's annotations — segments clamped to the SERVER's
  // elapsed seconds; steps estimated here, never taken from a client.
  const segments = opts.live ? normalizeSegments(opts.live.segments, summary.elapsedS) : null;
  const steps = estimateSteps(n.type, summary.distanceM, summary.movingS, opts.heightCm ?? null);
  const annotations: Record<string, unknown> = {
    ...(segments ? { segments } : {}),
    steps,
    steps_source: steps === null ? null : 'estimated',
  };

  // 1. The same source delivering the same id: a refresh.
  const { data: exact, error: readError } = await admin
    .from('activities')
    .select('id')
    .eq('profile_id', profileId)
    .eq('source', source)
    .eq('external_id', externalId)
    .maybeSingle();
  if (readError) {
    console.error('[activities] dedupe read failed:', readError.message);
    return { ok: false, status: 500, error: 'Could not save the activity.' };
  }
  let existing: { id: string } | null = exact ? { id: exact.id as string } : null;

  // 2. The same activity from ANOTHER delivery (dedupe.ts): one row. Its data
  //    is replaced only by a richer copy; otherwise what is stored stands.
  if (!existing) {
    const windowMs = DEDUPE_START_WINDOW_S * 1000;
    const { data: near, error: nearError } = await admin
      .from('activities')
      .select('id, started_at, elapsed_s, has_route, avg_hr, segments')
      .eq('profile_id', profileId)
      .gte('started_at', new Date(summary.startedAt - windowMs).toISOString())
      .lte('started_at', new Date(summary.startedAt + windowMs).toISOString())
      .limit(20);
    if (nearError) {
      console.error('[activities] cross-source dedupe read failed:', nearError.message);
      return { ok: false, status: 500, error: 'Could not save the activity.' };
    }
    const twin = findDuplicate(
      (near ?? []).map(r => ({
        id: r.id as string,
        startedAt: Date.parse(r.started_at as string),
        elapsedS: Number(r.elapsed_s) || 0,
        hasRoute: r.has_route === true,
        hasHeartRate: r.avg_hr != null,
      })),
      { startedAt: summary.startedAt, elapsedS: summary.elapsedS }
    );
    if (twin) {
      // A recording and a watch recorded the same walk: ONE activity. The
      // richer stream stands (dedupe.ts); the recorder's segments land on
      // the twin when the twin has none — the two starts differ by ≤ 60 s,
      // a skew the segments table absorbs.
      const twinRow = (near ?? []).find(r => r.id === twin.id) as { segments?: unknown } | undefined;
      const twinHasSegments = segmentsFromRow(twinRow?.segments).length > 0;
      if (!incomingIsRicher(twin, { hasRoute: summary.hasRoute, hasHeartRate: summary.avgHr != null })) {
        if (segments && segments.length > 0 && !twinHasSegments) {
          const { error: annErr } = await admin.from('activities').update({ segments }).eq('id', twin.id).eq('profile_id', profileId);
          if (annErr) console.error('[activities] twin segments merge failed:', annErr.message);
        }
        return { ok: true, id: twin.id, duplicate: true };
      }
      existing = { id: twin.id };
      if (twinHasSegments) delete annotations.segments;
    }
  }

  const id: string = existing?.id ?? crypto.randomUUID();
  const stream = buildStream(cleaned);
  if (isLive) {
    const fixes = raw.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');
    if (fixes.length > 0) {
      const t0 = raw[0].t;
      stream.raw = {
        s: fixes.map(p => Math.round((p.t - t0) / 100) / 10),
        lat: fixes.map(p => p.lat as number),
        lng: fixes.map(p => p.lng as number),
        acc: fixes.map(p => (typeof p.acc === 'number' ? p.acc : null)),
      };
    }
  }
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
    ...annotations,
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
    source,
    external_id: externalId,
    name: (n.name && n.name.trim()) || defaultActivityName(n.type, local.hour),
    ...data,
    ...(segments ? {} : { segments: [] }),
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
        .eq('source', source)
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
