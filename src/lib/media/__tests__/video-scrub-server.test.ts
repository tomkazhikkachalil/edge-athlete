import { describe, it, expect } from 'vitest';
import { scrubVideoMetadata, SCRUBBABLE_VIDEO } from '../video-scrub-server';

/**
 * The server scrub's CONTRACT is fail-open: whatever happens, the caller gets
 * bytes it can store and an honest `scrubbed` flag. A real MP4 with a ©xyz
 * atom is the production probe's job (a stored object read back) — a unit
 * test cannot synthesise encoded video without an encoder.
 */
describe('scrubVideoMetadata', () => {
  it('leaves non-scrubbable types alone, by reference', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = await scrubVideoMetadata(bytes, 'video/webm');
    expect(out.bytes).toBe(bytes);
    expect(out.scrubbed).toBe(false);
    expect(out.mime).toBe('video/webm');
  });
  it('fails open on bytes that are not a container', async () => {
    const bytes = new Uint8Array(64).fill(0xab);
    const out = await scrubVideoMetadata(bytes, 'video/mp4');
    expect(out.bytes).toBe(bytes);
    expect(out.scrubbed).toBe(false);
  });
  it('fails open on empty input', async () => {
    const out = await scrubVideoMetadata(new Uint8Array(0), 'video/quicktime');
    expect(out.scrubbed).toBe(false);
  });
  it('names exactly the phone containers', () => {
    expect([...SCRUBBABLE_VIDEO].sort()).toEqual(['video/mp4', 'video/quicktime']);
  });
});
