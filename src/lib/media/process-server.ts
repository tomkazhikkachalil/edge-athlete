// ── The media worker (video posters PR 7, Oct 13 2026) ──────────────────────
// One tick: claim due jobs (media_jobs_claim — videos first, a running cap, a
// lease), and for each: reuse a done job's outputs when the same file was
// already processed (a mirrored copy), else stream the object to /tmp, probe
// it, transcode (an HEVC clip → H.264 MP4 at ≤ 720p) and/or grab the poster
// and the blur, upload what was made beside the source, and stamp the media
// row ONCE — guarded on its media_url, so a row someone re-pointed is never
// clobbered. A transport failure or the deadline PARKS the job (run_after
// by the retry ladder; NO row change); the third failure marks it failed
// AND clears processing_at (the original stays playable where it was — the
// file is never deleted; the pre-transcode URL moves to
// transcode_source_url, convention 27's spirit). Every outcome is logged.
//
// Everything that touches the world comes in through `deps`
// (exec / download / upload / probe / image) so the tick is unit-testable
// with fakes; the defaults wrap child_process, the storage client, mediabunny
// and sharp. The cron route answers at once and runs the tick through
// `waitUntil` (a 300 s function; the Postgres client's timeout never ends it).

import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ffmpegArgsFor,
  ffmpegDeadlineMs,
  ffmpegPosterArgs,
  foldCodec,
  LEASE_SECONDS,
  maxRunning,
  mayStartTranscode,
  mediaJobsEnabled,
  needsTranscode,
  outputKey,
  planJobKind,
  POSTER_JPEG_QUALITY,
  POSTER_MAX_DIM,
  retryDelayMs,
  storagePathOf,
  WORK_BUDGET_MS,
  type MediaJobKind,
  type MediaJobTable,
  type MediaRowForPlan,
  type ProbedVideo,
} from './media-jobs';
import { encodeThumbHash } from './blur';

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

const log = (event: string, detail: Record<string, unknown>) => console.log('[media-jobs]', JSON.stringify({ event, ...detail }));

/** A row's columns the runner reads. */
const ROW_COLUMNS = 'id, media_url, media_type, codec, thumbnail_url, blur_hash, processing_at, transcode_source_url';

