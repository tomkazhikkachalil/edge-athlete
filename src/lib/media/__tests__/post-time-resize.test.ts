import { describe, it, expect } from 'vitest';
import { resizedMime, shouldResize } from '../post-time-resize';

describe('shouldResize (post-time resize, speed round 2)', () => {
  it('resizes a camera JPEG over the cap, leaves one that fits', () => {
    expect(shouldResize({ width: 4032, height: 3024 }, 'image/jpeg', 2048)).toEqual({ resize: true, reason: 'oversize' });
    expect(shouldResize({ width: 3024, height: 4032 }, 'image/jpeg', 2048)).toEqual({ resize: true, reason: 'oversize' });
    expect(shouldResize({ width: 2048, height: 1536 }, 'image/jpeg', 2048)).toEqual({ resize: false, reason: 'fits' });
    expect(shouldResize({ width: 800, height: 600 }, 'image/webp', 2048)).toEqual({ resize: false, reason: 'fits' });
  });
  it('never resizes a GIF (animation) or a type the editor owns (HEIC), nor an unmeasured file', () => {
    expect(shouldResize({ width: 9000, height: 9000 }, 'image/gif', 2048)).toEqual({ resize: false, reason: 'type' });
    expect(shouldResize({ width: 9000, height: 9000 }, 'image/heic', 2048)).toEqual({ resize: false, reason: 'type' });
    expect(shouldResize({ width: 9000, height: 9000 }, 'video/mp4', 2048)).toEqual({ resize: false, reason: 'type' });
    expect(shouldResize(null, 'image/jpeg', 2048)).toEqual({ resize: false, reason: 'unknown-size' });
    expect(shouldResize({ width: 0, height: 10 }, 'image/jpeg', 2048)).toEqual({ resize: false, reason: 'unknown-size' });
  });
  it('a PNG stays PNG (transparency); everything else takes the composer\'s mime', () => {
    expect(resizedMime('image/png', 'image/jpeg')).toBe('image/png');
    expect(resizedMime('image/jpeg', 'image/jpeg')).toBe('image/jpeg');
    expect(resizedMime('image/webp', 'image/jpeg')).toBe('image/jpeg');
  });
});
