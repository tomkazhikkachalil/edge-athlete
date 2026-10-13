import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MAX_DEVICE_POSTER_ATTEMPTS, planPosterRetry, POSTER_RETRY_DEADLINE_MS, POSTER_TARGET_SEC, posterTimeFor } from '../poster-plan';

// Video posters program, PR 1 (Oct 13 2026): the poster rule and ONE video
// renderer. The sweep below is the invariant — a raw <video> outside the
// allowlist is how a black box comes back.

const root = process.cwd();
const read = (f: string) => readFileSync(join(root, f), 'utf8');

describe('posterTimeFor — "about one second in"', () => {
  it('1.0 s; a clip under two seconds its midpoint; an unknown duration asks for 1.0', () => {
    expect(POSTER_TARGET_SEC).toBe(1);
    expect(posterTimeFor(10)).toBe(1);
    expect(posterTimeFor(2)).toBe(1);
    expect(posterTimeFor(1.5)).toBe(0.75);
    expect(posterTimeFor(0.8)).toBe(0.4);
    expect(posterTimeFor(null)).toBe(1);
    expect(posterTimeFor(undefined)).toBe(1);
    expect(posterTimeFor(Infinity)).toBe(1); // MediaRecorder's duration until forced
    expect(posterTimeFor(Number.NaN)).toBe(1);
    expect(posterTimeFor(0)).toBe(1);
    expect(posterTimeFor(-3)).toBe(1);
  });
});

describe('planPosterRetry', () => {
  it('a decode failure goes to the server at once; an upload failure re-queues the blob; a timeout retries once after the upload, then the server', () => {
    expect(planPosterRetry(1, 'decode')).toEqual({ action: 'server' });
    expect(planPosterRetry(1, 'upload')).toEqual({ action: 'retry-now' });
    expect(planPosterRetry(1, 'timeout')).toEqual({ action: 'retry-after-upload', deadlineMs: POSTER_RETRY_DEADLINE_MS });
    expect(planPosterRetry(1, 'canvas')).toEqual({ action: 'retry-after-upload', deadlineMs: POSTER_RETRY_DEADLINE_MS });
    expect(planPosterRetry(MAX_DEVICE_POSTER_ATTEMPTS, 'timeout')).toEqual({ action: 'server' });
    expect(MAX_DEVICE_POSTER_ATTEMPTS).toBe(2);
  });
});

/** Every .tsx under a directory, repo-relative. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.tsx')) out.push(relative(root, full));
    }
  };
  walk(join(root, dir));
  return out;
}

/** A JSX <video element (not the word in a comment): `<video` followed by whitespace and an attribute, or by `>`. */
const RAW_VIDEO = /<video(?=[\s>])\s*(?:\n\s*)?(?:[a-zA-Z]|>)/;

describe('ONE video renderer — the raw <video> allowlist', () => {
  const ALLOWED = new Set([
    'src/components/media/VideoFrame.tsx', // the renderer
    'src/components/media/MediaLightbox.tsx', // autoplay with room for controls
    'src/components/media/InAppCamera.tsx', // the live camera preview
    'src/components/media-editor/Filmstrip.tsx',
    'src/components/media-editor/VideoStage.tsx',
    'src/components/media-editor/VideoCropStage.tsx',
    // The (public) tree is server-only (no client component may live there) and
    // ContestPage is server-safe by design; both carry the surface tint, never black.
    'src/components/contests/ContestPage.tsx',
    'src/app/(public)/org/[slug]/gallery/page.tsx',
  ]);
  it('every <video> in the tree is on the allowlist', () => {
    const offenders: string[] = [];
    for (const f of [...tsxFiles('src/components'), ...tsxFiles('src/app')]) {
      if (ALLOWED.has(f)) continue;
      // Strip comments before looking: prose like "never raw <video>" is not an element.
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (RAW_VIDEO.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
  it('the allowlist names files that exist and still render a video', () => {
    for (const f of ALLOWED) expect(RAW_VIDEO.test(read(f)), f).toBe(true);
  });
});

describe('source pins — the frame and its hosts', () => {
  it('VideoFrame: poster first, a local blob previews itself, a stored video without a poster is the placeholder, the tap mounts the video', () => {
    const frame = read('src/components/media/VideoFrame.tsx');
    expect(frame).toMatch(/data-video-frame=\{shown\}/);
    expect(frame).toMatch(/const isLocalUrl = \(url: string\) => url\.startsWith\('blob:'\)/);
    expect(frame).toMatch(/const localPreview = !posterSrc && isLocalUrl\(src\)/);
    expect(frame).toMatch(/: posterSrc \? 'poster'\s*: localPreview \? 'preview'\s*: 'placeholder'/);
    expect(frame).toMatch(/\{playing && \(\s*<video/); // playback mounts on the tap only
    expect(frame).toMatch(/aria-label="Play video"/);
    expect(frame).toMatch(/aria-label="Retry upload"/);
    expect(frame).not.toMatch(/bg-gray-900|bg-black"/); // never a black box
    expect(frame).toMatch(/preload="metadata"/); // the local preview
    expect(frame).not.toMatch(/preload="none"/);
  });
  it('MediaTile hands a video to VideoFrame; the feed card, the grid, Featured and the embeds carry the poster', () => {
    expect(read('src/components/media/MediaTile.tsx')).toMatch(/<VideoFrame[\s\S]*poster=\{thumbnailUrl\}/);
    expect(read('src/components/PostCard.tsx')).toMatch(/<VideoFrame[\s\S]*poster=\{shownMedia\[currentMediaIndex\]\.thumbnail_url\}[\s\S]*playable/);
    expect(read('src/components/media/MediaGridItem.tsx')).toMatch(/thumbnailUrl=\{firstMedia\.thumbnail_url\}/);
    expect(read('src/components/FeaturedPosts.tsx')).toMatch(/thumbnailUrl=\{firstMedia\.thumbnail_url\}/);
    expect(read('src/components/QuotedPostEmbed.tsx')).toMatch(/poster=\{thumbnail\.thumbnail_url\}/);
    expect(read('src/components/messages/SharedPostPreview.tsx')).toMatch(/poster=\{thumbnail\.thumbnail_url\}/);
    expect(read('src/components/workouts/SetMediaThumb.tsx')).toMatch(/<VideoFrame src=\{shown\} poster=\{preview \? null : thumbnailUrl\}/);
    // The two quoted-post selects carry the poster.
    expect(read('src/app/api/posts/route.ts')).toMatch(/media:post_media \( media_url, media_type, thumbnail_url, blur_hash, codec, processing_at \)/);
    expect(read('src/app/api/messages/[conversationId]/route.ts')).toMatch(/media_url, media_type, thumbnail_url/);
    expect(read('src/types/messages.ts')).toMatch(/media: \{ media_url: string; media_type: string; thumbnail_url\?: string \| null \}\[\];/);
  });
  it('every grab asks posterTimeFor — no hand-written seconds', () => {
    expect(read('src/components/CreatePostModal.tsx')).toMatch(/capturePoster\(source, posterTimeFor\(/);
    expect(read('src/components/sport-events/EventGalleryTab.tsx')).toMatch(/capturePoster\(file, posterTimeFor\(/);
    for (const f of ['src/components/CreatePostModal.tsx', 'src/components/sport-events/EventGalleryTab.tsx']) {
      expect(read(f), f).not.toMatch(/capturePoster\([^)]*,\s*0\.\d+\)/);
    }
  });
});