interface TargetRow {
  id: string;
  media_url: string;
  media_type: 'image' | 'video';
  codec: string | null;
  thumbnail_url: string | null;
  blur_hash: string | null;
  processing_at: string | null;
  transcode_source_url: string | null;
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

/** The tick. */
export async function runMediaJobsTick(admin: Admin, deps: JobDeps, opts: { dryRun?: boolean; maxVideos?: number; maxLight?: number } = {}): Promise<TickSummary> {
  const t0 = deps.now();
  const summary: TickSummary = { ok: true, claimed: 0, outcomes: [], elapsedMs: 0 };
  if (!mediaJobsEnabled()) {
    summary.disabled = true;
    return { ...summary, elapsedMs: deps.now() - t0 };
  }
  const claim = async (n: number): Promise<MediaJobRow[]> => {
    if (opts.dryRun) {
      const { data } = await admin.from('media_jobs').select('*').in('status', ['queued', 'parked']).lte('run_after', new Date().toISOString()).order('created_at').limit(n);
      return (data ?? []) as MediaJobRow[];
    }
    const { data, error } = await admin.rpc('media_jobs_claim', { p_n: n, p_lease_seconds: LEASE_SECONDS, p_max_running: maxRunning() });
    if (error) throw new Error(`claim failed: ${error.message}`);
    return (data ?? []) as MediaJobRow[];
  };
  try {
    // One video while the reserve holds, then the light jobs in the remaining budget.
    const jobs: MediaJobRow[] = [];
    if (mayStartTranscode(deps.now() - t0)) jobs.push(...(await claim(1)));
    if (jobs.length === 0 || jobs[0].kind !== 'video') jobs.push(...(await claim(Math.max(0, (opts.maxLight ?? 20) - jobs.length))));
    summary.claimed = jobs.length;
    if (opts.dryRun) {
      summary.outcomes = jobs.map(j => ({ id: j.id, kind: j.kind, outcome: 'skipped' as const, ms: 0 }));
      return { ...summary, elapsedMs: deps.now() - t0 };
    }
    for (const job of jobs) {
      if (deps.now() - t0 > WORK_BUDGET_MS) {
        await park(admin, job, 'budget');
        summary.outcomes.push({ id: job.id, kind: job.kind, outcome: 'parked', ms: 0, error: 'budget' });
        continue;
      }
      const started = deps.now();
      const result = await runJob(admin, deps, job, t0);
      summary.outcomes.push({ id: job.id, kind: job.kind, outcome: result.outcome, ms: deps.now() - started, ...(result.error ? { error: result.error } : {}) });
      log(result.outcome, { id: job.id, kind: job.kind, table: job.target_table, target: job.target_id, ms: deps.now() - started, error: result.error ?? null });
    }
  } catch (err) {
    summary.ok = false;
    log('tick-failed', { error: err instanceof Error ? err.message : String(err) });
  }
  return { ...summary, elapsedMs: deps.now() - t0 };
}

async function park(admin: Admin, job: MediaJobRow, error: string): Promise<'parked' | 'failed'> {
  const delay = retryDelayMs(job.attempts);
  if (delay === null) {
    await admin.from('media_jobs').update({ status: 'failed', error: error.slice(0, 2000), finished_at: new Date().toISOString() }).eq('id', job.id);
    // The row stops saying "processing": the original plays where it can.
    await admin.from(job.target_table).update({ processing_at: null }).eq('id', job.target_id);
    return 'failed';
  }
  await admin.from('media_jobs').update({ status: 'parked', error: error.slice(0, 2000), run_after: new Date(Date.now() + delay).toISOString() }).eq('id', job.id);
  return 'parked';
}

async function finish(admin: Admin, job: MediaJobRow, outputs: { output_url?: string | null; poster_url?: string | null; blur_hash?: string | null }): Promise<void> {
  await admin.from('media_jobs').update({ status: 'done', finished_at: new Date().toISOString(), error: null, ...outputs }).eq('id', job.id);
}

async function runJob(admin: Admin, deps: JobDeps, job: MediaJobRow, t0: number): Promise<{ outcome: JobOutcome; error?: string }> {
  const { data: row } = await admin.from(job.target_table).select(ROW_COLUMNS).eq('id', job.target_id).maybeSingle();
  const target = (row ?? null) as TargetRow | null;
  if (!target) {
    await admin.from('media_jobs').update({ status: 'skipped', finished_at: new Date().toISOString(), error: 'target gone' }).eq('id', job.id);
    return { outcome: 'skipped', error: 'target gone' };
  }
  // A mirrored copy of a file already processed: reuse the outputs, encode nothing.
  const { data: done } = await admin.from('media_jobs').select('output_url, poster_url, blur_hash').eq('source_path', job.source_path).eq('status', 'done').neq('id', job.id).limit(1).maybeSingle();
  const reuse = done as { output_url: string | null; poster_url: string | null; blur_hash: string | null } | null;
  if (reuse && (reuse.output_url || reuse.poster_url || reuse.blur_hash)) {
    await stamp(admin, job, target, { outputUrl: reuse.output_url, posterUrl: reuse.poster_url, blurHash: reuse.blur_hash });
    await finish(admin, job, { output_url: reuse.output_url, poster_url: reuse.poster_url, blur_hash: reuse.blur_hash });
    return { outcome: 'reused' };
  }

  let dir: string | null = null;
  try {
    let bytes: Uint8Array;
    try {
      bytes = await deps.download(job.source_path);
    } catch (err) {
      return { outcome: await park(admin, job, `transport: ${err instanceof Error ? err.message : String(err)}`), error: 'transport' };
    }
    const outputs: { outputUrl?: string | null; posterUrl?: string | null; blurHash?: string | null; codec?: string; width?: number | null; height?: number | null; duration?: number | null } = {};

    if (target.media_type === 'image') {
      // An image's job is its blur (and nothing else).
      if (!target.blur_hash) {
        const pic = await deps.image(bytes);
        outputs.blurHash = encodeThumbHash(pic.rgba, pic.rw, pic.rh);
      }
      await stamp(admin, job, target, outputs);
      await finish(admin, job, { blur_hash: outputs.blurHash ?? null });
      return { outcome: 'done' };
    }

    const probe = await deps.probe(bytes);
    const codec = probe?.codec ?? (target.codec ? foldCodec(target.codec) : 'unknown');
    outputs.codec = codec;
    outputs.width = probe?.width ?? null;
    outputs.height = probe?.height ?? null;
    outputs.duration = probe?.durationSeconds ?? null;

    dir = await mkdtemp(join(tmpdir(), 'media-job-'));
    const input = join(dir, `${job.id}.in`);
    await writeFile(input, bytes);

    if (needsTranscode(codec)) {
      const elapsed = deps.now() - t0;
      if (!mayStartTranscode(elapsed)) return { outcome: await park(admin, job, 'budget'), error: 'budget' };
      const output = join(dir, `${job.id}.mp4`);
      try {
        await deps.exec(ffmpegArgsFor(input, output, { audioCodec: probe?.audioCodec ?? null }, job.attempts), ffmpegDeadlineMs(elapsed));
      } catch (err) {
        const reason = err instanceof Error && err.message === 'deadline' ? 'deadline' : `ffmpeg: ${err instanceof Error ? err.message : String(err)}`;
        return { outcome: await park(admin, job, reason), error: reason };
      }
      const made = await readFile(output);
      const converted = await deps.probe(new Uint8Array(made));
      try {
        outputs.outputUrl = await deps.upload(outputKey(job.owner_id, randomUUID(), 'mp4'), new Uint8Array(made), 'video/mp4');
      } catch (err) {
        return { outcome: await park(admin, job, `transport: ${err instanceof Error ? err.message : String(err)}`), error: 'transport' };
      }
      outputs.codec = 'avc';
      outputs.width = converted?.width ?? outputs.width;
      outputs.height = converted?.height ?? outputs.height;
      outputs.duration = converted?.durationSeconds ?? outputs.duration;
    }

    // The poster (when the row has none) and the blur (when the row has none) from the PLAYABLE file.
    if (!target.thumbnail_url || !target.blur_hash) {
      const source = outputs.outputUrl ? join(dir, `${job.id}.mp4`) : input;
      const png = join(dir, `${job.id}.png`);
      try {
        await deps.exec(ffmpegPosterArgs(source, png, outputs.duration ?? null), 30_000);
        const pic = await deps.image(new Uint8Array(await readFile(png)));
        if (!target.thumbnail_url) {
          try {
            outputs.posterUrl = await deps.upload(outputKey(job.owner_id, randomUUID(), 'jpg'), pic.jpeg, 'image/jpeg');
          } catch (err) {
            return { outcome: await park(admin, job, `transport: ${err instanceof Error ? err.message : String(err)}`), error: 'transport' };
          }
        }
        if (!target.blur_hash) outputs.blurHash = encodeThumbHash(pic.rgba, pic.rw, pic.rh);
      } catch (err) {
        // A poster that cannot be grabbed is not a failure of the transcode: the row keeps what it had.
        log('poster-miss', { id: job.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    await stamp(admin, job, target, outputs);
    await finish(admin, job, { output_url: outputs.outputUrl ?? null, poster_url: outputs.posterUrl ?? null, blur_hash: outputs.blurHash ?? null });
    return { outcome: 'done' };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** ONE update, guarded on the media_url the job was made for. */
async function stamp(
  admin: Admin,
  job: MediaJobRow,
  target: TargetRow,
  outputs: { outputUrl?: string | null; posterUrl?: string | null; blurHash?: string | null; codec?: string; width?: number | null; height?: number | null; duration?: number | null }
): Promise<void> {
  const patch: Record<string, unknown> = { processing_at: null };
  if (outputs.outputUrl) {
    patch.media_url = outputs.outputUrl;
    patch.transcode_source_url = target.transcode_source_url ?? target.media_url;
    patch.codec = 'avc';
  } else if (outputs.codec && !target.codec) {
    patch.codec = outputs.codec;
  }
  if (outputs.posterUrl && !target.thumbnail_url) patch.thumbnail_url = outputs.posterUrl;
  if (outputs.blurHash && !target.blur_hash) patch.blur_hash = outputs.blurHash;
  if (job.target_table === 'post_media') {
    if (typeof outputs.width === 'number') patch.width = Math.round(outputs.width);
    if (typeof outputs.height === 'number') patch.height = Math.round(outputs.height);
    if (typeof outputs.duration === 'number') patch.duration = Math.round(outputs.duration);
  } else if (typeof outputs.duration === 'number') {
    patch.duration_seconds = Math.round(outputs.duration * 100) / 100;
  }
  await admin.from(job.target_table).update(patch).eq('id', job.target_id).eq('media_url', target.media_url);
}

/** The backfill: older rows that need a job, as the dashboard's dry run lists and its live run enqueues. */
export async function planBackfill(
  admin: Admin,
  opts: { tables: MediaJobTable[]; includeBlur: boolean; limit: number; dryRun: boolean }
): Promise<{ ok: true; counts: Record<string, number>; sample: Array<{ table: MediaJobTable; id: string; kind: MediaJobKind }>; enqueued: number } | { ok: false; error: string }> {
  const counts: Record<string, number> = {};
  const sample: Array<{ table: MediaJobTable; id: string; kind: MediaJobKind }> = [];
  let enqueued = 0;
  for (const table of opts.tables) {
    const ownerCol = table === 'post_media' ? 'posts!inner(profile_id)' : 'profile_id';
    const { data, error } = await admin.from(table).select(`id, media_url, media_type, codec, thumbnail_url, blur_hash, ${ownerCol}`).order('created_at', { ascending: false }).limit(opts.limit);
    if (error) return { ok: false, error: error.message.includes('blur_hash') ? 'migration 261 has not run here' : error.message };
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
      id: r.id as string,
      media_url: r.media_url as string,
      media_type: r.media_type as 'image' | 'video',
      codec: (r.codec as string | null) ?? null,
      thumbnail_url: (r.thumbnail_url as string | null) ?? null,
      blur_hash: (r.blur_hash as string | null) ?? null,
      owner_id: table === 'post_media' ? ((r.posts as { profile_id: string } | null)?.profile_id ?? '') : (r.profile_id as string),
    }));
    const wanted = rows.filter(r => {
      const kind = planJobKind(r);
      if (!kind) return false;
      if (kind === 'blur' && !opts.includeBlur) return false;
      return !!r.owner_id;
    });
    for (const r of wanted) {
      const kind = planJobKind(r)!;
      counts[`${table}:${kind}`] = (counts[`${table}:${kind}`] ?? 0) + 1;
      if (sample.length < 20) sample.push({ table, id: r.id, kind });
    }
    if (!opts.dryRun && wanted.length > 0) enqueued += await enqueueMediaJobs(admin, table, wanted, 'backfill');
  }
  return { ok: true, counts, sample, enqueued };
}

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

/** The dashboard's numbers. */
export async function readMediaJobsStatus(admin: Admin): Promise<{ ok: true; counts: Record<string, number>; recent: Array<Record<string, unknown>>; enabled: boolean; maxRunning: number } | { ok: false; error: string }> {
  const { data, error } = await admin.from('media_jobs').select('status, kind');
  if (error) return { ok: false, error: error.code === 'PGRST205' || error.code === '42P01' ? 'migration 261 has not run here' : error.message };
  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ status: string; kind: string }>) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    counts[`${r.status}:${r.kind}`] = (counts[`${r.status}:${r.kind}`] ?? 0) + 1;
  }
  const { data: recent } = await admin.from('media_jobs').select('id, kind, target_table, status, attempts, error, finished_at, created_at').order('created_at', { ascending: false }).limit(20);
  return { ok: true, counts, recent: (recent ?? []) as Array<Record<string, unknown>>, enabled: mediaJobsEnabled(), maxRunning: maxRunning() };
}

/** The default deps — the world. */
export function defaultJobDeps(admin: Admin): JobDeps {
  return {
    async exec(args, deadlineMs) {
      const { resolveFfmpeg } = await import('./ffmpeg-bin');
      const { execFile } = await import('node:child_process');
      const bin = resolveFfmpeg();
      await new Promise<void>((resolve, reject) => {
        const child = execFile(bin, args, { maxBuffer: 4 * 1024 * 1024 }, (error, _stdout, stderr) => {
          if (killed) return reject(new Error('deadline'));
          if (error) return reject(new Error(String(stderr || error.message).slice(0, 500)));
          resolve();
        });
        let killed = false;
        const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, Math.max(1_000, deadlineMs));
        child.on('exit', () => clearTimeout(timer));
      });
    },
    async download(path) {
      const { data, error } = await admin.storage.from(MEDIA_JOBS_BUCKET).download(path);
      if (error || !data) throw new Error(error?.message ?? 'download failed');
      return new Uint8Array(await data.arrayBuffer());
    },
    async upload(path, bytes, contentType) {
      const { error } = await admin.storage.from(MEDIA_JOBS_BUCKET).upload(path, new Blob([bytes as BlobPart], { type: contentType }), { contentType, cacheControl: '3600', upsert: false });
      if (error) throw new Error(error.message);
      return admin.storage.from(MEDIA_JOBS_BUCKET).getPublicUrl(path).data.publicUrl;
    },
    async probe(bytes) {
      const { probeVideo } = await import('./video-probe-server');
      return probeVideo(bytes);
    },
    async image(bytes) {
      const sharp = (await import('sharp')).default;
      const jpeg = await sharp(bytes).rotate().resize({ width: POSTER_MAX_DIM, height: POSTER_MAX_DIM, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: POSTER_JPEG_QUALITY }).toBuffer({ resolveWithObject: true });
      const small = await sharp(bytes).rotate().resize({ width: 100, height: 100, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { jpeg: new Uint8Array(jpeg.data), width: jpeg.info.width, height: jpeg.info.height, rgba: new Uint8Array(small.data), rw: small.info.width, rh: small.info.height };
    },
    now: () => Date.now(),
  };
}
