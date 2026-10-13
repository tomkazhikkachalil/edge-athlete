// ── Can this device play that codec? (video posters PR 7–8, Oct 13 2026) ────
// The MIME string `HTMLMediaElement.canPlayType` understands for each codec
// we store, and the feature-detected answer. iOS 15-safe: `canPlayType` is
// everywhere; the rest is string work. Zero imports.

const MIME_FOR_CODEC: Readonly<Record<string, string>> = {
  avc: 'video/mp4; codecs="avc1.42E01E"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  vp8: 'video/webm; codecs="vp8"',
  vp9: 'video/webm; codecs="vp9"',
  av1: 'video/mp4; codecs="av01.0.04M.08"',
};

export function mimeForCodec(codec: string | null | undefined): string | null {
  return codec ? MIME_FOR_CODEC[codec] ?? null : null;
}

/** true = this browser says it can play the codec; null = unknown codec or no media element here (assume playable). */
export function canPlayCodec(codec: string | null | undefined, probe?: (mime: string) => string): boolean | null {
  const mime = mimeForCodec(codec);
  if (!mime) return null;
  let ask = probe;
  if (!ask) {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    const el = document.createElement('video');
    if (typeof el.canPlayType !== 'function') return null;
    ask = m => el.canPlayType(m);
  }
  const answer = ask(mime);
  return answer === 'probably' || answer === 'maybe';
}
