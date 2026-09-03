/**
 * The one post-media upload call (browser-only). Replaces the FormData block
 * that was copy-pasted across five surfaces. Editor output or original file
 * in, public URL out — auth comes from the session cookie server-side.
 *
 * Every JPEG is metadata-stripped (lossless, see exif-strip.ts) before it
 * leaves the device: editor-rendered files are already clean (canvas
 * re-encode), but un-edited uploads and the preserved non-destructive
 * originals used to ship phone-camera GPS byte-for-byte. A JPEG whose EXIF
 * says it is rotated is baked upright FIRST (see bakeOrientation) — the
 * strip alone erased the Orientation tag and shipped sideways pixels. Since Wave 6,
 * MP4/MOV containers get the same treatment via a mediabunny stream-copy
 * re-mux (packets copied, container rewritten — the phone-camera GPS/©xyz
 * and creation atoms don't survive; rotation rides the track matrix, which
 * does). WebM is skipped like non-JPEG images: no phone writes GPS there.
 * Both scrubs fail OPEN — an upload must never die in the scrubber.
 */

import { jpegOrientation, stripJpegMetadata } from './exif-strip';
import { serialize } from './scrub-queue';

export interface UploadedMedia {
  url: string;
  type: 'image' | 'video';
}

/**
 * Rotated phone photos (EXIF Orientation ≠ 1) are baked upright first: the
 * lossless strip below removes the APP1 segment that carries Orientation, so
 * stripping alone left portraits stored sideways with nothing for the browser
 * to auto-orient from (Sep 2026). The bake goes through the editor's own
 * decode → canvas → JPEG path (orientation applied at decode, EXIF gone with
 * the re-encode), at full resolution up to the canvas cap. Photos whose tag
 * says upright (or that carry none) still take the byte-level path and lose
 * no quality. The render module is imported lazily so surfaces that never
 * see a rotated photo (messages, vitals) don't carry it.
 *
 * COST — this is NOT the rare path. A phone camera stamps every portrait
 * shot (and half the landscape ones) with Orientation 6/8/3, so on a phone
 * nearly every un-edited capture bakes: a full-resolution decode plus a
 * 12MP canvas and a JPEG encode on the main thread. One at a time that is
 * the same work the editor does on open; several at once killed mobile
 * Safari tabs the day this shipped (the composer uploaded in parallel).
 * Hence `serialize` around every scrub in uploadPostMedia, and the header-
 * slice probe below so the bake never holds a second full copy of the file.
 */
const BAKE_QUALITY = 0.92;

/**
 * Bytes read to decide whether a bake is needed. An APP1 segment is at most
 * 64KB and phone cameras write it first, so this always covers the EXIF.
 * An orientation tag that somehow sits past the slice reads as `null` and
 * the photo takes the pre-Sep-2026 lossless-strip path — the failure mode is
 * "sideways", never "an extra 12MB in memory during the bake".
 */
const ORIENTATION_PROBE_BYTES = 256 * 1024;

async function bakeOrientation(file: File): Promise<File> {
  const [{ renderImage }, { defaultImageRecipe }, { MAX_CANVAS_DIM }] = await Promise.all([
    import('./render'),
    import('./recipes'),
    import('./limits'),
  ]);
  const blob = await renderImage(file, defaultImageRecipe(), {
    maxDimension: MAX_CANVAS_DIM,
    mime: 'image/jpeg',
    quality: BAKE_QUALITY,
  });
  // Safari can fall back to PNG when it lacks an encoder; trust the bytes.
  const mime = blob.type || 'image/jpeg';
  const name = mime === 'image/jpeg' ? file.name : file.name.replace(/\.[^.]+$/, '') + '.png';
  return new File([blob], name, { type: mime });
}

