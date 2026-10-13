import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { averageColor, BLUR_SOURCE_MAX_PX, blurHashToDataUrl, encodeThumbHash, isBlurHash } from '../blur';

// Video posters PR 6 (Oct 13 2026): the stored blur hash — encode, validate,
// decode, and where it rides.

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');

/** A w×h RGBA gradient: red grows left→right, green top→bottom. */
function gradient(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    out[i] = Math.round((x / (w - 1)) * 255);
    out[i + 1] = Math.round((y / (h - 1)) * 255);
    out[i + 2] = 40;
    out[i + 3] = 255;
  }
  return out;
}

describe('encodeThumbHash / isBlurHash', () => {
  it('a 20×12 gradient encodes to a short base64 the validator and 261\'s CHECK accept', () => {
    const hash = encodeThumbHash(gradient(20, 12), 20, 12);
    expect(isBlurHash(hash)).toBe(true);
    expect(hash.length).toBeGreaterThanOrEqual(8);
    expect(hash.length).toBeLessThanOrEqual(64);
    expect(hash).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
  it('refuses a picture over 100 px a side or a mismatched buffer', () => {
    expect(() => encodeThumbHash(new Uint8Array(4), 1, 1)).not.toThrow();
    expect(() => encodeThumbHash(new Uint8Array((BLUR_SOURCE_MAX_PX + 1) * 4), BLUR_SOURCE_MAX_PX + 1, 1)).toThrow();
    expect(() => encodeThumbHash(new Uint8Array(3), 1, 1)).toThrow();
  });
  it('isBlurHash: base64 of 8..64 only', () => {
    expect(isBlurHash('')).toBe(false);
    expect(isBlurHash('abc')).toBe(false);
    expect(isBlurHash('x'.repeat(65))).toBe(false);
    expect(isBlurHash('not base64!!')).toBe(false);
    expect(isBlurHash(42)).toBe(false);
    expect(isBlurHash('YQAAAAAAAAA=')).toBe(true);
  });
});

describe('blurHashToDataUrl / averageColor', () => {
  it('decodes to a PNG data URL, memoized; the average colour is the gradient\'s middle; garbage is harmless', () => {
    const hash = encodeThumbHash(gradient(20, 12), 20, 12);
    const url = blurHashToDataUrl(hash);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(blurHashToDataUrl(hash)).toBe(url); // the same string instance
    const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(averageColor(hash));
    expect(m).not.toBeNull();
    const [r, g, b] = [Number(m![1]), Number(m![2]), Number(m![3])];
    expect(r).toBeGreaterThan(80); expect(r).toBeLessThan(180); // ≈ 128
    expect(g).toBeGreaterThan(80); expect(g).toBeLessThan(180);
    expect(b).toBeLessThan(120);
    expect(blurHashToDataUrl('garbage')).toBe('');
    expect(averageColor('garbage!!')).toBe('transparent');
  });
});

describe('source pins — where the hash rides', () => {
  it('BlurBox paints the average colour and the picture; MediaTile and VideoFrame carry blurHash under the still', () => {
    const box = read('src/components/media/BlurBox.tsx');
    expect(box).toMatch(/backgroundColor: averageColor\(hash\)/);
    expect(box).toMatch(/data-blur-box=""/);
    expect(read('src/components/media/MediaTile.tsx')).toMatch(/\{blurHash && <BlurBox hash=\{blurHash\} \/>\}/);
    expect(read('src/components/media/VideoFrame.tsx')).toMatch(/\{blurHash && <BlurBox hash=\{blurHash\} \/>\}/);
  });
  it('the readers select and map blur_hash beside thumbnail_url; the writers accept it only through isBlurHash', () => {
    const posts = read('src/app/api/posts/route.ts');
    expect(posts.match(/blur_hash/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(posts).toMatch(/blur_hash: isBlurHash\(file\.blurHash\) \? file\.blurHash : null/);
    expect(read('src/app/api/posts/[id]/route.ts')).toMatch(/blur_hash/);
    expect(read('src/app/api/posts/[id]/media/route.ts')).toMatch(/blur_hash/);
    expect(read('src/app/api/posts/[id]/media/[mediaId]/route.ts')).toMatch(/blur_hash: isBlurHash\(body\.blurHash\) \? body\.blurHash : null/);
    expect(read('src/app/api/profile/[profileId]/media/route.ts')).toMatch(/blur_hash/);
    expect(read('src/lib/activities/media-server.ts')).toMatch(/blur_hash/);
    expect(read('src/lib/activities/media.ts')).toMatch(/isBlurHash\(b\.blur_hash\)/);
    expect(read('src/lib/activities/visibility.ts')).toMatch(/blurHash: r\.blur_hash \?\? null/);
    expect(read('src/lib/workouts/entries.ts')).toMatch(/isBlurHash\(m\.blurHash\)/);
  });
});
