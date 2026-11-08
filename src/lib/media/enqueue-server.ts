// ── The media jobs' ENQUEUE side (performance program, Nov 7 2026) ─────────
// Everything a WRITER needs to hand a media row to the worker — the job
// insert, the post-media hook, the plan columns, the daily hygiene and the
// dashboard's numbers — with NO node:fs, ffmpeg or sharp anywhere near it.
//
// WHY A SEPARATE FILE. Until Nov 7 these lived in process-server.ts beside
// the worker, whose `defaultJobDeps` reaches `./ffmpeg-bin` (the 45 MB
// binary) and `sharp` (~28 MB with libvips) through dynamic imports and reads
// a poster as `join(dir, `${job.id}.png`)` — a path the file tracer cannot
// resolve, so it included EVERY *.png in the project (95 MB of them). Every
// route that merely enqueued a job — the feed's `/api/posts`, the activity
// and sport-event media writers, the golf mirror, the daily cron — therefore
// traced ~170 MB and cold-started in 1.5–1.8 s against ~150 ms warm. The
// worker stays in process-server.ts, imported ONLY by `/api/cron/media-jobs`
// and `/api/admin/media-jobs` (src/lib/__tests__/media-worker-boundary.test.ts
// pins the boundary; scripts/check-function-weight.mjs measures it).

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  maxRunning,
  mediaJobsEnabled,
  planJobKind,
  storagePathOf,
  type MediaJobKind,
  type MediaJobTable,
  type MediaRowForPlan,
  type ProbedVideo,
} from './media-jobs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export const MEDIA_JOBS_BUCKET = 'uploads';

export { mediaJobsEnabled, maxRunning };

export interface MediaJobRow {
  id: string;
  kind: MediaJobKind;
  target_table: MediaJobTable;
  target_id: string;
  owner_id: string;
  source_path: string;
  status: string;
  attempts: number;
  origin: string;
}

export interface JobDeps {
  /** Run ffmpeg; resolves on exit 0, rejects on a non-zero exit or when killed at the deadline (`deadline`). */
  exec(args: string[], deadlineMs: number): Promise<void>;
  /** The object's bytes (the service key). Throws on a transport failure. */
  download(path: string): Promise<Uint8Array>;
  /** Write bytes beside the source; returns the public URL. Throws on failure. */
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<string>;
  /** The video's codec, dims and duration (mediabunny); null when unreadable. */
  probe(bytes: Uint8Array): Promise<ProbedVideo | null>;
  /** A picture's poster-sized JPEG and its ≤ 100 px RGBA (sharp). */
  image(bytes: Uint8Array): Promise<{ jpeg: Uint8Array; width: number; height: number; rgba: Uint8Array; rw: number; rh: number }>;
  now(): number;
}

export type JobOutcome = 'done' | 'reused' | 'parked' | 'failed' | 'skipped';

export interface TickSummary {
  ok: boolean;
  disabled?: boolean;
  claimed: number;
  outcomes: Array<{ id: string; kind: MediaJobKind; outcome: JobOutcome; ms: number; error?: string }>;
  elapsedMs: number;
}

/** The jobs a freshly written media row needs — enqueued best-effort, never failing the user's write. */
export async function enqueueMediaJobs(
  admin: Admin,
  table: MediaJobTable,
  rows: ReadonlyArray<MediaRowForPlan & { owner_id: string }>,
  origin: 'upload' | 'mirror' | 'backfill' = 'upload'
): Promise<number> {
  if (!mediaJobsEnabled()) return 0;
  const inserts = rows.flatMap(row => {
    const kind = planJobKind(row);
    const path = storagePathOf(row.media_url);
    if (!kind || !path) return [];
    return [{ kind, target_table: table, target_id: row.id, owner_id: row.owner_id, source_path: path, origin }];
  });
  if (inserts.length === 0) return 0;
  try {
    // One OPEN job per target is 261's PARTIAL unique index — PostgREST's
    // `on_conflict` cannot name a partial index (Postgres cannot infer it
    // without the predicate), so the open set is read first and a race's
    // duplicate (23505) is simply the other writer having won.
    const { data: open, error: readError } = await admin
      .from('media_jobs')
      .select('target_id')
      .eq('target_table', table)
      .in('status', ['queued', 'running', 'parked'])
      .in('target_id', inserts.map(i => i.target_id));
    if (readError) {
      console.warn('[media-jobs] enqueue read failed:', readError.message);
      return 0;
    }
    const taken = new Set(((open ?? []) as Array<{ target_id: string }>).map(r => r.target_id));
    const fresh = inserts.filter(i => !taken.has(i.target_id));
    if (fresh.length === 0) return 0;
    const { error } = await admin.from('media_jobs').insert(fresh);
    if (!error) return fresh.length;
    if (error.code !== '23505') {
      console.warn('[media-jobs] enqueue failed:', error.message);
      return 0;
    }
    let n = 0;
    for (const row of fresh) {
      const { error: one } = await admin.from('media_jobs').insert(row);
      if (!one) n += 1;
      else if (one.code !== '23505') console.warn('[media-jobs] enqueue failed:', one.message);
    }
    return n;
  } catch (err) {
    console.warn('[media-jobs] enqueue threw:', err);
    return 0;
  }
}

