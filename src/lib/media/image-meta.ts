/**
 * The server's word on an uploaded image (maintenance pass, Oct 10 2026).
 * Pure, zero I/O — unit-tested in image-meta.test.ts.
 *
 * Until now the GPS strip ran only on the device (exif-strip.ts, before the
 * upload): a client that skipped it — an old tab, a script, a direct PUT to
 * the signed URL — stored a photo's location in a public bucket, and nothing
 * on the server read the bytes to see whether the file was the image it
 * claimed to be. Every image door now runs `prepareImage`:
 *   1. SNIFF the real format from the magic bytes; a file whose bytes are not
 *      the declared type is refused (never stored).
 *   2. STRIP location and identifying metadata, losslessly, at the byte level
 *      (never a re-encode): JPEG — APP1 (EXIF/XMP) and APP13 (IPTC), keeping
 *      a minimal Orientation tag; PNG — eXIf, iTXt, tEXt, zTXt chunks; WebP —
 *      EXIF and XMP chunks (and their VP8X flags). GIF carries no EXIF.
 * Fail-open on a parse problem (the bytes go through as they are, like the
 * device strip): an upload never dies in the scrubber. `changed` says whether
 * anything was removed, so a door only re-writes when it must.
 */

import { stripJpegMetadataKeepOrientation } from './exif-strip';

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const ascii = (b: Uint8Array, at: number, s: string) => {
  if (at + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};

/** The image format the BYTES say, or null for anything else. */
export function sniffImage(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG\r\n\x1a\n')) return 'image/png';
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'image/gif';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';
  return null;
}

const PNG_DROP = new Set(['eXIf', 'iTXt', 'tEXt', 'zTXt']);

function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  let dropped = false;
  while (at + 12 <= bytes.length) {
    const len = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    const end = at + 12 + len;
    if (end > bytes.length) return bytes; // malformed → untouched
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (PNG_DROP.has(type)) dropped = true;
    else parts.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') break;
  }
  if (!dropped) return bytes;
  if (at < bytes.length) parts.push(bytes.subarray(at));
  return concat(parts);
}

function stripWebp(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12) return bytes;
  const parts: Uint8Array[] = [];
  let at = 12;
  let dropped = false;
  let vp8xIndex = -1;
  while (at + 8 <= bytes.length) {
    const size = (bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24)) >>> 0;
    const end = at + 8 + size + (size & 1);
    if (at + 8 + size > bytes.length) return bytes; // malformed → untouched
    const fourcc = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    if (fourcc === 'EXIF' || fourcc === 'XMP ') dropped = true;
    else {
      if (fourcc === 'VP8X') vp8xIndex = parts.length;
      parts.push(bytes.subarray(at, Math.min(end, bytes.length)));
    }
    at = end;
  }
  if (!dropped) return bytes;
  if (vp8xIndex >= 0) {
    const chunk = parts[vp8xIndex].slice();
    if (chunk.length > 8) chunk[8] &= ~(0x08 | 0x04); // the EXIF and XMP flags
    parts[vp8xIndex] = chunk;
  }
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(bytes.subarray(0, 12), 0);
  out.set(body, 12);
  const riff = out.length - 8;
  out[4] = riff & 0xff;
  out[5] = (riff >>> 8) & 0xff;
  out[6] = (riff >>> 16) & 0xff;
  out[7] = (riff >>> 24) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Metadata removed, losslessly; `changed` is false when nothing was there. */
export function stripImageMetadata(bytes: Uint8Array, type: ImageMime): { bytes: Uint8Array; changed: boolean } {
  let out = bytes;
  try {
    if (type === 'image/jpeg') out = stripJpegMetadataKeepOrientation(bytes);
    else if (type === 'image/png') out = stripPng(bytes);
    else if (type === 'image/webp') out = stripWebp(bytes);
  } catch {
    out = bytes;
  }
  return sameBytes(out, bytes) ? { bytes, changed: false } : { bytes: out, changed: true };
}

export type PreparedImage = { ok: true; bytes: Uint8Array; changed: boolean } | { ok: false; error: string };

export const IMAGE_MISMATCH_ERROR = 'That file is not the image it says it is';

/** Sniff, then strip. Refuses bytes that are not the declared image type. */
export function prepareImage(bytes: Uint8Array, declared: string): PreparedImage {
  const real = sniffImage(bytes);
  if (!real || real !== declared) return { ok: false, error: IMAGE_MISMATCH_ERROR };
  return { ok: true, ...stripImageMetadata(bytes, real) };
}
