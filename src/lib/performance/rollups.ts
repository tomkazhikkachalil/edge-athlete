/**
 * Career and season rollups — the second reader of `athlete_performances`
 * and the first the ATHLETE sees (Round 3, Sep 2026; the data foundation's
 * "readers" the vision needs). Pure: rows in, rollups out. The server reads
 * the rows (`rollups-server.ts`); the Stats tab renders the result.
 *
 * One row of the fact table is one event (a game, a race) with NUMERIC
 * metrics in the sport's stat-schema vocabulary, so every tile the schema
 * already defines for the profile (`profileTiles`: count / sum / avg / min —
 * "you can't sum a per-game average") computes the same way over a season
 * or a career. A SEASON is the sport's, not the calendar's: hockey and
 * basketball run autumn to spring, so a game in February 2026 belongs to
 * "2025–26"; the rest of the sports use the calendar year. Bests are per
 * metric, the direction from the sport (a race time is best LOW). The
 * trend is the hero number over the last ten events, oldest first, for a
 * sparkline. Disputed rows never arrive here (the server excludes them);
 * provenance is counted per season so the UI can say how much is verified.
 */
import { computeProfileTile, type SportStatSchema, type StatLineData } from '@/lib/sports/stat-schemas';
import { headlineDirection } from './types';

export interface RollupRow {
  occurred_on: string;                 // YYYY-MM-DD
  metrics: Record<string, unknown>;    // numeric-only by the writer's rule; read defensively
  provenance: string;
}

export interface RollupTile { label: string; value: string | null }
export interface RollupBest { key: string; label: string; value: number; date: string }
export interface SeasonRollup {
  key: string;            // "2025-26" | "2026"
  label: string;          // "2025–26" | "2026"
  from: string;           // first event date in the season
  to: string;             // last
  events: number;
  tiles: RollupTile[];
  bests: RollupBest[];
  provenance: Record<string, number>;
}
export interface Rollups {
  sport_key: string;
  events: number;
  career: { from: string | null; to: string | null; tiles: RollupTile[]; bests: RollupBest[] };
  seasons: SeasonRollup[];   // newest first
  trend: Array<{ date: string; value: number }>; // oldest first, ≤ TREND_LENGTH
  truncated: boolean;
}

export const TREND_LENGTH = 10;
export const ROLLUP_ROW_CAP = 2000;

/** The month a sport's season starts (1–12); absent = the calendar year. */
export const SEASON_START_MONTH: Readonly<Record<string, number>> = {
  ice_hockey: 9,
  basketball: 10,
  volleyball: 8,
};

/** "2025-26" for a February 2026 hockey game; "2026" for a July 2026 soccer match. */
export function seasonKey(occurredOn: string, sportKey: string): string {
  const year = Number(occurredOn.slice(0, 4));
  const month = Number(occurredOn.slice(5, 7));
  const start = SEASON_START_MONTH[sportKey];
  if (!start || !Number.isFinite(year) || !Number.isFinite(month)) return String(year);
  const startYear = month >= start ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function seasonLabel(key: string): string {
  return key.replace('-', '–');
}

const numericMetrics = (m: Record<string, unknown>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m ?? {})) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  return out;
};

const asLine = (schema: SportStatSchema, stats: Record<string, number>): StatLineData => ({ type: 'stat_line', sport_key: schema.sport_key, stats });

function tiles(schema: SportStatSchema, lines: StatLineData[]): RollupTile[] {
  return schema.profileTiles.map(t => ({ label: t.label, value: lines.length ? computeProfileTile(t, lines) : null }));
}

function bests(schema: SportStatSchema, rows: Array<{ date: string; stats: Record<string, number> }>): RollupBest[] {
  const lower = headlineDirection(schema.sport_key) === 'lower';
  const out: RollupBest[] = [];
  for (const f of schema.fields) {
    let best: { value: number; date: string } | null = null;
    for (const r of rows) {
      const v = r.stats[f.key];
      if (typeof v !== 'number' || !(v > 0)) continue; // zero / absent = not recorded
      if (best === null || (lower ? v < best.value : v > best.value)) best = { value: v, date: r.date };
    }
    if (best) out.push({ key: f.key, label: f.label, value: best.value, date: best.date });
  }
  return out;
}

export function computeRollups(schema: SportStatSchema, rows: RollupRow[], opts: { truncated?: boolean } = {}): Rollups {
  const clean = rows
    .map(r => ({ date: r.occurred_on.slice(0, 10), stats: numericMetrics(r.metrics), provenance: r.provenance }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first

  const bySeason = new Map<string, typeof clean>();
  for (const r of clean) {
    const key = seasonKey(r.date, schema.sport_key);
    if (!bySeason.has(key)) bySeason.set(key, []);
    bySeason.get(key)!.push(r);
  }
  const seasons: SeasonRollup[] = [...bySeason.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, list]) => {
      const provenance: Record<string, number> = {};
      for (const r of list) provenance[r.provenance] = (provenance[r.provenance] ?? 0) + 1;
      return {
        key,
        label: seasonLabel(key),
        from: list[list.length - 1].date,
        to: list[0].date,
        events: list.length,
        tiles: tiles(schema, list.map(r => asLine(schema, r.stats))),
        bests: bests(schema, list),
        provenance,
      };
    });

  const trend = clean
    .slice(0, TREND_LENGTH)
    .reverse()
    .map(r => ({ date: r.date, value: schema.heroStat.compute(r.stats) }))
    .filter((p): p is { date: string; value: number } => typeof p.value === 'number' && Number.isFinite(p.value));

  return {
    sport_key: schema.sport_key,
    events: clean.length,
    career: {
      from: clean.length ? clean[clean.length - 1].date : null,
      to: clean.length ? clean[0].date : null,
      tiles: tiles(schema, clean.map(r => asLine(schema, r.stats))),
      bests: bests(schema, clean),
    },
    seasons,
    trend,
    truncated: !!opts.truncated,
  };
}
