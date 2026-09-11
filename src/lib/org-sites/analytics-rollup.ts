/**
 * The console's numbers — program 2, E2 (Sep 11 2026). Pure over the daily
 * rows (`org_site_stats_daily`): totals for the range, a per-day series
 * (zero-filled — a quiet day is a day), the top pages. Node-tested.
 */

export interface DailyRow {
  day: string; // YYYY-MM-DD
  path: string;
  views: number;
  visitors: number;
}

export interface SiteStats {
  days: number;
  from: string;
  to: string;
  totals: { views: number; visitors: number };
  /** One entry per day in the range, oldest first. */
  series: { day: string; views: number; visitors: number }[];
  /** Pages by views, most first, at most ten. */
  topPaths: { path: string; views: number; visitors: number }[];
}

export const STATS_RANGES = [7, 30, 90] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export function statsRange(raw: unknown): StatsRange {
  const n = Number(raw);
  return (STATS_RANGES as readonly number[]).includes(n) ? (n as StatsRange) : 30;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** The inclusive day window ending today (UTC). */
export function statsWindow(days: number, today: Date): { from: string; to: string } {
  const to = dayKey(today);
  const from = dayKey(new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
  return { from, to };
}

export function rollupStats(rows: readonly DailyRow[], days: number, today: Date): SiteStats {
  const { from, to } = statsWindow(days, today);
  const inRange = rows.filter(r => r.day >= from && r.day <= to);
  const byDay = new Map<string, { views: number; visitors: number }>();
  const byPath = new Map<string, { views: number; visitors: number }>();
  let views = 0;
  let visitors = 0;
  for (const r of inRange) {
    views += r.views;
    visitors += r.visitors;
    const d = byDay.get(r.day) ?? { views: 0, visitors: 0 };
    d.views += r.views;
    d.visitors += r.visitors;
    byDay.set(r.day, d);
    const p = byPath.get(r.path) ?? { views: 0, visitors: 0 };
    p.views += r.views;
    p.visitors += r.visitors;
    byPath.set(r.path, p);
  }
  const series: SiteStats['series'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKey(new Date(today.getTime() - i * 24 * 60 * 60 * 1000));
    const d = byDay.get(day) ?? { views: 0, visitors: 0 };
    series.push({ day, views: d.views, visitors: d.visitors });
  }
  const topPaths = [...byPath.entries()]
    .map(([path, v]) => ({ path, ...v }))
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))
    .slice(0, 10);
  return { days, from, to, totals: { views, visitors }, series, topPaths };
}

/** A sparkline path for an SVG of the given size — the series' views. */
export function sparklinePoints(series: readonly { views: number }[], width: number, height: number): string {
  if (series.length === 0) return '';
  const max = Math.max(1, ...series.map(s => s.views));
  const step = series.length > 1 ? width / (series.length - 1) : 0;
  return series.map((s, i) => `${(i * step).toFixed(1)},${(height - (s.views / max) * (height - 2) - 1).toFixed(1)}`).join(' ');
}
