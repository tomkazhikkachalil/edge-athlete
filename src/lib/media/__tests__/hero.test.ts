import { describe, it, expect } from 'vitest';
import { pickHeroMedia, pickOverviewMedia, type HeroCandidate } from '../hero';

const item = (over: Partial<HeroCandidate> & { id: string }): HeroCandidate => ({
  kind: 'image',
  segment: null,
  isHighlight: false,
  position: null,
  createdAt: null,
  ...over,
});

describe('pickHeroMedia — the chain, in order', () => {
  it('1. an explicit highlight beats everything', () => {
    const hero = pickHeroMedia([
      item({ id: 'video', kind: 'video' }),
      item({ id: 'best', segment: 7 }),
      item({ id: 'chosen', isHighlight: true }),
    ], { bestSegment: 7 });
    expect(hero!.id).toBe('chosen');
  });

  it('2. a video beats a still when nothing is flagged', () => {
    const hero = pickHeroMedia([
      item({ id: 'photo', segment: 7 }),
      item({ id: 'clip', kind: 'video' }),
    ], { bestSegment: 7 });
    expect(hero!.id).toBe('clip');
  });

  it('3. the best segment wins among stills', () => {
    const hero = pickHeroMedia([
      item({ id: 'hole1', segment: 1 }),
      item({ id: 'hole7', segment: 7 }),
    ], { bestSegment: 7 });
    expect(hero!.id).toBe('hole7');
  });

  it('4. otherwise the earliest', () => {
    const hero = pickHeroMedia([
      item({ id: 'late', position: 5 }),
      item({ id: 'early', position: 1 }),
    ]);
    expect(hero!.id).toBe('early');
  });

  it('skips a rung that has no candidates rather than returning null', () => {
    // No highlight, no video, and nothing on the best segment.
    const hero = pickHeroMedia([item({ id: 'only', segment: 2, position: 3 })], { bestSegment: 9 });
    expect(hero!.id).toBe('only');
  });

  it('returns null only when there is genuinely nothing', () => {
    expect(pickHeroMedia([])).toBeNull();
    expect(pickHeroMedia([], { bestSegment: 3 })).toBeNull();
  });

  it('tolerates a missing bestSegment', () => {
    expect(pickHeroMedia([item({ id: 'a' })], {})!.id).toBe('a');
    expect(pickHeroMedia([item({ id: 'a' })], { bestSegment: null })!.id).toBe('a');
  });
});

describe('pickHeroMedia — stability', () => {
  it('is STABLE: input order cannot change the answer', () => {
    // The hero must not differ between renders, or between two people looking
    // at the same round. Duplicate highlights are tolerated by design (no
    // partial unique index), so ties are a real case, not a hypothetical.
    const items = [
      item({ id: 'b', isHighlight: true, position: 2 }),
      item({ id: 'a', isHighlight: true, position: 1 }),
      item({ id: 'c', isHighlight: true, position: 3 }),
    ];
    expect(pickHeroMedia(items)!.id).toBe('a');
    expect(pickHeroMedia([...items].reverse())!.id).toBe('a');
  });

  it('breaks position ties on capture time, then on id', () => {
    expect(pickHeroMedia([
      item({ id: 'z', createdAt: '2026-08-01T10:00:00Z' }),
      item({ id: 'a', createdAt: '2026-08-01T09:00:00Z' }),
    ])!.id).toBe('a');
    // Wholly indistinguishable rows still resolve the same way every time.
    expect(pickHeroMedia([item({ id: 'z' }), item({ id: 'a' })])!.id).toBe('a');
  });

  it('does not mutate the array it was given', () => {
    const items = [item({ id: 'z', position: 9 }), item({ id: 'a', position: 1 })];
    pickHeroMedia(items);
    expect(items.map(i => i.id)).toEqual(['z', 'a']);
  });
});

describe('pickOverviewMedia', () => {
  it('leads with the hero and never repeats it', () => {
    const out = pickOverviewMedia([
      item({ id: 'a', position: 1 }),
      item({ id: 'clip', kind: 'video', position: 5 }),
      item({ id: 'b', position: 2 }),
    ]);
    expect(out.map(i => i.id)).toEqual(['clip', 'a']);
    expect(new Set(out.map(i => i.id)).size).toBe(out.length);
  });

  it('returns fewer than asked when there are fewer items', () => {
    expect(pickOverviewMedia([item({ id: 'only' })], {}, 2).map(i => i.id)).toEqual(['only']);
    expect(pickOverviewMedia([], {}, 2)).toEqual([]);
  });

  it('honours n, including nonsense values', () => {
    const items = [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })];
    expect(pickOverviewMedia(items, {}, 1)).toHaveLength(1);
    expect(pickOverviewMedia(items, {}, 3)).toHaveLength(3);
    expect(pickOverviewMedia(items, {}, 0)).toEqual([]);
    expect(pickOverviewMedia(items, {}, -1)).toEqual([]);
  });

  it('agrees with pickHeroMedia about which item leads', () => {
    const items = [
      item({ id: 'a', position: 3 }),
      item({ id: 'best', segment: 4, position: 2 }),
      item({ id: 'c', position: 1 }),
    ];
    const ctx = { bestSegment: 4 };
    expect(pickOverviewMedia(items, ctx)[0].id).toBe(pickHeroMedia(items, ctx)!.id);
  });
});
