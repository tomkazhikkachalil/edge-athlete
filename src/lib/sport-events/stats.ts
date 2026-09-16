/**
 * Live per-player stats for a team event (Events program, phase 4 —
 * migration 215 `sport_event_stat_lines`) — pure. The vocabulary is the
 * sport's `STAT_SCHEMAS[sport].fields[].key` through the ONE validator
 * (`validateStatsAgainstSchema`): a miss is refused by name, never clamped,
 * never stripped (the data-foundation rule). A line is ONE object per
 * player per round, written whole under an app-level compare-and-set
 * (`version`); increments merge client-side (`applyIncrement`) into the
 * outbox's one desired state per line.
 */
import { getStatSchema, type SportStatSchema } from '@/lib/sports/stat-schemas';
import { validateStatsAgainstSchema } from '@/lib/sports/stat-line-validate';
import { isStatSport } from './types';
import type { Parsed } from './validate';

export type StatValues = Record<string, number>;

/** The sport's schema when the sport is an event stat sport; null for golf and the parked sports. */
export function statSchemaFor(sportKey: string | null | undefined): SportStatSchema | null {
  return isStatSport(sportKey) ? getStatSchema(sportKey) : null;
}

/** A fresh line: nothing entered (the fields read as 0 until touched; a line with no stats mirrors nothing). */
export function emptyStats(): StatValues {
  return {};
}

export interface StatWrite {
  stats: StatValues;
  expected_version: number;
}

/** The PUT body of a line: the WHOLE object (`stats`) + the version the client last saw (0 = a fresh line). */
export function parseStatWrite(body: unknown, schema: SportStatSchema): Parsed<StatWrite> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body must be an object' };
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) if (key !== 'stats' && key !== 'expected_version') return { ok: false, error: `Unknown field: ${key}` };
  if (!b.stats || typeof b.stats !== 'object' || Array.isArray(b.stats)) return { ok: false, error: 'stats must be an object' };
  const v = validateStatsAgainstSchema(b.stats as Record<string, unknown>, schema);
  if (!v.ok) return v;
  const ev = b.expected_version;
  if (typeof ev !== 'number' || !Number.isInteger(ev) || ev < 0) return { ok: false, error: 'expected_version must be a whole number (0 for a new line)' };
  return { ok: true, value: { stats: { ...(b.stats as StatValues) }, expected_version: ev } };
}

/** One tap on the strip: `key` by `delta`; the result must stay inside the field's range — refused by name, never clamped. */
export function applyIncrement(stats: StatValues, key: string, delta: number, schema: SportStatSchema): Parsed<StatValues> {
  const field = schema.fields.find(f => f.key === key);
  if (!field) return { ok: false, error: `Unknown stat "${key}" for this sport` };
  const next = (stats[key] ?? 0) + delta;
  if ((field.min !== undefined && next < field.min) || (field.max !== undefined && next > field.max)) return { ok: false, error: `${field.label} is out of range` };
  return { ok: true, value: { ...stats, [key]: next } };
}

/** "2 G • 1 A" — the sport's own headline; null when nothing is entered. */
export function lineHeadline(stats: StatValues, schema: SportStatSchema): string | null {
  return schema.headline(stats);
}

/** The ONE number a line is ranked by: the sport's hero stat, else its first field. */
export function heroValue(stats: StatValues, schema: SportStatSchema): number {
  const hero = schema.heroStat?.compute(stats);
  if (typeof hero === 'number' && Number.isFinite(hero)) return hero;
  const first = schema.fields[0];
  return first ? stats[first.key] ?? 0 : 0;
}

export interface StatLineLike {
  participant_id: string;
  stats: StatValues;
}

/** A stat summed per side (a game): `sides` maps participant → side; a player on no side counts for neither. */
export function sideTotals(lines: StatLineLike[], sides: ReadonlyMap<string, 1 | 2>, key: string): { 1: number; 2: number } {
  const out = { 1: 0, 2: 0 };
  for (const l of lines) {
    const side = sides.get(l.participant_id);
    if (side) out[side] += l.stats[key] ?? 0;
  }
  return out;
}

/** The top `n` lines by the hero value (ties by the given order), lines with nothing entered excluded. */
export function topLines<T extends StatLineLike>(lines: T[], schema: SportStatSchema, n: number): Array<T & { hero: number; headline: string | null }> {
  return lines
    .map(l => ({ ...l, hero: heroValue(l.stats, schema), headline: lineHeadline(l.stats, schema) }))
    .filter(l => Object.values(l.stats).some(v => typeof v === 'number' && v !== 0))
    .sort((a, b) => b.hero - a.hero)
    .slice(0, Math.max(0, n));
}
