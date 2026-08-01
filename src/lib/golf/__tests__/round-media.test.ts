import { describe, it, expect } from 'vitest';
import { toCollageItems, groupMediaByHole } from '../round-media';
import type { RoundMediaItem } from '@/types/group-posts';

const item = (over: Partial<RoundMediaItem> & { id: string }): RoundMediaItem =>
  ({
    id: over.id,
    media_url: over.media_url ?? `https://x/${over.id}.jpg`,
    media_type: over.media_type ?? 'image',
    hole_number: over.hole_number ?? null,
    uploaded_by: over.uploaded_by ?? 'u1',
    caption: over.caption ?? null,
    thumbnail_url: over.thumbnail_url ?? null,
  }) as RoundMediaItem;

describe('toCollageItems', () => {
  it('returns nothing for empty, null or undefined input', () => {
    expect(toCollageItems([])).toEqual([]);
    expect(toCollageItems(null)).toEqual([]);
    expect(toCollageItems(undefined)).toEqual([]);
  });

  it('orders by hole so the lightbox walks the round as it was played', () => {
    const out = toCollageItems([
      item({ id: 'c', hole_number: 17 }),
      item({ id: 'a', hole_number: 1 }),
      item({ id: 'b', hole_number: 3 }),
    ]);
    expect(out.map(i => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts untagged round-level media LAST, not first', () => {
    // null must not sort as 0 — round-level media belongs to the whole round,
    // not to its opening moment.
    const out = toCollageItems([
      item({ id: 'round', hole_number: null }),
      item({ id: 'h1', hole_number: 1 }),
    ]);
    expect(out.map(i => i.id)).toEqual(['h1', 'round']);
  });

  it('is stable within a hole so order never jitters between renders', () => {
    const input = [
      item({ id: 'b2', hole_number: 3 }),
      item({ id: 'a1', hole_number: 3 }),
    ];
    expect(toCollageItems(input).map(i => i.id)).toEqual(['a1', 'b2']);
    // Same answer from the reversed input — a genuinely total order.
    expect(toCollageItems([...input].reverse()).map(i => i.id)).toEqual(['a1', 'b2']);
  });

  it('does not mutate the array it was given', () => {
    const input = [item({ id: 'z', hole_number: 9 }), item({ id: 'a', hole_number: 1 })];
    toCollageItems(input);
    expect(input.map(i => i.id)).toEqual(['z', 'a']);
  });

  it('maps video type and carries the poster through', () => {
    const [v] = toCollageItems([
      item({ id: 'v', media_type: 'video', thumbnail_url: 'https://x/p.jpg', hole_number: 2 }),
    ]);
    expect(v.kind).toBe('video');
    expect(v.thumbnailUrl).toBe('https://x/p.jpg');
  });

  it('falls back from caption to a hole label, then to a round label', () => {
    expect(toCollageItems([item({ id: 'a', caption: 'Chip in', hole_number: 4 })])[0].alt)
      .toBe('Chip in');
    expect(toCollageItems([item({ id: 'b', hole_number: 4 })])[0].alt).toBe('Hole 4');
    expect(toCollageItems([item({ id: 'c', hole_number: null })])[0].alt).toBe('Round media');
  });
});

describe('groupMediaByHole', () => {
  it('groups while preserving play order, round-level last', () => {
    const groups = groupMediaByHole(
      toCollageItems([
        item({ id: 'r', hole_number: null }),
        item({ id: 'h3a', hole_number: 3 }),
        item({ id: 'h1', hole_number: 1 }),
        item({ id: 'h3b', hole_number: 3 }),
      ])
    );
    expect(groups.map(([hole]) => hole)).toEqual([1, 3, null]);
    expect(groups[1][1].map(i => i.id)).toEqual(['h3a', 'h3b']);
  });

  it('returns nothing for no items', () => {
    expect(groupMediaByHole([])).toEqual([]);
  });

  it('keeps every item — grouping must never drop one', () => {
    const flat = toCollageItems([
      item({ id: 'a', hole_number: 1 }),
      item({ id: 'b', hole_number: 1 }),
      item({ id: 'c', hole_number: 18 }),
      item({ id: 'd', hole_number: null }),
    ]);
    const grouped = groupMediaByHole(flat).flatMap(([, group]) => group);
    expect(grouped).toHaveLength(flat.length);
    // Grouped order matches the flat order the lightbox indexes into — if these
    // ever disagree, tapping a thumbnail opens the wrong item.
    expect(grouped.map(i => i.id)).toEqual(flat.map(i => i.id));
  });
});
