import { describe, expect, it } from 'vitest';
import { GALLERY_PICKS_MAX, readGalleryPicks } from '../member-photo-gate';

// M2 (program 10): the gallery module's picks, parsed defensively.

const u = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

describe('readGalleryPicks', () => {
  it('keeps well-formed picks in stored order, first occurrence wins, junk dropped', () => {
    const picks = readGalleryPicks({
      picks: [
        { mediaId: u(1), postId: u(11), profileId: u(21), addedAt: '2026-09-03T00:00:00Z' },
        { mediaId: u(1), postId: u(12), profileId: u(22) }, // duplicate
        { mediaId: 'nope', postId: u(11), profileId: u(21) },
        { mediaId: u(2), postId: 'x', profileId: u(21) },
        { mediaId: u(3), postId: u(13), profileId: u(23), addedAt: 7 },
        null,
        'x',
      ],
    });
    expect(picks).toEqual([
      { mediaId: u(1), postId: u(11), profileId: u(21), addedAt: '2026-09-03T00:00:00Z' },
      { mediaId: u(3), postId: u(13), profileId: u(23), addedAt: '' },
    ]);
  });
  it('tolerates a missing/foreign config and caps the list', () => {
    expect(readGalleryPicks(null)).toEqual([]);
    expect(readGalleryPicks({ picks: 'x' })).toEqual([]);
    expect(readGalleryPicks({})).toEqual([]);
    const many = Array.from({ length: GALLERY_PICKS_MAX + 5 }, (_, i) => ({ mediaId: u(100 + i), postId: u(1), profileId: u(2) }));
    expect(readGalleryPicks({ picks: many })).toHaveLength(GALLERY_PICKS_MAX);
  });
});
