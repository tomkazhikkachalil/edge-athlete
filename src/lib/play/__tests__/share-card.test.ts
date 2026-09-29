import { describe, expect, it } from 'vitest';
import { golfShareCard, shareableKind, shareDate, statLineShareCard, toParLabel } from '../share-card';

describe('shareableKind — which posts have a card', () => {
  it('a published public golf round or stat line', () => {
    expect(shareableKind({ visibility: 'public', status: 'published', has_round: true })).toBe('golf');
    expect(shareableKind({ visibility: 'public', status: 'published', stats_data: { type: 'stat_line' } })).toBe('stat_line');
  });
  it('never a private, hidden, pending or non-result post', () => {
    expect(shareableKind({ visibility: 'private', has_round: true })).toBeNull();
    expect(shareableKind({ visibility: 'public', status: 'profile_hidden', has_round: true })).toBeNull();
    expect(shareableKind({ visibility: 'public', status: 'pending_approval', stats_data: { type: 'stat_line' } })).toBeNull();
    expect(shareableKind({ visibility: 'public', status: 'published', stats_data: { type: 'workout_session' } })).toBeNull();
  });
});

describe('the golf card', () => {
  const base = { athleteName: 'Badge Golfer', date: '2026-09-20', gross: 77, par: 72, holes: 18, course: 'Eagle Creek', metrics: { birdies: 1, putts: 31 }, verified: false };
  it('the score, to par, the course, the hole facts', () => {
    const c = golfShareCard(base);
    expect(c).toMatchObject({
      hero: { value: '77', label: '+5 to par' },
      subline: 'Eagle Creek · 18 holes',
      chips: [{ label: 'Birdie', value: '1' }, { label: 'Putts', value: '31' }],
      title: 'Badge Golfer shot 77 at Eagle Creek',
      description: '+5 to par · 18 holes · Sep 20, 2026 · on Edge Athlete',
    });
  });
  it('zeros are left off (an untracked stat is not a brag)', () => {
    expect(golfShareCard({ ...base, metrics: { birdies: 0, putts: 0, gir_pct: 0 } }).chips).toEqual([]);
  });
  it('an ace leads the chips; no par → strokes; at most three chips', () => {
    const c = golfShareCard({ ...base, par: null, metrics: { aces: 1, eagles: 2, birdies: 4, putts: 29, gir_pct: 61.1 } });
    expect(c.hero.label).toBe('Strokes');
    expect(c.chips.map(x => x.label)).toEqual(['Hole-in-one', 'Eagles', 'Birdies']);
  });
  it('to-par labels', () => {
    expect([toParLabel(0), toParLabel(3), toParLabel(-2)]).toEqual(['E', '+3', '−2']);
    expect(shareDate('2026-01-05')).toBe('Jan 5, 2026');
  });
});

describe('the stat-line card — any sport with a schema', () => {
  it('the sport\'s hero stat and its support keys', () => {
    const c = statLineShareCard({ athleteName: 'Edge Q.', sportKey: 'ice_hockey', sportName: 'Ice Hockey', date: '2026-09-10', stats: { goals: 2, assists: 1, shots: 5 }, opponent: 'Wolves', result: 'W', resultScore: '4-2', verified: true });
    expect(c).toMatchObject({ kind: 'stat_line', hero: { value: '3' }, subline: 'vs Wolves · W 4-2', verified: true });
    expect(c!.chips.length).toBeGreaterThan(0);
    expect(c!.chips.length).toBeLessThanOrEqual(3);
    expect(c!.title).toMatch(/^Edge Q\.: 3 /);
  });
  it('a sport without a schema has no card', () => {
    expect(statLineShareCard({ athleteName: 'x', sportKey: 'curling', sportName: 'Curling', date: '2026-09-10', stats: { a: 1 }, verified: false })).toBeNull();
  });
  it('the card carries nothing personal beyond the display name', () => {
    const c = golfShareCard({ athleteName: 'Badge Golfer', date: '2026-09-20', gross: 80, par: 72, holes: 18, course: 'X', metrics: {}, verified: false });
    const json = JSON.stringify(c);
    expect(json).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});
