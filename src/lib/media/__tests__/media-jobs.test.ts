import { describe, it, expect } from 'vitest';
import {
  ffmpegArgsFor,
  ffmpegDeadlineMs,
  ffmpegPosterArgs,
  foldCodec,
  MAX_ATTEMPTS,
  mayStartTranscode,
  needsTranscode,
  outputKey,
  planJobKind,
  planJobsForRows,
  posterSeekFor,
  retryDelayMs,
  storagePathOf,
  TRANSCODE_START_RESERVE_MS,
  WORK_BUDGET_MS,
} from '../media-jobs';

// Video posters PR 7 (Oct 13 2026): the worker's pure rules.

const row = (over: Partial<Parameters<typeof planJobKind>[0]> = {}) => ({
  id: 'm1', media_type: 'video' as const, media_url: 'https://x.supabase.co/storage/v1/object/public/uploads/posts/u/a.mp4', codec: null, thumbnail_url: null, blur_hash: null, ...over,
});

describe('the planner', () => {
  it('an HEVC video → video; a .mov with no codec → probe; a video without a poster → poster; anything without a blur → blur; nothing → none', () => {
    expect(planJobKind(row({ codec: 'hevc', thumbnail_url: 'p', blur_hash: 'b' }))).toBe('video');
    expect(planJobKind(row({ media_url: 'https://x/uploads/posts/u/a.mov' }))).toBe('probe');
    expect(planJobKind(row({ codec: 'avc' }))).toBe('poster');
    expect(planJobKind(row({ codec: 'avc', thumbnail_url: 'p' }))).toBe('blur');
    expect(planJobKind(row({ codec: 'avc', thumbnail_url: 'p', blur_hash: 'b' }))).toBeNull();
    expect(planJobKind(row({ media_type: 'image' }))).toBe('blur');
    expect(planJobKind(row({ media_type: 'image', blur_hash: 'b' }))).toBeNull();
    // An MP4 without a codec is NOT probed: only a .mov that failed the scrub is in doubt.
    expect(planJobKind(row({}))).toBe('poster');
    expect(planJobsForRows([row({ codec: 'hevc' }), row({ id: 'm2', codec: 'avc', thumbnail_url: 'p', blur_hash: 'b' })])).toEqual([{ targetId: 'm1', kind: 'video' }]);
  });
  it('needsTranscode names hevc only', () => {
    expect(needsTranscode('hevc')).toBe(true);
    for (const c of ['avc', 'vp8', 'vp9', 'av1', 'unknown', null, undefined, '']) expect(needsTranscode(c)).toBe(false);
  });
});

describe('ffmpeg', () => {
  it('attempt 1 is veryfast at 720p; attempts 2–3 ultrafast at 540p; yuv420p and -map_metadata -1 always; aac is copied, anything else encoded', () => {
    const a1 = ffmpegArgsFor('in', 'out.mp4', { audioCodec: 'aac' }, 1);
    expect(a1).toContain('veryfast');
    expect(a1.join(' ')).toContain("scale=-2:'min(720,ih)',format=yuv420p");
    expect(a1.join(' ')).toContain('-c:a copy');
    expect(a1.join(' ')).toContain('-map_metadata -1');
    expect(a1.join(' ')).toContain('-movflags +faststart');
    expect(a1[a1.length - 1]).toBe('out.mp4');
    const a2 = ffmpegArgsFor('in', 'out.mp4', { audioCodec: 'opus' }, 2);
    expect(a2).toContain('ultrafast');
    expect(a2.join(' ')).toContain("min(540,ih)");
    expect(a2.join(' ')).toContain('-c:a aac');
    expect(a2.join(' ')).toContain('format=yuv420p');
  });
  it('the poster frame: one second in, the midpoint of a short clip, 1.0 when unknown; the poster args seek there', () => {
    expect(posterSeekFor(10)).toBe(1);
    expect(posterSeekFor(1.5)).toBe(0.75);
    expect(posterSeekFor(null)).toBe(1);
    expect(posterSeekFor(Number.NaN)).toBe(1);
    const args = ffmpegPosterArgs('in', 'out.png', 0.8);
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2)).toEqual(['-ss', '0.4']);
    expect(args).toContain('-frames:v');
  });
  it('the retry ladder: 2 / 10 min, then failed; the time guard and the kill deadline', () => {
    expect(retryDelayMs(1)).toBe(2 * 60_000);
    expect(retryDelayMs(2)).toBe(10 * 60_000);
    expect(retryDelayMs(MAX_ATTEMPTS)).toBeNull();
    expect(mayStartTranscode(0)).toBe(true);
    expect(mayStartTranscode(WORK_BUDGET_MS - TRANSCODE_START_RESERVE_MS)).toBe(true);
    expect(mayStartTranscode(WORK_BUDGET_MS - TRANSCODE_START_RESERVE_MS + 1)).toBe(false);
    expect(ffmpegDeadlineMs(0)).toBe(220_000);
    expect(ffmpegDeadlineMs(100_000)).toBe(WORK_BUDGET_MS - 100_000 - 20_000);
    expect(ffmpegDeadlineMs(WORK_BUDGET_MS)).toBe(0);
  });
});

describe('paths and codecs', () => {
  it('storagePathOf reads the bucket path of a public URL; outputKey sits beside the source', () => {
    expect(storagePathOf('https://x.supabase.co/storage/v1/object/public/uploads/posts/u1/a%20b.mov?x=1')).toBe('posts/u1/a b.mov');
    expect(storagePathOf('https://elsewhere.com/a.mp4')).toBeNull();
    expect(outputKey('u1', 'id', 'mp4')).toBe('posts/u1/id.mp4');
  });
  it('foldCodec folds mediabunny\'s labels to the five we store', () => {
    expect(foldCodec('avc')).toBe('avc');
    expect(foldCodec('avc1.42E01E')).toBe('avc');
    expect(foldCodec('hvc1.1.6.L93.B0')).toBe('hevc');
    expect(foldCodec('hevc')).toBe('hevc');
    expect(foldCodec('vp09.00.10.08')).toBe('vp9');
    expect(foldCodec('av01.0.04M.08')).toBe('av1');
    expect(foldCodec(null)).toBe('unknown');
    expect(foldCodec('prores')).toBe('unknown');
  });
});
