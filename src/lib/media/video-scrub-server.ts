/**
 * Server-side video metadata scrub (Capture v2, Sep 3 2026). Runs inside
 * /api/upload/post-media, before the storage write, for the containers phones
 * write GPS into (MOV ©xyz / MP4 udta + keys). A mediabunny metadata-only
 * Conversion stream-copies the packets into a fresh MP4 with NO tags —
 * `tags: () => ({})` is load-bearing: without it the Conversion COPIES the
 * input's descriptive metadata, GPS included (caught by the Wave-6 prod probe
 * when this ran client-side). Rotation is track-matrix data, not a tag, and
 * carries over. No WebCodecs needed, so it runs in Node.
 *
 * Moved here from the client (upload.ts) because the same re-mux on the main
 * thread of a phone, whole file in memory, N videos at once, is where a
 * 5-second clip froze. Fail OPEN: any problem stores the original and says
 * so in the response (`scrubbed: false`) — an upload never dies here.
 */

export const SCRUBBABLE_VIDEO = new Set(['video/mp4', 'video/quicktime']);

export interface ScrubResult {
  bytes: Uint8Array;
  mime: string;
  scrubbed: boolean;
}

export async function scrubVideoMetadata(bytes: Uint8Array, mime: string): Promise<ScrubResult> {
  if (!SCRUBBABLE_VIDEO.has(mime) || bytes.length === 0) return { bytes, mime, scrubbed: false };
  try {
    const { Input, Output, Conversion, ALL_FORMATS, BufferSource, BufferTarget, Mp4OutputFormat } =
      await import('mediabunny');
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const conversion = await Conversion.init({ input, output, tags: () => ({}) });
    // A dropped track (a codec the container can't carry) would lose CONTENT
    // to save metadata — wrong trade; store the original.
    if (!conversion.isValid || conversion.discardedTracks.length > 0) {
      console.warn('[upload] video metadata scrub unsupported for this file; storing as-is');
      return { bytes, mime, scrubbed: false };
    }
    await conversion.execute();
    const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
    if (!buffer || buffer.byteLength === 0) return { bytes, mime, scrubbed: false };
    return { bytes: new Uint8Array(buffer), mime: 'video/mp4', scrubbed: true };
  } catch (err) {
    console.warn('[upload] video metadata scrub failed; storing as-is:', err);
    return { bytes, mime, scrubbed: false };
  }
}
