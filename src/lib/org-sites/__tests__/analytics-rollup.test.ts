import { describe, expect, it } from 'vitest';
import { rollupStats, sparklinePoints, statsRange, statsWindow } from '../analytics-rollup';

// Program 2, E2 (Sep 11 2026): the console's numbers over the daily rows.

const today = new Date('2026-09-11T15:00:00Z');

describe('rollupStats', () => {
  it('totals, a zero-filled per-day series oldest first, the top pages by views', () => {
    const s = rollupStats(
      [
        { day: '2026-09-11', path: '/', views: 5, visitors: 3 },
        { day: '2026-09-11', path: '/standings', views: 2, visitors: 0 },
        { day: '2026-09-09', path: '/', views: 1, visitors: 1 },
        { day: '2026-09-01', path: '/', views: 99, visitors: 99 }, // outside a 7-day window
      ],
      7,
      today
    );
    expect(s.from).toBe('2026-09-05');
    expect(s.to).toBe('2026-09-11');
    expect(s.totals).toEqual({ views: 8, visitors: 4 });
    expect(s.series).toHaveLength(7);
    expect(s.series[0]).toEqual({ day: '2026-09-05', views: 0, visitors: 0 });
    expect(s.series[4]).toEqual({ day: '2026-09-09', views: 1, visitors: 1 });
    expect(s.series[6]).toEqual({ day: '2026-09-11', views: 7, visitors: 3 });
    expect(s.topPaths).toEqual([
      { path: '/', views: 6, visitors: 4 },
      { path: '/standings', views: 2, visitors: 0 },
    ]);
  });
  it('an empty range is honest; the range parser falls back to 30; the sparkline has one point per day', () => {
    const empty = rollupStats([], 30, today);
    expect(empty.totals).toEqual({ views: 0, visitors: 0 });
    expect(empty.series).toHaveLength(30);
    expect(empty.topPaths).toEqual([]);
    expect(statsRange('7')).toBe(7);
    expect(statsRange('90')).toBe(90);
    expect(statsRange('12')).toBe(30);
    expect(statsRange(null)).toBe(30);
    expect(statsWindow(1, today)).toEqual({ from: '2026-09-11', to: '2026-09-11' });
    expect(sparklinePoints(empty.series, 320, 48).split(' ')).toHaveLength(30);
    expect(sparklinePoints([], 320, 48)).toBe('');
  });
});
