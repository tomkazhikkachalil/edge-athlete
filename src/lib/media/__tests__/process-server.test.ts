import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enqueueMediaJobs, runMediaJobsTick, type JobDeps, type MediaJobRow } from '../process-server';
import { encodeThumbHash } from '../blur';

// Video posters PR 7 (Oct 13 2026): the worker's tick with fake deps and a
// fake admin — what it writes, and what it NEVER writes.

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> };

/** A chainable fake of the few supabase-js calls the runner makes. */
function fakeAdmin(rows: { jobs: MediaJobRow[]; targets: Record<string, Record<string, unknown>>; doneBySource?: Record<string, unknown>; openTargets?: Array<{ target_id: string }> }) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const call: Call = { table, op: '', filters: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    const result = () => {
      if (table === 'media_jobs' && call.op === 'select') {
        if (call.filters.some(([k]) => k === 'source_path')) return { data: rows.doneBySource ?? null, error: null };
        if (call.filters.some(([k]) => k === 'target_table')) return { data: rows.openTargets ?? [], error: null };
        return { data: rows.jobs, error: null };
      }
      if (call.op === 'select') {
        const id = call.filters.find(([k]) => k === 'id')?.[1] as string;
        return { data: rows.targets[id] ?? null, error: null };
      }
      return { data: null, error: null };
    };
    Object.assign(chain, {
      select: (cols?: string) => { call.op = call.op || 'select'; call.payload = cols; return chain; },
      update: (p: unknown) => { call.op = 'update'; call.payload = p; return chain; },
      insert: (p: unknown) => { call.op = 'insert'; call.payload = p; return Promise.resolve({ error: null }); },
      eq: (k: string, v: unknown) => { call.filters.push([k, v]); return chain; },
      neq: (k: string, v: unknown) => { call.filters.push([`!${k}`, v]); return chain; },
      in: self, lte: self, lt: self, not: self, order: self, limit: self,
      maybeSingle: () => Promise.resolve(result()),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
    });
    return chain;
  };
  const admin = {
    from: builder,
    // The real claim marks what it hands out `running`: a second claim in the same tick returns the REST, never the same job.
    rpc: vi.fn(async (_fn: string, args: { p_n: number }) => ({ data: rows.jobs.splice(0, args.p_n), error: null })),
  };
  return { admin: admin as never, calls };
}

const job = (over: Partial<MediaJobRow> = {}): MediaJobRow => ({
  id: 'j1', kind: 'video', target_table: 'post_media', target_id: 'm1', owner_id: 'u1', source_path: 'posts/u1/a.mov', status: 'running', attempts: 1, origin: 'upload', ...over,
});
const target = (over: Record<string, unknown> = {}) => ({
  id: 'm1', media_url: 'https://x.supabase.co/storage/v1/object/public/uploads/posts/u1/a.mov', media_type: 'video', codec: 'hevc', thumbnail_url: null, blur_hash: null, processing_at: '2026-10-13T00:00:00Z', transcode_source_url: null, ...over,
});

const rgba = new Uint8Array(4 * 4 * 4).fill(128);
const picture = { jpeg: new Uint8Array([1, 2, 3]), width: 4, height: 4, rgba, rw: 4, rh: 4 };

function deps(over: Partial<JobDeps> = {}): JobDeps & { exec: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn> } {
  const d = {
    exec: vi.fn(async (args: string[]) => {
      // ffmpeg "writes" its output file so the runner can read it back.
      const { writeFileSync } = await import('node:fs');
      writeFileSync(args[args.length - 1], new Uint8Array([9, 9, 9]));
    }),
    download: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    upload: vi.fn(async (path: string) => `https://x.supabase.co/storage/v1/object/public/uploads/${path}`),
    probe: vi.fn(async () => ({ codec: 'hevc' as const, audioCodec: 'aac', width: 1920, height: 1080, durationSeconds: 12 })),
    image: vi.fn(async () => picture),
    now: () => Date.now(),
    ...over,
  };
  return d as never;
}

const updatesOf = (calls: Call[], table: string) => calls.filter(c => c.table === table && c.op === 'update');

