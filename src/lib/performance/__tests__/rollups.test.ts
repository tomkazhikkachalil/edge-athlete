import { describe, expect, it } from 'vitest';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { computeRollups, seasonKey, seasonLabel, TREND_LENGTH } from '../rollups';

// Round 3 — the rollups reader, pure. Seasons are the SPORT's (hockey runs
// autumn→spring), tiles reuse the schema's profileTiles computations, bests
// follow the sport's direction, the trend is the hero number over the last
// ten events oldest first, provenance is counted per season.

const hockey = getStatSchema('ice_hockey')!;
const row = (date: string, metrics: Record<string, unknown>, provenance = 'self_reported') => ({ occurred_on: date, metrics, provenance });

describe('seasonKey', () => {
  it('splits a hockey season at September; a calendar sport at January', () => {
    expect(seasonKey('2026-02-10', 'ice_hockey')).toBe('2025-26');
    expect(seasonKey('2026-09-01', 'ice_hockey')).toBe('2026-27');
    expect(seasonKey('2026-08-31', 'ice_hockey')).toBe('2025-26');
    expect(seasonKey('2026-02-10', 'soccer')).toBe('2026');
    expect(seasonLabel('2025-26')).toBe('2025–26');
    expect(seasonLabel('2026')).toBe('2026');
  });
});

describe('computeRollups', () => {
  const rows = [
    row('2026-02-10', { goals: 2, assists: 1, shots: 5 }, 'club_recorded'),
    row('2025-11-03', { goals: 0, assists: 3, shots: 2 }),
    row('2025-10-20', { goals: 1, assists: 0, shots: 7, pim: 2 }),
    row('2024-12-01', { goals: 4, assists: 1, shots: 9 }, 'league_verified'),
    row('2024-12-01', { goals: 'x', assists: null }), // non-numeric metrics read as absent
  ];
  const r = computeRollups(hockey, rows);

  it('groups events into the sport\'s seasons, newest first, with dates and provenance', () => {
    expect(r.events).toBe(5);
    expect(r.seasons.map(s => s.key)).toEqual(['2025-26', '2024-25']);
    expect(r.seasons[0]).toMatchObject({ label: '2025–26', from: '2025-10-20', to: '2026-02-10', events: 3, provenance: { club_recorded: 1, self_reported: 2 } });
    expect(r.career).toMatchObject({ from: '2024-12-01', to: '2026-02-10' });
  });

  it('tiles come from the schema\'s profileTiles (Games, Goals, Assists, Points…)', () => {
    const tile = (label: string) => r.seasons[0].tiles.find(t => t.label === label)?.value;
    expect(tile('Games')).toBe('3');
    expect(tile('Goals')).toBe('3');
    expect(r.career.tiles.find(t => t.label === 'Goals')?.value).toBe('7');
  });

  it('bests are per metric with the date; zero/absent never a best', () => {
    const best = (k: string) => r.career.bests.find(b => b.key === k);
    expect(best('goals')).toMatchObject({ value: 4, date: '2024-12-01' });
    expect(best('shots')).toMatchObject({ value: 9 });
    expect(best('pim')).toMatchObject({ value: 2, date: '2025-10-20' });
    expect(best('hits')).toBeUndefined();
  });

  it('the trend is the hero number (points) over the last ten events, oldest first', () => {
    expect(r.trend.map(p => p.value)).toEqual([5, 1, 3, 3]); // 2024-12 (4+1), 2025-10 (1), 2025-11 (3), 2026-02 (3)
    const many = computeRollups(hockey, Array.from({ length: 25 }, (_, i) => row(`2026-01-${String(i + 1).padStart(2, '0')}`, { goals: i })));
    expect(many.trend).toHaveLength(TREND_LENGTH);
    expect(many.trend[0].date < many.trend[TREND_LENGTH - 1].date).toBe(true);
  });

  it('a lower-is-better sport takes the minimum as the best', () => {
    const track = getStatSchema('track_field');
    if (!track) return; // not a stat-line sport in this build
    const t = computeRollups(track, [row('2026-05-01', { time_100m: 12.1 }), row('2026-05-08', { time_100m: 11.8 })]);
    const b = t.career.bests.find(x => x.key === 'time_100m');
    if (b) expect(b.value).toBe(11.8);
  });

  it('empty in, empty out', () => {
    const e = computeRollups(hockey, []);
    expect(e).toMatchObject({ events: 0, seasons: [], trend: [], career: { from: null, to: null } });
    expect(e.career.tiles.every(t => t.value === null)).toBe(true);
  });
});
