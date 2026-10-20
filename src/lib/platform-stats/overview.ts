/**
 * The Overview's model (flow changes item 2b, H2) — pure, ZERO imports. The
 * API hands it the small tables (platform_stats_daily rows for the range,
 * the health samples, the jobs, the estimates, today's partial run) and it
 * returns what the page draws: zero-filled series (null BEFORE the first
 * rollup day, so a sparkline never shows a false cliff), period deltas,
 * actives and retention, health percentiles with uptime where a MISSING
 * five-minute slot counts as DOWN (the sampler cannot write "down" while
 * the app is down), the jobs table. Every rule is pinned in
 * src/lib/__tests__/platform-stats.test.ts.
 */

export interface StatRow {
  day: string;
  metric: string;
  dim: string;
  value: number;
}

export interface HealthSample {
  at: string;
  db_ms: number;
  ok: boolean;
}

export interface JobRow {
  job: string;
  last_started_at: string;
  last_finished_at: string | null;
  ok: boolean | null;
  duration_ms: number | null;
}

export interface EstimateRow {
  relname: string;
  reltuples: number;
  last_analyze: string | null;
}

export const SAMPLE_EVERY_MS = 5 * 60 * 1000;
/** No sample in this long = the sampler is not running here (staging). */
export const SAMPLER_ABSENT_AFTER_MS = 30 * 60 * 1000;

// ── Days ────────────────────────────────────────────────────────────────────
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}
export function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The days of the range, oldest first, ending on `to` (inclusive). */
export function dayList(to: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(shiftDay(to, -i));
  return out;
}

// ── Series ──────────────────────────────────────────────────────────────────
export type Series = (number | null)[];

/**
 * One series per (metric, dim) over `days`: 0 where the day has no row
 * but a rollup exists for that day (any metric), null where no rollup ever
 * ran for the day. `firstDay` = the earliest day with any row at all.
 */
export function seriesFor(rows: readonly StatRow[], days: readonly string[], metric: string, dim = ''): Series {
  const rolled = new Set(rows.map(r => r.day));
  const map = new Map<string, number>();
  for (const r of rows) if (r.metric === metric && r.dim === dim) map.set(r.day, r.value);
  return days.map(d => (map.has(d) ? map.get(d)! : rolled.has(d) ? 0 : null));
}

/** Every dim a metric has in the rows, sorted by total descending. */
export function dimsOf(rows: readonly StatRow[], metric: string): string[] {
  const totals = new Map<string, number>();
  for (const r of rows) if (r.metric === metric && r.dim !== '') totals.set(r.dim, (totals.get(r.dim) ?? 0) + r.value);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
}

export function sum(series: Series): number {
  return series.reduce<number>((s, v) => s + (v ?? 0), 0);
}
export function last(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i] !== null) return series[i];
  return null;
}

/** The change from the previous window to this one, as a signed fraction; null when the previous window is empty or unknown. */
export function periodDelta(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

/** The two windows the deltas compare: this range and the one before it. */
export function windows(rows: readonly StatRow[], to: string, count: number, metric: string, dim = ''): { current: number; previous: number | null } {
  const cur = seriesFor(rows, dayList(to, count), metric, dim);
  const prevDays = dayList(shiftDay(to, -count), count);
  const prev = seriesFor(rows, prevDays, metric, dim);
  const prevKnown = prev.some(v => v !== null);
  return { current: sum(cur), previous: prevKnown ? sum(prev) : null };
}

// ── Numbers for people ──────────────────────────────────────────────────────
export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trimZero((n / 1e9).toFixed(1))}B`;
  if (abs >= 1e6) return `${trimZero((n / 1e6).toFixed(1))}M`;
  if (abs >= 10_000) return `${trimZero((n / 1e3).toFixed(1))}K`;
  return Math.round(n).toLocaleString('en-CA');
}
function trimZero(s: string): string {
  return s.replace(/\.0$/, '');
}
export function pct(fraction: number | null | undefined, digits = 0): string {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) return '—';
  return `${(fraction * 100).toFixed(digits)}%`;
}
export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${u === 0 ? v : trimZero(v.toFixed(1))} ${units[u]}`;
}

