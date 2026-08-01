import { describe, it, expect } from 'vitest';
import { buildMirrorHoles, buildMirrorMedia } from '../round-mirror';

const hole = (hole_number: number, strokes: number) => ({
  hole_number, strokes, putts: 2, fairway_hit: true, green_in_regulation: false,
});

describe('buildMirrorHoles', () => {
  it('takes par and yardage from the round hole_data', () => {
    const rows = buildMirrorHoles(
      [hole(1, 4), hole(2, 3)],
      [
        { hole: 1, par: 5, yardage: 520 },
        { hole: 2, par: 3, yardage: 165 },
      ]
    );
    expect(rows[0]).toMatchObject({ hole_number: 1, par: 5, distance_yards: 520, strokes: 4 });
    expect(rows[1]).toMatchObject({ hole_number: 2, par: 3, distance_yards: 165, strokes: 3 });
  });

  it('falls back to par 4 / null yardage when hole_data is absent or missing the hole', () => {
    const rows = buildMirrorHoles([hole(7, 6)], null);
    expect(rows[0]).toMatchObject({ hole_number: 7, par: 4, distance_yards: null });

    const partial = buildMirrorHoles([hole(7, 6)], [{ hole: 1, par: 5 }]);
    expect(partial[0].par).toBe(4);
  });

  it('carries all score fields through', () => {
    const rows = buildMirrorHoles([hole(3, 5)], [{ hole: 3, par: 4 }]);
    expect(rows[0]).toEqual({
      hole_number: 3, par: 4, distance_yards: null,
      strokes: 5, putts: 2, fairway_hit: true, green_in_regulation: false,
    });
  });
});

describe('buildMirrorMedia', () => {
  const m = (
    media_url: string,
    hole_number: number | null,
    created_at = '2026-07-29T10:00:00Z',
    media_type = 'image'
  ) => ({ media_url, media_type, hole_number, created_at });

  it('orders round media first, then by hole, then by capture time', () => {
    const rows = buildMirrorMedia(
      [
        m('h5', 5),
        m('late-3', 3, '2026-07-29T12:00:00Z'),
        m('round', null),
        m('early-3', 3, '2026-07-29T09:00:00Z'),
      ],
      [],
      1
    );
    expect(rows.map(r => r.media_url)).toEqual(['round', 'early-3', 'late-3', 'h5']);
    expect(rows.map(r => r.display_order)).toEqual([1, 2, 3, 4]);
  });

  it('skips media the post already has — this is what makes the mirror re-runnable', () => {
    // mirrorCompletedRound re-runs on late score edits; a second pass must not
    // duplicate the carousel.
    const rows = buildMirrorMedia([m('a', 1), m('b', 2)], ['a'], 4);
    expect(rows).toEqual([{ media_url: 'b', media_type: 'image', display_order: 4 }]);
  });

  it('returns nothing when everything is already mirrored', () => {
    expect(buildMirrorMedia([m('a', 1), m('b', 2)], ['a', 'b'], 3)).toEqual([]);
  });

  it('dedupes within the input as well', () => {
    const rows = buildMirrorMedia([m('a', 1), m('a', 2)], [], 1);
    expect(rows).toHaveLength(1);
  });

  it('continues display_order from what the post already has', () => {
    // Preserves any media attached by another path — the mirror appends.
    const rows = buildMirrorMedia([m('new', 1)], ['existing'], 7);
    expect(rows[0].display_order).toBe(7);
  });

  it('carries media_type through', () => {
    const rows = buildMirrorMedia([m('clip', 18, '2026-07-29T10:00:00Z', 'video')], [], 1);
    expect(rows[0].media_type).toBe('video');
  });

  it('ignores rows with no url', () => {
    expect(buildMirrorMedia([m('', 1)], [], 1)).toEqual([]);
  });
});
