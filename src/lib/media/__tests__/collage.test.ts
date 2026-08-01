import { describe, it, expect } from 'vitest';
import { collageLayout } from '../collage';

describe('collageLayout', () => {
  it('renders nothing for zero or nonsense counts', () => {
    for (const n of [0, -1, NaN, Infinity]) {
      const l = collageLayout(n);
      expect(l.visibleCount).toBe(0);
      expect(l.itemClasses).toEqual([]);
      expect(l.overflow).toBe(0);
    }
  });

  it('1 item → one large tile', () => {
    const l = collageLayout(1);
    expect(l.visibleCount).toBe(1);
    expect(l.itemClasses).toHaveLength(1);
    expect(l.overflow).toBe(0);
  });

  it('2 items → side by side', () => {
    const l = collageLayout(2);
    expect(l.containerClass).toContain('grid-cols-2');
    expect(l.visibleCount).toBe(2);
    expect(l.overflow).toBe(0);
  });

  it('3 items → one large plus two stacked', () => {
    const l = collageLayout(3);
    expect(l.visibleCount).toBe(3);
    // The first tile spans both rows; the other two take one cell each.
    expect(l.itemClasses[0]).toContain('row-span-2');
    expect(l.itemClasses[1]).not.toContain('row-span-2');
    expect(l.itemClasses[2]).not.toContain('row-span-2');
    expect(l.overflow).toBe(0);
  });

  it('4 items → even grid with nothing hidden', () => {
    const l = collageLayout(4);
    expect(l.visibleCount).toBe(4);
    expect(l.overflow).toBe(0);
  });

  it('5+ items → even grid with the remainder counted for a "+N" badge', () => {
    expect(collageLayout(5).overflow).toBe(1);
    expect(collageLayout(9).overflow).toBe(5); // the spec's "+5" example
    expect(collageLayout(9).visibleCount).toBe(4);
  });

  it('EVERY layout pins its own aspect ratio', () => {
    // The whole point: the container defines the box so no image can size it.
    // A layout without an aspect on either container or item would let a tall
    // photo stretch the row track — the original letterboxing bug.
    for (const n of [1, 2, 3, 4, 7]) {
      const l = collageLayout(n);
      const pinned =
        l.containerClass.includes('aspect-') ||
        l.itemClasses.every(c => c.includes('aspect-'));
      expect(pinned, `count ${n} has no pinned aspect ratio`).toBe(true);
    }
  });

  it('emits exactly one class entry per visible tile', () => {
    for (const n of [1, 2, 3, 4, 12]) {
      const l = collageLayout(n);
      expect(l.itemClasses).toHaveLength(l.visibleCount);
    }
  });

  it('honours a custom max and never renders more than it has', () => {
    expect(collageLayout(10, 2)).toMatchObject({ visibleCount: 2, overflow: 8 });
    expect(collageLayout(1, 4)).toMatchObject({ visibleCount: 1, overflow: 0 });
    expect(collageLayout(2, 6)).toMatchObject({ visibleCount: 2, overflow: 0 });
  });

  it('clamps a nonsense max rather than rendering an empty collage', () => {
    // max 0 would otherwise claim "3 hidden" while showing nothing.
    expect(collageLayout(3, 0).visibleCount).toBe(1);
    expect(collageLayout(3, -5).visibleCount).toBe(1);
  });

  it('visibleCount + overflow always equals the total', () => {
    for (const n of [1, 2, 3, 4, 5, 20]) {
      const l = collageLayout(n);
      expect(l.visibleCount + l.overflow).toBe(n);
    }
  });
});
