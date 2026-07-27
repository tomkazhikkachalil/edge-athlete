import { describe, it, expect } from 'vitest';
import {
  isServerAllowedType,
  mediaKindOf,
  requiresReencode,
  validateFiles,
} from '../validation';

const MB = 1024 * 1024;
const fakeFile = (name: string, type: string, size = 1 * MB): File => {
  const f = new File([''], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

const rules = { maxBytes: 5 * MB, allowVideo: true, maxCount: 4 };

describe('validateFiles', () => {
  it('accepts server-allowlisted images and videos', () => {
    const { accepted, rejected } = validateFiles(
      [fakeFile('a.jpg', 'image/jpeg'), fakeFile('b.mp4', 'video/mp4')],
      rules
    );
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(0);
  });

  it('accepts HEIC for editing (re-encode path), never as pass-through', () => {
    const { accepted } = validateFiles([fakeFile('img.heic', 'image/heic')], rules);
    expect(accepted).toHaveLength(1);
    expect(requiresReencode('image/heic')).toBe(true);
    expect(isServerAllowedType('image/heic')).toBe(false);
  });

  it('rejects types the editor cannot save (SVG, TIFF) at pick time', () => {
    const { accepted, rejected } = validateFiles(
      [fakeFile('x.svg', 'image/svg+xml'), fakeFile('y.tiff', 'image/tiff')],
      rules
    );
    expect(accepted).toHaveLength(0);
    expect(rejected.map(r => r.reason)).toEqual(['type', 'type']);
  });

  it('rejects video when the surface disallows it', () => {
    const { rejected } = validateFiles([fakeFile('v.mp4', 'video/mp4')], {
      ...rules,
      allowVideo: false,
    });
    expect(rejected[0].reason).toBe('type');
    expect(rejected[0].message).toContain("videos aren't allowed");
  });

  it('enforces size with a readable message', () => {
    const { rejected } = validateFiles([fakeFile('big.jpg', 'image/jpeg', 12 * MB)], rules);
    expect(rejected[0].reason).toBe('size');
    expect(rejected[0].message).toContain('5MB');
  });

  it('enforces count including already-attached files', () => {
    const files = Array.from({ length: 3 }, (_, i) => fakeFile(`f${i}.jpg`, 'image/jpeg'));
    const { accepted, rejected } = validateFiles(files, { ...rules, existingCount: 2 });
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe('count');
  });

  it('mediaKindOf covers the full matrix', () => {
    expect(mediaKindOf('image/webp')).toBe('image');
    expect(mediaKindOf('image/heif')).toBe('image');
    expect(mediaKindOf('video/quicktime')).toBe('video');
    expect(mediaKindOf('application/pdf')).toBeNull();
  });
});
