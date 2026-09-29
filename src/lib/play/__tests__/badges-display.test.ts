import { describe, expect, it } from 'vitest';
import { badgeShelves, badgeViews, earnedLine, upNext } from '../badges/display';
import { celebrationFor } from '../celebration';

const e = (key: string, earnedOn = '2026-09-20', over: Record<string, unknown> = {}) => ({ key, sportKey: key.split('.')[0] === 'all' ? null : key.split('.')[0], earnedOn, verified: false, detail: {}, ...over });

describe('badge views', () => {
  it('best tier first, then newest; unknown keys dropped', () => {
    const v = badgeViews([e('golf.first_result', '2026-09-01'), e('golf.break_80', '2026-09-02'), e('golf.retired_key'), e('golf.break_100', '2026-09-03')]);
    expect(v.map(x => x.key)).toEqual(['golf.break_80', 'golf.break_100', 'golf.first_result']);
  });
  it('shelves per sport, the biggest first, across-sports last; up next only when asked', () => {
    const shelves = badgeShelves([e('all.two_sports'), e('basketball.first_result'), e('golf.first_result'), e('golf.break_100')], { withNext: true, nextCount: 2 });
    expect(shelves.map(s => s.sportKey)).toEqual(['golf', 'basketball', null]);
    expect(shelves[0].next).toHaveLength(2);
    expect(shelves[0].next.every(d => d.sportKey === 'golf' && d.key !== 'golf.break_100')).toBe(true);
    expect(shelves[2].next).toEqual([]);
    expect(badgeShelves([e('golf.first_result')])[0].next).toEqual([]);
  });
  it('up next is easiest first (bronze before gold)', () => {
    const next = upNext('golf', new Set(['golf.first_result']), 20);
    const tiers = next.map(d => d.tier);
    expect(tiers.indexOf('gold')).toBeGreaterThan(tiers.lastIndexOf('bronze'));
  });
  it('the number that earned it', () => {
    const [v] = badgeViews([e('golf.break_80', '2026-09-01', { detail: { gross: 78 } })]);
    expect(earnedLine(v)).toBe('Shot 78');
    const [p] = badgeViews([e('basketball.points_30', '2026-09-01', { detail: { points: 31 } })]);
    expect(earnedLine(p)).toBe('31 points');
    const [h] = badgeViews([e('golf.handicap_10', '2026-09-01', { detail: { handicap_index: 9.4 } })]);
    expect(earnedLine(h)).toBe('Index 9.4');
  });
});

describe('celebrationFor', () => {
  it('a badge bell celebrates; a guardian copy is a toast only; anything else is nothing', () => {
    expect(celebrationFor({ type: 'achievement', title: 'Badge earned: Broke 80', message: 'x', metadata: { badge_keys: ['golf.break_80'] } })).toEqual({ confetti: true, title: 'Badge earned: Broke 80', message: 'x' });
    expect(celebrationFor({ type: 'achievement', title: 't', metadata: { badge_keys: ['golf.break_80'], profile_id: 'kid' } })?.confetti).toBe(false);
    expect(celebrationFor({ type: 'achievement', title: 't', metadata: {} })).toBeNull();
    expect(celebrationFor({ type: 'like', title: 't', metadata: { badge_keys: ['x'] } })).toBeNull();
  });
});
