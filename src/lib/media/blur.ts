// ── The blurred placeholder (video posters PR 6, Oct 13 2026) ───────────────
// Tom: "On feeds and profiles, show a small blurred version of the image or
// poster while the full file loads, so there is never a blank or broken box."
// Tom's decision: a STORED ThumbHash — ~25 bytes, base64, on the media row
// (261's `blur_hash`), computed on the device at attach from the image (or
// the video's poster) and by the media job for older rows — so every
// surface paints the real blurred picture at once, public or private media
// alike (the optimizer cannot serve a private row's thumbnail).
//
// The pure half (encode / decode / validate) runs in node for the tests and
// in the worker; `blurHashFromBlob` is browser-only (a canvas).

import { rgbaToThumbHash, thumbHashToAverageRGBA, thumbHashToDataURL } from 'thumbhash';

/** A ThumbHash's base64 is short; 261's CHECK bounds it 8..64. */
const HASH_RE = /^[A-Za-z0-9+/]{8,64}={0,2}$/;
/** ThumbHash wants a tiny picture — ≤ 100 px on either side. */
export const BLUR_SOURCE_MAX_PX = 100;

const toBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const fromBase64 = (hash: string): Uint8Array => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(hash, 'base64'));
  const s = atob(hash);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

/** Encode a ≤ 100 px RGBA picture (row-major, 4 bytes per pixel) to the stored hash. */
export function encodeThumbHash(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): string {
  if (width <= 0 || height <= 0 || width > BLUR_SOURCE_MAX_PX || height > BLUR_SOURCE_MAX_PX) throw new Error('ThumbHash wants a picture of at most 100 px a side');
  if (rgba.length !== width * height * 4) throw new Error('RGBA length does not match the size');
  return toBase64(rgbaToThumbHash(width, height, rgba));
}

/** What the readers and the validators accept as a stored hash. */
export function isBlurHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_RE.test(value) && value.length >= 8 && value.length <= 64;
}

const dataUrlMemo = new Map<string, string>();
const MEMO_CAP = 200;

/** The hash as a PNG data URL (a 32 px blurred picture) — memoized; a bad hash is an empty string. */
export function blurHashToDataUrl(hash: string): string {
  const cached = dataUrlMemo.get(hash);
  if (cached !== undefined) return cached;
  let url = '';
  try {
    url = isBlurHash(hash) ? thumbHashToDataURL(fromBase64(hash)) : '';
  } catch {
    url = '';
  }
  if (dataUrlMemo.size >= MEMO_CAP) dataUrlMemo.delete(dataUrlMemo.keys().next().value as string);
  dataUrlMemo.set(hash, url);
  return url;
}

/** The hash's average colour as CSS — the instant fill before the data URL paints. */
export function averageColor(hash: string): string {
  if (!isBlurHash(hash)) return 'transparent';
  try {
    const { r, g, b } = thumbHashToAverageRGBA(fromBase64(hash));
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  } catch {
    return 'transparent';
  }
}

/**
 * The hash of an image Blob (a photo, a poster) — browser-only: decoded to a
 * ≤ 100 px canvas, read back, encoded. Null on any failure or past the
 * deadline; never throws. Runs on the queue's DEVICE chain, after the tile.
 */
export async function blurHashFromBlob(blob: Blob, deadlineMs = 2000): Promise<string | null> {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), deadlineMs); });
  const work = (async () => {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, BLUR_SOURCE_MAX_PX / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      canvas.width = 0;
      canvas.height = 0;
      return encodeThumbHash(data, w, h);
    } catch {
      return null;
    } finally {
      bitmap?.close?.();
    }
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