beforeEach(() => { delete process.env.MEDIA_JOBS; vi.spyOn(console, 'log').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('runMediaJobsTick', () => {
  it('a done video stamps the row ONCE, guarded on its media_url: the new file, the original kept, codec avc, poster + blur, processing cleared', async () => {
    const { admin, calls } = fakeAdmin({ jobs: [job()], targets: { m1: target() } });
    const d = deps();
    const s = await runMediaJobsTick(admin, d);
    expect(s.ok).toBe(true);
    expect(s.outcomes).toEqual([expect.objectContaining({ id: 'j1', outcome: 'done' })]);
    const [row] = updatesOf(calls, 'post_media');
    expect(updatesOf(calls, 'post_media')).toHaveLength(1);
    const patch = row.payload as Record<string, unknown>;
    expect(patch.media_url).toMatch(/\/uploads\/posts\/u1\/[0-9a-f-]{36}\.mp4$/);
    expect(patch.transcode_source_url).toBe(target().media_url);
    expect(patch.codec).toBe('avc');
    expect(patch.processing_at).toBeNull();
    expect(patch.thumbnail_url).toMatch(/\.jpg$/);
    expect(patch.blur_hash).toBe(encodeThumbHash(rgba, 4, 4));
    expect(row.filters).toEqual(expect.arrayContaining([['id', 'm1'], ['media_url', target().media_url]]));
    // Two ffmpeg runs: the transcode, then the poster from the CONVERTED file.
    expect(d.exec).toHaveBeenCalledTimes(2);
    expect(d.exec.mock.calls[1][0].join(' ')).toMatch(/-ss 1 -i .*\.mp4/);
    const jobUpdate = updatesOf(calls, 'media_jobs').at(-1)!.payload as Record<string, unknown>;
    expect(jobUpdate.status).toBe('done');
  });

  it('a failed download PARKS the job with the ladder\'s delay and writes NOTHING to the row', async () => {
    const { admin, calls } = fakeAdmin({ jobs: [job({ attempts: 1 })], targets: { m1: target() } });
    const d = deps({ download: vi.fn(async () => { throw new Error('socket hang up'); }) });
    const s = await runMediaJobsTick(admin, d);
    expect(s.outcomes[0]).toEqual(expect.objectContaining({ outcome: 'parked', error: 'transport' }));
    expect(updatesOf(calls, 'post_media')).toHaveLength(0);
    const j = updatesOf(calls, 'media_jobs')[0].payload as Record<string, unknown>;
    expect(j.status).toBe('parked');
    expect(Date.parse(j.run_after as string) - Date.now()).toBeGreaterThan(100_000);
    expect(d.upload).not.toHaveBeenCalled();
  });

  it('the deadline kill parks the job and uploads nothing', async () => {
    const { admin, calls } = fakeAdmin({ jobs: [job()], targets: { m1: target() } });
    const d = deps({ exec: vi.fn(async () => { throw new Error('deadline'); }) });
    const s = await runMediaJobsTick(admin, d);
    expect(s.outcomes[0]).toEqual(expect.objectContaining({ outcome: 'parked', error: 'deadline' }));
    expect(d.upload).not.toHaveBeenCalled();
    expect(updatesOf(calls, 'post_media')).toHaveLength(0);
  });

  it('the third failure marks the job failed AND clears processing_at — the original plays where it was', async () => {
    const { admin, calls } = fakeAdmin({ jobs: [job({ attempts: 3 })], targets: { m1: target() } });
    const d = deps({ exec: vi.fn(async () => { throw new Error('ffmpeg exited 1'); }) });
    const s = await runMediaJobsTick(admin, d);
    expect(s.outcomes[0].outcome).toBe('failed');
    const rowUpdates = updatesOf(calls, 'post_media');
    expect(rowUpdates).toHaveLength(1);
    expect(rowUpdates[0].payload).toEqual({ processing_at: null });
    expect((updatesOf(calls, 'media_jobs')[0].payload as { status: string }).status).toBe('failed');
  });

  it('a mirrored copy of a file already processed REUSES the outputs — no download, no ffmpeg', async () => {
    const done = { output_url: 'https://x/uploads/posts/u1/done.mp4', poster_url: 'https://x/uploads/posts/u1/done.jpg', blur_hash: 'YQAAAAAAAAA=' };
    const { admin, calls } = fakeAdmin({ jobs: [job({ id: 'j2', target_table: 'activity_media', target_id: 'a1' })], targets: { a1: target({ id: 'a1' }) }, doneBySource: done });
    const d = deps();
    const s = await runMediaJobsTick(admin, d);
    expect(s.outcomes[0].outcome).toBe('reused');
    expect(d.download).not.toHaveBeenCalled();
    expect(d.exec).not.toHaveBeenCalled();
    const patch = updatesOf(calls, 'activity_media')[0].payload as Record<string, unknown>;
    expect(patch.media_url).toBe(done.output_url);
    expect(patch.thumbnail_url).toBe(done.poster_url);
    expect(patch.blur_hash).toBe(done.blur_hash);
  });

  it('an H.264 video with no poster: no transcode, one ffmpeg run for the frame, the row keeps its URL', async () => {
    const { admin, calls } = fakeAdmin({ jobs: [job({ kind: 'poster' })], targets: { m1: target({ codec: 'avc' }) } });
    const d = deps({ probe: vi.fn(async () => ({ codec: 'avc' as const, audioCodec: 'aac', width: 640, height: 480, durationSeconds: 1.2 })) });
    await runMediaJobsTick(admin, d);
    expect(d.exec).toHaveBeenCalledTimes(1);
    expect(d.exec.mock.calls[0][0].join(' ')).toContain('-ss 0.6');
    const patch = updatesOf(calls, 'post_media')[0].payload as Record<string, unknown>;
    expect(patch.media_url).toBeUndefined();
    expect(patch.transcode_source_url).toBeUndefined();
    expect(patch.thumbnail_url).toMatch(/\.jpg$/);
    expect(patch.width).toBe(640);
  });

  it('a target that is gone is skipped; the kill switch runs nothing', async () => {
    const { admin, calls } = fakeAdmin({ jobs: [job()], targets: {} });
    const s = await runMediaJobsTick(admin, deps());
    expect(s.outcomes[0].outcome).toBe('skipped');
    expect(updatesOf(calls, 'post_media')).toHaveLength(0);
    process.env.MEDIA_JOBS = '0';
    const off = await runMediaJobsTick(fakeAdmin({ jobs: [job()], targets: {} }).admin, deps());
    expect(off).toEqual(expect.objectContaining({ disabled: true, claimed: 0 }));
  });
});

describe('enqueueMediaJobs', () => {
  it('plans one job per row that needs one, skips a target with an open job, inserts the rest, and never throws', async () => {
    const { admin, calls } = fakeAdmin({ jobs: [], targets: {} });
    const n = await enqueueMediaJobs(admin, 'post_media', [
      { id: 'm1', owner_id: 'u1', media_type: 'video', media_url: target().media_url, codec: 'hevc', thumbnail_url: null, blur_hash: null },
      { id: 'm2', owner_id: 'u1', media_type: 'image', media_url: 'https://x.supabase.co/storage/v1/object/public/uploads/posts/u1/p.jpg', codec: null, thumbnail_url: null, blur_hash: 'YQAAAAAAAAA=' },
      { id: 'm3', owner_id: 'u1', media_type: 'image', media_url: 'https://elsewhere/p.jpg', codec: null, thumbnail_url: null, blur_hash: null },
    ]);
    expect(n).toBe(1);
    const up = calls.find(c => c.op === 'insert')!;
    expect(up.payload).toEqual([expect.objectContaining({ kind: 'video', target_table: 'post_media', target_id: 'm1', source_path: 'posts/u1/a.mov', origin: 'upload' })]);
    // A target that already holds an OPEN job is skipped (261's partial unique index, read first).
    const busy = fakeAdmin({ jobs: [], targets: {}, openTargets: [{ target_id: 'm1' }] });
    expect(await enqueueMediaJobs(busy.admin, 'post_media', [{ id: 'm1', owner_id: 'u1', media_type: 'video', media_url: target().media_url, codec: 'hevc', thumbnail_url: null, blur_hash: null }])).toBe(0);
    expect(busy.calls.some(c => c.op === 'insert')).toBe(false);
    process.env.MEDIA_JOBS = '0';
    expect(await enqueueMediaJobs(admin, 'post_media', [])).toBe(0);
  });
});
