import { describe, it, expect } from 'vitest';
import { planCaptureAttach, usableDuration } from '../capture-attach';

const f = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type });

describe('planCaptureAttach', () => {
  it('attaches JPEG/PNG/WebP/MP4/MOV/WebM captures directly', () => {
    const files = [
      f('a.jpg', 'image/jpeg'), f('b.png', 'image/png'), f('c.webp', 'image/webp'),
      f('d.mp4', 'video/mp4'), f('e.mov', 'video/quicktime'), f('g.webm', 'video/webm'),
    ];
    const plan = planCaptureAttach(files);
    expect(plan.attach.map(x => x.name)).toEqual(['a.jpg', 'b.png', 'c.webp', 'd.mp4', 'e.mov', 'g.webm']);
    expect(plan.editor).toEqual([]);
  });
  it('routes HEIC/HEIF to the editor (they must re-encode)', () => {
    const plan = planCaptureAttach([f('h.heic', 'image/heic'), f('i.heif', 'image/heif'), f('j.jpg', 'image/jpeg')]);
    expect(plan.editor.map(x => x.name)).toEqual(['h.heic', 'i.heif']);
    expect(plan.attach.map(x => x.name)).toEqual(['j.jpg']);
  });
});

describe('usableDuration', () => {
  it('accepts finite positive seconds and rejects Infinity/NaN/zero', () => {
    expect(usableDuration(12.5)).toBe(12.5);
    expect(usableDuration(Infinity)).toBeNull();
    expect(usableDuration(NaN)).toBeNull();
    expect(usableDuration(0)).toBeNull();
  });
});
