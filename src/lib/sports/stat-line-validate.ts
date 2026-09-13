import { getStatSchema, isStatLineData, type SportStatSchema, type StatLineData } from './stat-schemas';

/**
 * Server-side validation of a stat line — data foundation, F2 (Sep 13 2026).
 *
 * A post's `stats_data` used to be validated in the composer only; the
 * server stored whatever arrived. Tom's decision: the dataset never stores
 * a number the sport's schema does not define — an invalid payload is
 * REJECTED with a 400 that names the field (the org stat-line path's exact
 * words), never clamped (a clamped value is a silently changed number) and
 * never stripped (a dropped stat is a silently lost one). The composer
 * already validates, so the 400 only ever meets a stale or hostile client.
 *
 * Pure; the posts route and the org stat-lines path share it. Anything that
 * is not a stat line (a vitals entry, a plain `{score: 42}` blob) passes
 * untouched — this validator has an opinion only about `type: 'stat_line'`.
 */

export type StatLineValidation = { ok: true; value: StatLineData } | { ok: false; error: string };

export const STAT_LINE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The key / range check the org path has always done — ONE copy now. */
export function validateStatsAgainstSchema(stats: Record<string, unknown>, schema: SportStatSchema): { ok: true } | { ok: false; error: string } {
  const known = new Map(schema.fields.map(f => [f.key, f]));
  for (const [key, value] of Object.entries(stats)) {
    const field = known.get(key);
    if (!field) return { ok: false, error: `Unknown stat "${key}" for this sport` };
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: `${field.label} must be a number` };
    if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) return { ok: false, error: `${field.label} is out of range` };
  }
  return { ok: true };
}

/**
 * Validate a post's `stats_data` for `sportKey` (the post's type). Returns
 * the payload untouched when it is not a stat line. `today` is injectable
 * for the "not in the future" rule (a date-only compare, YYYY-MM-DD).
 */
export function validateStatLine(data: unknown, sportKey: string, today: string = new Date().toISOString().slice(0, 10)): StatLineValidation {
  if (!data || typeof data !== 'object') return { ok: true, value: data as StatLineData };
  const d = data as Record<string, unknown>;
  if (d.type !== 'stat_line') return { ok: true, value: data as StatLineData };
  if (!isStatLineData(data)) return { ok: false, error: 'A stat line needs a sport and its stats' };
  if (data.sport_key !== sportKey) return { ok: false, error: `The stat line is for ${data.sport_key}, not ${sportKey}` };
  const schema = getStatSchema(sportKey);
  if (!schema) return { ok: false, error: 'Player stats aren’t available for this sport' };
  if (data.date !== undefined) {
    if (typeof data.date !== 'string' || !STAT_LINE_DATE_RE.test(data.date)) return { ok: false, error: 'The date must be YYYY-MM-DD' };
    if (data.date > today) return { ok: false, error: 'The date cannot be in the future' };
  }
  if (data.result !== undefined && !['W', 'L', 'T'].includes(data.result)) return { ok: false, error: 'The result must be W, L or T' };
  const keys = Object.keys(data.stats);
  if (keys.length === 0) return { ok: false, error: 'A stat line needs at least one stat' };
  const stats = validateStatsAgainstSchema(data.stats as Record<string, unknown>, schema);
  if (!stats.ok) return stats;
  return { ok: true, value: data };
}
