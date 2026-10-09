/**
 * HEIC → JPEG in the browser, for a browser that cannot decode HEIC itself
 * (every-phone round PR 6, Oct 9 2026). Client-only.
 *
 * Who reaches this: a Samsung with "high efficiency pictures" on, in Chrome
 * or Samsung Internet. Chrome on Android has no HEIC decoder, so until now
 * that photo was skipped with "Could not process file". iPhones never do —
 * Safari transcodes to JPEG before a web page sees the file — and a browser
 * that decodes HEIC natively (WebKit on a recent OS) never gets here either:
 * `decodeImage` tries the browser first and calls this only when BOTH its
 * decoders failed AND the file is a HEIF (`heic-brand.ts`).
 *
 * The decoder is libheif compiled to WebAssembly (`libheif-js`, the
 * self-contained bundle — no separate .wasm asset for the bundler to place),
 * imported DYNAMICALLY here and nowhere else, so the ~2 MB chunk is fetched
 * only on that path. libheif applies the file's rotation / mirror transforms
 * itself, so the pixels come out upright; the canvas re-encode drops every
 * other tag (GPS included). Licence: libheif is LGPL-3.0, loaded as a
 * separately fetched module; the wrapper package is MIT.
 *
 * Floor: WebAssembly exists on iOS 11+ / Chrome 57+; the bundle itself was
 * run through `check-browser-syntax` and parses within the iOS 15 floor.
 */

export const HEIC_JPEG_QUALITY = 0.92;

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(
    target: { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number },
    done: (result: { data: Uint8ClampedArray; width: number; height: number } | null) => void
  ): void;
  free(): void;
}

interface LibHeif {
  ready: Promise<unknown>;
  HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[]; decoder: { delete(): void } };
}

let libheifPromise: Promise<LibHeif> | null = null;

/** The decoder module, fetched once per page and only when first needed. */
function loadLibheif(): Promise<LibHeif> {
  if (!libheifPromise) {
    libheifPromise = import('libheif-js/wasm-bundle').then(async mod => {
      const lib = ((mod as { default?: LibHeif }).default ?? (mod as unknown as LibHeif)) as LibHeif;
      await lib.ready;
      return lib;
    });
    libheifPromise.catch(() => { libheifPromise = null; }); // a failed fetch may be retried
  }
  return libheifPromise;
}

/** The primary image of a HEIC file as a JPEG File (upright, metadata-free). */
export async function decodeHeicToJpeg(file: File, quality = HEIC_JPEG_QUALITY): Promise<File> {
  const lib = await loadLibheif();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoder = new lib.HeifDecoder();
  let images: HeifImage[] = [];
  try {
    images = decoder.decode(bytes);
    const image = images[0];
    if (!image) throw new Error('No image in the HEIC file');
    const width = image.get_width();
    const height = image.get_height();
    // libheif fills the buffer we hand it (RGBA, row-major). Allocated over a
    // plain ArrayBuffer so the typed array satisfies ImageData's constructor.
    const pixels = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
    await new Promise<void>((resolve, reject) => {
      image.display({ data: pixels, width, height }, result => {
        if (!result) reject(new Error('HEIC decode failed'));
        else resolve();
      });
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('JPEG encode failed'))), 'image/jpeg', quality);
    });
    canvas.width = 0;
    canvas.height = 0;
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } finally {
    for (const img of images) {
      try { img.free(); } catch { /* already freed */ }
    }
    try { decoder.decoder.delete(); } catch { /* already deleted */ }
  }
}