/** The post_media writers' hook: the rows just inserted (selected back with their columns) get their jobs; the owner is the post's profile. Never throws. */
export async function enqueueForPostMedia(
  admin: Admin,
  postId: string,
  rows: ReadonlyArray<MediaRowForPlan> | null | undefined,
  origin: 'upload' | 'mirror' = 'upload'
): Promise<number> {
  if (!rows || rows.length === 0 || !mediaJobsEnabled()) return 0;
  try {
    const { data: post } = await admin.from('posts').select('profile_id').eq('id', postId).maybeSingle();
    const owner = (post as { profile_id?: string } | null)?.profile_id;
    if (!owner) return 0;
    return await enqueueMediaJobs(admin, 'post_media', rows.map(r => ({ ...r, owner_id: owner })), origin);
  } catch (err) {
    console.warn('[media-jobs] enqueue for post threw:', err);
    return 0;
  }
}

/** The columns a writer selects back from its insert so the planner can read the row. */
export const MEDIA_JOB_PLAN_COLUMNS = 'id, media_url, media_type, codec, thumbnail_url, blur_hash';

/** The daily hygiene: a row still "processing" after a day with no open job stops saying so; done jobs older than 30 days go. */
export async function runMediaJobsHygiene(admin: Admin): Promise<{ ok: boolean; cleared: number; pruned: number }> {
  let cleared = 0;
  let pruned = 0;
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  for (const table of ['post_media', 'activity_media'] as const) {
    const { data } = await admin.from(table).select('id').not('processing_at', 'is', null).lt('processing_at', dayAgo).limit(200);
    for (const row of (data ?? []) as Array<{ id: string }>) {
      const { data: open } = await admin.from('media_jobs').select('id').eq('target_table', table).eq('target_id', row.id).in('status', ['queued', 'running', 'parked']).limit(1);
      if ((open ?? []).length === 0) {
        await admin.from(table).update({ processing_at: null }).eq('id', row.id);
        cleared += 1;
      }
    }
  }
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: old } = await admin.from('media_jobs').select('id').in('status', ['done', 'skipped']).lt('finished_at', monthAgo).limit(500);
  const ids = ((old ?? []) as Array<{ id: string }>).map(r => r.id);
  if (ids.length > 0) {
    await admin.from('media_jobs').delete().in('id', ids);
    pruned = ids.length;
  }
  return { ok: true, cleared, pruned };
}

/** The dashboard's numbers — counted in the database (the row read was cut at PostgREST's 1,000), plus how long the oldest queued job has waited. */
export async function readMediaJobsStatus(admin: Admin): Promise<{ ok: true; counts: Record<string, number>; recent: Array<Record<string, unknown>>; enabled: boolean; maxRunning: number; oldestQueuedAt: string | null; oldestQueuedMinutes: number | null } | { ok: false; error: string }> {
  const STATUSES = ['queued', 'running', 'parked', 'done', 'failed'] as const;
  const KINDS = ['video', 'poster', 'blur', 'probe'] as const;
  const countOf = async (status: string, kind?: string) => {
    let q = admin.from('media_jobs').select('id', { count: 'exact', head: true }).eq('status', status);
    if (kind) q = q.eq('kind', kind);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  };
  const counts: Record<string, number> = {};
  try {
    const keys: Array<[string, string | undefined]> = [
      ...STATUSES.map(s => [s, undefined] as [string, undefined]),
      ...STATUSES.flatMap(s => KINDS.map(k => [s, k] as [string, string])),
    ];
    const values = await Promise.all(keys.map(([s, k]) => countOf(s, k)));
    keys.forEach(([s, k], i) => { counts[k ? `${s}:${k}` : s] = values[i]; });
  } catch (err) {
    const error = err as { code?: string; message?: string };
    return { ok: false, error: error.code === 'PGRST205' || error.code === '42P01' ? 'migration 261 has not run here' : (error.message ?? 'failed') };
  }
  const [{ data: recent }, { data: oldest }] = await Promise.all([
    admin.from('media_jobs').select('id, kind, target_table, status, attempts, error, finished_at, created_at').order('created_at', { ascending: false }).limit(20),
    admin.from('media_jobs').select('created_at').eq('status', 'queued').order('created_at', { ascending: true }).limit(1).maybeSingle(),
  ]);
  const oldestQueuedAt = (oldest as { created_at?: string } | null)?.created_at ?? null;
  const oldestQueuedMinutes = oldestQueuedAt ? Math.max(0, Math.round((Date.now() - Date.parse(oldestQueuedAt)) / 60_000)) : null;
  return { ok: true, counts, recent: (recent ?? []) as Array<Record<string, unknown>>, enabled: mediaJobsEnabled(), maxRunning: maxRunning(), oldestQueuedAt, oldestQueuedMinutes };
}
