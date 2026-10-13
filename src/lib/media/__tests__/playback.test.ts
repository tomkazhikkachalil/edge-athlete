import { describe, it, expect } from 'vitest';
import { canPlayCodec, mimeForCodec } from '../playback';

// Video posters PR 8 (Oct 13 2026): can THIS device play that codec?

describe('mimeForCodec / canPlayCodec', () => {
  it('names the MIME canPlayType understands for each stored codec; unknown is null', () => {
    expect(mimeForCodec('avc')).toMatch(/^video\/mp4; codecs="avc1/);
    expect(mimeForCodec('hevc')).toMatch(/^video\/mp4; codecs="hvc1/);
    expect(mimeForCodec('vp9')).toMatch(/^video\/webm/);
    expect(mimeForCodec('av1')).toMatch(/av01/);
    expect(mimeForCodec('unknown')).toBeNull();
    expect(mimeForCodec(null)).toBeNull();
  });
  it('probably / maybe are yes, "" is no, an unknown codec is null (assume playable), no media element is null', () => {
    expect(canPlayCodec('hevc', () => 'probably')).toBe(true);
    expect(canPlayCodec('hevc', () => 'maybe')).toBe(true);
    expect(canPlayCodec('hevc', () => '')).toBe(false);
    expect(canPlayCodec('unknown', () => 'probably')).toBeNull();
    expect(canPlayCodec(null, () => 'probably')).toBeNull();
    expect(canPlayCodec('avc')).toBeNull(); // node: no document
  });
});
