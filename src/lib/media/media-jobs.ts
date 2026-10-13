// ── The media jobs — the pure rules (video posters PR 7, Oct 13 2026) ───────
// Tom's decision: an iPhone's HEVC/MOV clip is converted SERVER-SIDE by a
// background job on a Vercel function (ffmpeg); the same job extracts a
// poster for any video without one and a blur hash where missing. The
// planner, the ffmpeg command, the retry ladder and the time guard live
// here, pure and pinned; process-server.ts runs them. Zero imports.

export type MediaJobKind = 'video' | 'poster' | 'blur' | 'probe';
export type MediaJobTable = 'post_media' | 'activity_media';
export type MediaCodec = 'avc' | 'hevc' | 'vp8' | 'vp9' | 'av1' | 'unknown';

/** The tick's budget on a 300 s function, with room for the claim and the stamps. */
export const WORK_BUDGET_MS = 240_000;
/** A transcode starts only while this much of the budget remains. */
export const TRANSCODE_START_RESERVE_MS = 200_000;
/** ffmpeg is killed this long before the budget ends — the stamp needs the time. */
export const FFMPEG_KILL_RESERVE_MS = 20_000;
/** A claim's lease: longer than any single job may run. */
export const LEASE_SECONDS = 360;
export const MAX_ATTEMPTS = 3;
/** Minutes before a parked job is tried again, by attempt (1st failure → 2 min …). */
export const RETRY_DELAYS_MIN: readonly number[] = [2, 10, 30];
/** The job's poster: ≤ 1280 on the long edge, JPEG q82 (the client's POSTER_MAX_DIM). */
export const POSTER_MAX_DIM = 1280;
export const POSTER_JPEG_QUALITY = 82;
/** Where the transcode stops: the client's MAX_VIDEO_SECONDS. */
export const TRANSCODE_MAX_SECONDS = 180;

const HEVC: ReadonlySet<string> = new Set(['hevc']);
const CODECS: ReadonlySet<string> = new Set(['avc', 'hevc', 'vp8', 'vp9', 'av1', 'unknown']);

/** 261's CHECK on `codec`. */
export function isMediaCodec(v: unknown): v is MediaCodec {
  return typeof v === 'string' && CODECS.has(v);
}

/** The kill switch: `MEDIA_JOBS=0` stops the worker AND stops new rows reading "processing". */
export function mediaJobsEnabled(): boolean {
  return process.env.MEDIA_JOBS !== '0';
}
/** How many jobs may hold a lease at once (Hobby = one vCPU: effectively one transcode per tick). */
export function maxRunning(): number {
  const n = Number(process.env.MEDIA_JOBS_MAX_RUNNING);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

/** The codecs a browser outside Safari cannot be trusted to decode. */
export function needsTranscode(codec: string | null | undefined): boolean {
  return !!codec && HEVC.has(codec);
}

export interface MediaRowForPlan {
  id: string;
  media_type: 'image' | 'video';
  media_url: string;
  codec: string | null;
  thumbnail_url: string | null;
  blur_hash: string | null;
}

/** ONE job per row — the heaviest kind it needs; the runner fills everything missing while it holds the bytes. */
export function planJobKind(row: MediaRowForPlan): MediaJobKind | null {
  if (row.media_type === 'video') {
    if (needsTranscode(row.codec)) return 'video';
    if (!row.codec && /\.mov(\?|$)/i.test(row.media_url)) return 'probe';
    if (!row.thumbnail_url) return 'poster';
    if (!row.blur_hash) return 'blur';
    return null;
  }
  return row.blur_hash ? null : 'blur';
}

export function planJobsForRows(rows: readonly MediaRowForPlan[]): Array<{ targetId: string; kind: MediaJobKind }> {
  const out: Array<{ targetId: string; kind: MediaJobKind }> = [];
  for (const row of rows) {
    const kind = planJobKind(row);
    if (kind) out.push({ targetId: row.id, kind });
  }
  return out;
}

export interface ProbedVideo {
  codec: MediaCodec;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

/** The ffmpeg arguments for a transcode — attempt 1 the full rung, 2–3 the cheaper one. */
export function ffmpegArgsFor(input: string, output: string, probe: Pick<ProbedVideo, 'audioCodec'>, attempt: number): string[] {
  const cheap = attempt >= 2;
  const audio = probe.audioCodec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'];
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '0',
    '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', cheap ? 'ultrafast' : 'veryfast', '-crf', '23', '-profile:v', 'high', '-level', '4.0',
    // format=yuv420p is load-bearing: an iPhone's HDR clip is 10-bit; 8-bit 4:2:0 is what every browser decodes.
    '-vf', `scale=-2:'min(${cheap ? 540 : 720},ih)',format=yuv420p`,
    '-fpsmax', '30',
    ...audio,
    '-map_metadata', '-1', '-map_chapters', '-1',
    '-movflags', '+faststart',
    '-t', String(TRANSCODE_MAX_SECONDS),
    output,
  ];
}

/** The poster's frame: one second in; a clip under two seconds its midpoint; unknown → 1.0 (the client's rule). */
export function posterSeekFor(durationSeconds: number | null | undefined): number {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 1;
  if (durationSeconds < 2) return durationSeconds / 2;
  return 1;
}

export function ffmpegPosterArgs(input: string, output: string, durationSeconds: number | null): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(posterSeekFor(durationSeconds)), '-i', input, '-frames:v', '1', '-vf', `scale='min(${POSTER_MAX_DIM},iw)':-2`, '-f', 'image2', '-c:v', 'png', output];
}

/** When a parked job runs again, by the attempt that just failed (1-based); null = failed for good. */
export function retryDelayMs(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return (RETRY_DELAYS_MIN[Math.max(0, attempts - 1)] ?? RETRY_DELAYS_MIN[RETRY_DELAYS_MIN.length - 1]) * 60_000;
}

/** A transcode may start only while the reserve holds. */
export function mayStartTranscode(elapsedMs: number): boolean {
  return WORK_BUDGET_MS - elapsedMs >= TRANSCODE_START_RESERVE_MS;
}

/** How long ffmpeg may run from now. */
export function ffmpegDeadlineMs(elapsedMs: number): number {
  return Math.max(0, Math.min(WORK_BUDGET_MS - elapsedMs - FFMPEG_KILL_RESERVE_MS, 220_000));
}

/** The bucket path a stored public URL names, or null. */
export function storagePathOf(url: string): string | null {
  const m = /\/storage\/v1\/object\/(?:public|authenticated)\/uploads\/(.+)$/.exec(url);
  return m ? decodeURIComponent(m[1].split('?')[0]) : null;
}

/** The output key beside the source: posts/<owner>/<uuid>.<ext>. */
export function outputKey(ownerId: string, id: string, ext: 'mp4' | 'jpg'): string {
  return `posts/${ownerId}/${id}.${ext}`;
}

/** The codec label mediabunny reports, folded to the five we store. */
export function foldCodec(raw: string | null | undefined): MediaCodec {
  const c = (raw ?? '').toLowerCase();
  if (c === 'avc' || c.startsWith('avc1') || c.startsWith('h264')) return 'avc';
  if (c === 'hevc' || c.startsWith('hvc1') || c.startsWith('hev1') || c.startsWith('h265')) return 'hevc';
  if (c.startsWith('vp8')) return 'vp8';
  if (c.startsWith('vp9') || c.startsWith('vp09')) return 'vp9';
  if (c.startsWith('av1') || c.startsWith('av01')) return 'av1';
  return 'unknown';
}
