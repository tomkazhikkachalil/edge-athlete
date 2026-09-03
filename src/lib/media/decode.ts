/**
 * EXIF-safe image decoding (browser-only — keep thin; the probe decision is
 * unit-tested in orientation-probe.test.ts).
 *
 * Orientation is baked into pixels at decode so every downstream consumer
 * (react-easy-crop coordinates, crop math, export canvas, the upload-time
 * bake) works in one coordinate space with zero orientation branches. Canvas
 * re-encode then strips EXIF from the output — the uploaded file can never
 * disagree with its pixels (and GPS metadata is dropped, a small privacy win).
 *
 * Two decoders, chosen ONCE per session by a real probe (Sep 2026):
 *   - `createImageBitmap(file, { imageOrientation: 'from-image' })` — but
 *     WebKit accepted that option for years before honouring it (EXIF in
 *     ImageBitmap: Safari/iOS 16.x). On an older WebKit the call succeeds and
 *     the pixels come back sideways; the bake then strips the tag — the exact
 *     "photos display sideways" Tom saw. So the option is never trusted blind.
 *   - `<img>` + `img.decode()` — applies EXIF in every target since Safari
 *     13.1 (CSS image-orientation: from-image is the default), and drawImage
 *     of that element draws the oriented pixels.
 */

import { exifHonoured, orientationProbeBytes } from './orientation-probe';

export interface DecodedImage {
  /** Drawable source with orientation already applied. */
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Release decoder memory — call as soon as the last draw completes. */
  close(): void;
}

let bitmapHonoursExif: Promise<boolean> | null = null;

/** One 955-byte decode per session: does createImageBitmap apply EXIF here? */
export function createImageBitmapHonoursExif(): Promise<boolean> {
  if (bitmapHonoursExif) return bitmapHonoursExif;
  bitmapHonoursExif = (async () => {
    try {
      if (typeof createImageBitmap !== 'function') return false;
      const blob = new Blob([orientationProbeBytes() as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const honoured = exifHonoured(bitmap.width, bitmap.height);
      bitmap.close();
      return honoured;
    } catch {
      return false;
    }
  })();
  return bitmapHonoursExif;
}

async function decodeViaImg(file: File): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export async function decodeImage(file: File): Promise<DecodedImage> {
  if (await createImageBitmapHonoursExif()) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Format unsupported by the bitmap path (HEIC on some builds) — the
      // <img> route below is the same fallback it always was.
    }
  }
  return decodeViaImg(file);
}
