import { describe, it, expect } from 'vitest';
import { buildStatHighlights } from '../post-stat-highlights';
import { STAT_SCHEMAS } from '../stat-schemas';

const statLine = (sport_key: string, stats: Record<string, number>, extra = {}) => ({
  type: 'stat_line',
  sport_key,
  stats,
  ...extra,
});

describe('buildStatHighlights — stat-line sports', () => {
  it('hockey leads with POINTS, which no field stores — it is goals + assists', () => {
    const h = buildStatHighlights({ statsData: statLine('ice_hockey', { goals: 2, assists: 1, shots: 6 }) })!;
    expect(h.hero).toEqual({ value: '3', label: 'Points' });
    expect(h.support).toEqual([
      { value: '2', label: 'G' },
      { value: '1', label: 'A' },
      { value: '6', label: 'S' },
    ]);
  });

  it('basketball leads with points; baseball with hits', () => {
    expect(
      buildStatHighlights({ statsData: statLine('basketball', { points: 24, rebounds: 8, assists: 5 }) })!.hero
    ).toEqual({ value: '24', label: 'Points' });
    expect(
      buildStatHighlights({ statsData: statLine('baseball', { hits: 3, home_runs: 1, rbis: 4 }) })!.hero
    ).toEqual({ value: '3', label: 'Hits' });
  });

  it('volleyball leads with kills, not the setter assists the generic headline would pick', () => {
    // Regression guard: the shared compactLine helper returns the first three
    // non-zero fields in declaration order, which puts assists ahead of aces
    // and contradicts volleyball's own profile tiles.
    const h = buildStatHighlights({
      statsData: statLine('volleyball', { kills: 12, assists: 30, digs: 9, aces: 3 }),
    })!;
    expect(h.hero).toEqual({ value: '12', label: 'Kills' });
    expect(h.support.map(t => t.label)).toEqual(['D', 'ACE']);
  });

  it('caps supporting stats at three even when more were recorded', () => {
    const h = buildStatHighlights({
      statsData: statLine('ice_hockey', { goals: 1, assists: 1, shots: 4, hits: 3, blocks: 2, pim: 2 }),
    })!;
    expect(h.support).toHaveLength(3);
  });

  it('omits stats that were not recorded rather than padding with zeros', () => {
    const h = buildStatHighlights({ statsData: statLine('basketball', { points: 10 }) })!;
    expect(h.support).toEqual([]);
  });

  it('promotes a supporting stat when the hero stat itself is absent', () => {
    // 0 points but 8 rebounds is still a post worth rendering — it must not
    // headline a bare "0".
    const h = buildStatHighlights({ statsData: statLine('basketball', { rebounds: 8, assists: 2 }) })!;
    expect(h.hero).toEqual({ value: '8', label: 'REB' });
    expect(h.support).toEqual([{ value: '2', label: 'AST' }]);
  });

  it('falls back to any recorded stat when neither hero nor support keys apply', () => {
    const h = buildStatHighlights({ statsData: statLine('ice_hockey', { pim: 5 }) })!;
    expect(h.hero).toEqual({ value: '5', label: 'Penalty Minutes' });
  });

  it('returns null when nothing at all was recorded', () => {
    expect(buildStatHighlights({ statsData: statLine('basketball', {}) })).toBeNull();
    expect(buildStatHighlights({ statsData: statLine('basketball', { points: 0, rebounds: 0 }) })).toBeNull();
  });

  it('carries opponent, date and result through for the card header', () => {
    const h = buildStatHighlights({
      statsData: statLine('soccer', { goals: 2 }, {
        opponent: 'Rivals FC', date: '2026-07-17', result: 'W', result_score: '4-2',
      }),
    })!;
    expect(h.moment).toBe('vs Rivals FC');
    expect(h.date).toBe('2026-07-17');
    expect(h.result).toBe('W');
    expect(h.resultScore).toBe('4-2');
  });

  it('falls back to the sport activity noun when no opponent was given', () => {
    expect(buildStatHighlights({ statsData: statLine('volleyball', { kills: 4 }) })!.moment).toBe('Match');
  });

  it('ignores payloads that are not stat lines', () => {
    expect(buildStatHighlights({ statsData: { type: 'vitals_entry', metric_label: 'Weight' } })).toBeNull();
    expect(buildStatHighlights({ statsData: null })).toBeNull();
    expect(buildStatHighlights({})).toBeNull();
  });

  it('every live stat-line schema declares a hero and support keys that exist', () => {
    for (const [sport, schema] of Object.entries(STAT_SCHEMAS)) {
      expect(schema!.heroStat.label, sport).toBeTruthy();
      const keys = schema!.fields.map(f => f.key);
      for (const k of schema!.supportKeys) expect(keys, `${sport}:${k}`).toContain(k);
    }
  });
});

describe('buildStatHighlights — golf', () => {
  const round = (over: Record<string, unknown> = {}) => ({
    course: 'Ottawa Hunt',
    gross_score: 69,
    golf_holes: Array.from({ length: 18 }, () => ({ par: 4 })), // par 72
    ...over,
  });

  it('leads with to-par and keeps the gross score as a supporting stat', () => {
    const h = buildStatHighlights({ sportKey: 'golf', golfRound: round() })!;
    expect(h.hero).toEqual({ value: '-3', label: 'To Par' });
    expect(h.heroToPar).toBe(-3);
    expect(h.support[0]).toEqual({ value: '69', label: 'Score' });
    expect(h.moment).toBe('Ottawa Hunt');
  });

  it('renders level par as E and over par with an explicit +', () => {
    expect(buildStatHighlights({ sportKey: 'golf', golfRound: round({ gross_score: 72 }) })!.hero.value).toBe('E');
    expect(buildStatHighlights({ sportKey: 'golf', golfRound: round({ gross_score: 75 }) })!.hero.value).toBe('+3');
  });

  it('adds GIR / fairways / putts in the priority golf already uses elsewhere', () => {
    const h = buildStatHighlights({
      sportKey: 'golf',
      golfRound: round({ gir_percentage: 61.1, fir_percentage: 78.4, total_putts: 28 }),
    })!;
    // Score first, then the highest-priority two that fit in three slots.
    expect(h.support.map(t => t.label)).toEqual(['Score', 'GIR', 'Fairways']);
    expect(h.support[1].value).toBe('61%');
  });

  it('still renders when hole detail is missing, falling back to the raw score', () => {
    const h = buildStatHighlights({ sportKey: 'golf', golfRound: round({ golf_holes: null }) })!;
    expect(h.heroToPar).toBeNull();
    expect(h.hero.value).toBe('69');
  });

  it('returns null for a golf post with no round at all', () => {
    expect(buildStatHighlights({ sportKey: 'golf' })).toBeNull();
  });
});
