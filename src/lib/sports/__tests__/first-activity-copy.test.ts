import { describe, expect, it } from 'vitest';
import { firstActivityCopy } from '../first-activity-copy';

describe('firstActivityCopy (Round 4 — the checklist speaks the sport)', () => {
  it('golf and unknown keep the round', () => {
    expect(firstActivityCopy('golf').label).toBe('Log your first round');
    expect(firstActivityCopy(null).cta).toBe('Log a round →');
    expect(firstActivityCopy('curling').label).toBe('Log your first round');
  });
  it('a stat-line sport uses its activity noun and hero stat', () => {
    expect(firstActivityCopy('ice_hockey')).toEqual({ label: 'Log your first game', hint: 'Your points start adding up, season by season.', cta: 'Log a game →' });
    expect(firstActivityCopy('volleyball').label).toBe('Log your first match');
    expect(firstActivityCopy('track_field')).toMatchObject({ label: 'Log your first race', hint: 'Your times become personal bests, season by season.' });
  });
});
