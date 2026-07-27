/**
 * EXIF-safe image decoding (browser-only — no unit tests, keep thin).
 *
 * Orientation is baked into pixels at decode so every downstream consumer
 * (react-easy-crop coordinates, crop math, export canvas) works in one
 * coordinate space with zero orientation branches. Canvas re-encode then
 * strips EXIF from the output — the uploaded file can never disagree with
 * its pixels (and GPS metadata is dropped, a small privacy win).
 */

export interface DecodedImage {
  /** Drawable source with orientation already applied. */
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Release decoder memory — call as soon as the last draw completes. */
  close(): void;
}

export async function decodeImage(file: File): Promise<DecodedImage> {
  // Preferred: createImageBitmap applies EXIF via imageOrientation.
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  } catch {
    // Older Safari: options bag or format unsupported. <img> decode applies
    // EXIF by default (CSS image-orientation: from-image) in all targets.
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
}