// ── Health ──────────────────────────────────────────────────────────────────
export interface HealthWindow {
  /** The samples that said ok, their latency percentiles. */
  p50: number | null;
  p95: number | null;
  /** ok samples ÷ EXPECTED slots — a missing slot is down. */
  uptime: number | null;
  samples: number;
  expected: number;
}

export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

export function healthWindow(samples: readonly HealthSample[], nowMs: number, windowMs: number): HealthWindow {
  const from = nowMs - windowMs;
  const inWin = samples.filter(s => { const t = Date.parse(s.at); return t > from && t <= nowMs; });
  const ok = inWin.filter(s => s.ok).map(s => s.db_ms).sort((a, b) => a - b);
  const expected = Math.max(1, Math.floor(windowMs / SAMPLE_EVERY_MS));
  return {
    p50: percentile(ok, 50),
    p95: percentile(ok, 95),
    uptime: inWin.length === 0 ? null : Math.min(1, ok.length / expected),
    samples: inWin.length,
    expected,
  };
}

export type SamplerState = 'ok' | 'absent';

export function samplerState(samples: readonly HealthSample[], nowMs: number): SamplerState {
  const latest = samples.reduce<number>((m, s) => Math.max(m, Date.parse(s.at)), 0);
  return latest > 0 && nowMs - latest <= SAMPLER_ABSENT_AFTER_MS ? 'ok' : 'absent';
}

// ── Retention ───────────────────────────────────────────────────────────────
export interface CohortPoint {
  cohort: string;
  size: number;
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

/** The cohorts the rows know, newest first; a Dn is null until its day has been rolled up. */
export function cohorts(rows: readonly StatRow[]): CohortPoint[] {
  const by = new Map<string, CohortPoint>();
  for (const r of rows) {
    if (!r.metric.startsWith('cohort.') || !r.dim.startsWith('cohort:')) continue;
    const cohort = r.dim.slice('cohort:'.length);
    const p = by.get(cohort) ?? { cohort, size: 0, d1: null, d7: null, d30: null };
    if (r.metric === 'cohort.size') p.size = Math.max(p.size, r.value);
    else if (r.metric === 'cohort.d1') p.d1 = r.value;
    else if (r.metric === 'cohort.d7') p.d7 = r.value;
    else if (r.metric === 'cohort.d30') p.d30 = r.value;
    by.set(cohort, p);
  }
  return [...by.values()].sort((a, b) => b.cohort.localeCompare(a.cohort));
}

/** Pooled Dn over the cohorts that have the number: retained ÷ size, null when none. */
export function pooledRetention(points: readonly CohortPoint[], n: 'd1' | 'd7' | 'd30'): { rate: number | null; cohorts: number } {
  let size = 0;
  let kept = 0;
  let count = 0;
  for (const p of points) {
    if (p[n] === null || p.size === 0) continue;
    size += p.size;
    kept += p[n]!;
    count++;
  }
  return { rate: size > 0 ? kept / size : null, cohorts: count };
}

// ── Jobs ────────────────────────────────────────────────────────────────────
export interface JobView {
  job: string;
  ok: boolean | null;
  ranAgoMs: number | null;
  durationMs: number | null;
  running: boolean;
}

export function jobViews(jobs: readonly JobRow[], nowMs: number): JobView[] {
  return [...jobs]
    .map(j => ({
      job: j.job,
      ok: j.ok,
      ranAgoMs: j.last_finished_at ? nowMs - Date.parse(j.last_finished_at) : null,
      durationMs: j.duration_ms,
      running: !j.last_finished_at && nowMs - Date.parse(j.last_started_at) < 10 * 60 * 1000,
    }))
    .sort((a, b) => a.job.localeCompare(b.job));
}

export function ago(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return 'just now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
