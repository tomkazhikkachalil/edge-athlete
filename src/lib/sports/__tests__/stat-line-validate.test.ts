import { describe, expect, it } from 'vitest';
import { getStatSchema } from '../stat-schemas';
import { validateStatLine, validateStatsAgainstSchema } from '../stat-line-validate';

// Data foundation F2 — the server-side stat-line validator. Tom's decision:
// reject (a 400 naming the field), never clamp or strip.

const TODAY = '2026-09-13';
const hockey = getStatSchema('ice_hockey')!;
const goals = hockey.fields[0];

describe('validateStatsAgainstSchema (the org path\'s check, one copy)', () => {
  it('accepts known keys within range; names an unknown key, a non-number and a range miss', () => {
    expect(validateStatsAgainstSchema({ [goals.key]: 2 }, hockey)).toEqual({ ok: true });
    expect(validateStatsAgainstSchema({ bogus: 1 }, hockey)).toEqual({ ok: false, error: 'Unknown stat "bogus" for this sport' });
    expect(validateStatsAgainstSchema({ [goals.key]: 'two' }, hockey)).toEqual({ ok: false, error: `${goals.label} must be a number` });
    expect(validateStatsAgainstSchema({ [goals.key]: Number.NaN }, hockey).ok).toBe(false);
    if (goals.max !== undefined) expect(validateStatsAgainstSchema({ [goals.key]: goals.max + 1 }, hockey)).toEqual({ ok: false, error: `${goals.label} is out of range` });
    if (goals.min !== undefined) expect(validateStatsAgainstSchema({ [goals.key]: goals.min - 1 }, hockey)).toEqual({ ok: false, error: `${goals.label} is out of range` });
  });
});

describe('validateStatLine', () => {
  const line = (over: Record<string, unknown> = {}) => ({ type: 'stat_line', sport_key: 'ice_hockey', date: '2026-09-10', opponent: 'Wolves', result: 'W', result_score: '4-2', stats: { [goals.key]: 2 }, ...over });

  it('a valid line passes through unchanged', () => {
    const v = validateStatLine(line(), 'ice_hockey', TODAY);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value).toEqual(line());
  });
  it('anything that is not a stat line passes untouched (a vitals entry, a plain blob, null)', () => {
    expect(validateStatLine({ type: 'vitals_entry', weight: 80 }, 'general', TODAY).ok).toBe(true);
    expect(validateStatLine({ score: 42 }, 'golf', TODAY).ok).toBe(true);
    expect(validateStatLine(null, 'golf', TODAY).ok).toBe(true);
  });
  it('rejects a malformed stat line, a sport mismatch, a sport with no schema, an empty stats object', () => {
    expect(validateStatLine({ type: 'stat_line' }, 'ice_hockey', TODAY)).toEqual({ ok: false, error: 'A stat line needs a sport and its stats' });
    expect(validateStatLine(line({ sport_key: 'soccer' }), 'ice_hockey', TODAY).ok).toBe(false);
    expect(validateStatLine(line({ sport_key: 'golf' }), 'golf', TODAY)).toEqual({ ok: false, error: 'Player stats aren’t available for this sport' });
    expect(validateStatLine(line({ stats: {} }), 'ice_hockey', TODAY)).toEqual({ ok: false, error: 'A stat line needs at least one stat' });
  });
  it('rejects a bad date, a future date and a stranger result; the date is optional', () => {
    expect(validateStatLine(line({ date: '10/09/2026' }), 'ice_hockey', TODAY)).toEqual({ ok: false, error: 'The date must be YYYY-MM-DD' });
    expect(validateStatLine(line({ date: '2026-09-14' }), 'ice_hockey', TODAY)).toEqual({ ok: false, error: 'The date cannot be in the future' });
    expect(validateStatLine(line({ date: TODAY }), 'ice_hockey', TODAY).ok).toBe(true);
    expect(validateStatLine(line({ date: undefined }), 'ice_hockey', TODAY).ok).toBe(true);
    expect(validateStatLine(line({ result: 'X' }), 'ice_hockey', TODAY)).toEqual({ ok: false, error: 'The result must be W, L or T' });
  });
  it('rejects an unknown stat and an out-of-range value with the org path\'s words — never clamps, never strips', () => {
    expect(validateStatLine(line({ stats: { [goals.key]: 1, bogus: 3 } }), 'ice_hockey', TODAY)).toEqual({ ok: false, error: 'Unknown stat "bogus" for this sport' });
    if (goals.max !== undefined) expect(validateStatLine(line({ stats: { [goals.key]: goals.max + 5 } }), 'ice_hockey', TODAY)).toEqual({ ok: false, error: `${goals.label} is out of range` });
  });
});