async function withoutJpegMetadata(file: File): Promise<File> {
  if (file.type !== 'image/jpeg') return file;
  try {
    const head = new Uint8Array(await file.slice(0, ORIENTATION_PROBE_BYTES).arrayBuffer());
    const orientation = jpegOrientation(head);
    if (orientation !== null && orientation !== 1) {
      try {
        return await bakeOrientation(file); // canvas output carries no EXIF
      } catch (err) {
        // Fall through to the lossless strip: a sideways photo beats a failed
        // upload, and the strip is still the privacy control.
        console.warn('[upload] orientation bake failed; stripping metadata only:', err);
      }
    }
    // Only the strip needs the whole file in memory — read it after the bake
    // decision so the decode above never coexists with a second full copy.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const out = stripJpegMetadata(bytes);
    if (out === bytes) return file; // nothing to strip
    // TS 5.7 typed-array generics: Uint8Array<ArrayBufferLike> isn't a
    // BlobPart; the array was freshly allocated over a plain ArrayBuffer.
    return new File([out as Uint8Array<ArrayBuffer>], file.name, { type: file.type });
  } catch (err) {
    // Fail open — an upload must never die in the scrubber — but never
    // silently: this is a privacy control.
    console.warn('[upload] JPEG metadata strip failed; uploading as-is:', err);
    return file;
  }
}

/** Containers phones actually write GPS into (MOV ©xyz / MP4 udta+keys). */
const SCRUBBABLE_VIDEO = new Set(['video/mp4', 'video/quicktime']);

async function withoutVideoMetadata(file: File): Promise<File> {
  if (!SCRUBBABLE_VIDEO.has(file.type)) return file;
  try {
    // Dynamic import — house rule (video.ts): mediabunny stays out of every
    // bundle until a video is actually touched. A metadata-only Conversion
    // stream-copies packets (no WebCodecs decode/encode), so this runs even
    // on browsers the editor's trim path can't serve.
    const { Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat } =
      await import('mediabunny');
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    // `tags` is load-bearing: without it Conversion COPIES the input's
    // descriptive metadata — GPS ©xyz included — into the fresh container,
    // making the re-mux a privacy no-op (caught by the Wave-6 prod probe:
    // an injected coordinate atom survived). Empty tags = write none;
    // rotation is track-matrix data, not a tag, and still carries over.
    const conversion = await Conversion.init({ input, output, tags: () => ({}) });
    // A dropped track (codec the container can't carry and this browser
    // can't transcode) would lose CONTENT to save metadata — wrong trade;
    // upload the original and let the composer's caveat stand for it.
    if (!conversion.isValid || conversion.discardedTracks.length > 0) {
      console.warn('[upload] video metadata strip unsupported for this file; uploading as-is');
      return file;
    }
    await conversion.execute();
    const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
    if (!buffer) return file;
    return new File([buffer], file.name.replace(/\.(mov|qt)$/i, '.mp4'), { type: 'video/mp4' });
  } catch (err) {
    // Fail open, never silently — this is a privacy control (JPEG stance).
    console.warn('[upload] video metadata strip failed; uploading as-is:', err);
    return file;
  }
}

/**
 * `targetProfileId`: set when a guardian uploads media that will belong to a
 * managed athlete's content (acting-as). The server validates it with the
 * acting-as gate and keys storage to the ATHLETE's prefix — omitting it on an
 * acting-as upload mis-attributes the bytes to the guardian.
 */
export async function uploadPostMedia(file: File, targetProfileId?: string): Promise<UploadedMedia> {
  const formData = new FormData();
  // ONE scrub alive at a time app-wide (scrub-queue.ts) — the bake and the
  // re-mux are each a full-file decode in memory. The request below is
  // outside the queue, so uploads still overlap with the next scrub.
  const scrubbed = await serialize(() =>
    file.type.startsWith('video/') ? withoutVideoMetadata(file) : withoutJpegMetadata(file)
  );
  formData.append('file', scrubbed);
  if (targetProfileId) formData.append('targetProfileId', targetProfileId);
  const response = await fetch('/api/upload/post-media', { method: 'POST', body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.url) {
    throw new Error(payload.error || 'Failed to upload media');
  }
  return { url: payload.url, type: payload.type === 'video' ? 'video' : 'image' };
}
