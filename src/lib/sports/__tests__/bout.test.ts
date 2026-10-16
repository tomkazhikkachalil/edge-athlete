import { describe, expect, it } from 'vitest';
import { BOUT_METHODS_BY_SPORT, boutHeadline, COMBAT_SPORT_KEYS, envelopeResult, formatRecord, recordFrom, validateBout, type Bout } from '../bout';
import { validateStatLine } from '../stat-line-validate';

describe('validateBout', () => {
  it('takes an MMA win by TKO in round 2 at 1:47, pro, 155 lb', () => {
    const r = validateBout('mma', { result: 'W', method: 'tko', round: 2, time_s: 107, context: { level: 'pro', weight_class: '155 lb', format: { rounds: 3, minutes: 5 } } });
    expect(r).toEqual({ ok: true, value: { result: 'W', method: 'tko', round: 2, time_s: 107, context: { level: 'pro', weight_class: '155 lb', format: { rounds: 3, minutes: 5 } } } });
    expect(boutHeadline('mma', (r as { value: Bout }).value)).toBe('W · TKO · R2 1:47 · Pro · 155 lb');
  });

  it('holds each sport to its own methods and context', () => {
    expect(validateBout('bjj', { result: 'W', method: 'submission', context: { gi: 'nogi', belt: 'purple' } })).toMatchObject({ ok: true });
    expect(validateBout('bjj', { result: 'W', method: 'pin' })).toMatchObject({ ok: false });
    expect(validateBout('wrestling', { result: 'W', method: 'pin', round: 2, time_s: 45, context: { style: 'greco' } })).toMatchObject({ ok: true });
    expect(validateBout('wrestling', { result: 'W', context: { gi: 'gi' } })).toMatchObject({ ok: false });
    expect(validateBout('boxing', { result: 'L', method: 'decision_unanimous', context: { level: 'pro', format: { rounds: 10, minutes: 3 } } })).toMatchObject({ ok: true });
    expect(validateBout('soccer', { result: 'W' })).toMatchObject({ ok: false });
    for (const s of COMBAT_SPORT_KEYS) expect(BOUT_METHODS_BY_SPORT[s].length).toBeGreaterThan(3);
  });

  it('refuses a round on a decision, a round past the schedule, a time without a round or past the round', () => {
    expect(validateBout('boxing', { result: 'W', method: 'decision_split', round: 10 })).toMatchObject({ ok: false });
    expect(validateBout('boxing', { result: 'W', method: 'ko', round: 7, context: { format: { rounds: 6, minutes: 3 } } })).toMatchObject({ ok: false });
    expect(validateBout('mma', { result: 'W', method: 'ko', time_s: 30 })).toMatchObject({ ok: false });
    expect(validateBout('mma', { result: 'W', method: 'ko', round: 1, time_s: 301, context: { format: { rounds: 3, minutes: 5 } } })).toMatchObject({ ok: false });
    expect(validateBout('mma', { result: 'X' })).toMatchObject({ ok: false });
    expect(validateBout('mma', { result: 'W', judges: 3 })).toMatchObject({ ok: false });
  });
});

describe('the envelope and the record', () => {
  it('a draw is T, a no contest has no result — never a win', () => {
    expect(envelopeResult('W')).toBe('W');
    expect(envelopeResult('D')).toBe('T');
    expect(envelopeResult('NC')).toBeUndefined();
  });

  it('reads 3-1-1 (1 NC) with two finishes', () => {
    const bouts: Bout[] = [
      { result: 'W', method: 'tko' },
      { result: 'W', method: 'submission' },
      { result: 'W', method: 'decision_unanimous' },
      { result: 'L', method: 'decision_split' },
      { result: 'D' },
      { result: 'NC' },
    ];
    const r = recordFrom('mma', bouts);
    expect(r).toEqual({ w: 3, l: 1, d: 1, nc: 1, finishes: 2 });
    expect(formatRecord(r)).toBe('3-1-1 (1 NC)');
    expect(formatRecord(recordFrom('mma', bouts.slice(0, 2)))).toBe('2-0-0');
  });
});

describe('a bout on the stat line (validator + performance row)', () => {
  // The four sports join the registry in C2; any registered stat-line sport proves the envelope rule here.
  it('refuses a bout on a sport that is not a combat sport', () => {
    expect(validateStatLine({ type: 'stat_line', sport_key: 'running', stats: { distance_km: 5 }, bout: { result: 'W' } }, 'running', '2026-12-31')).toMatchObject({ ok: false, error: 'Bout results are for combat sports' });
  });

});

describe('a bout on a combat sport’s stat line (C2)', () => {
  const line = (sport: string, bout: unknown, extra: Record<string, unknown> = {}) => ({ type: 'stat_line', sport_key: sport, date: '2026-10-10', opponent: 'J. Rivera', stats: {}, bout, ...extra });

  it('a bout alone is a complete line; the envelope result is derived', () => {
    const r = validateStatLine(line('mma', { result: 'W', method: 'tko', round: 2, time_s: 107 }), 'mma', '2026-12-31');
    expect(r).toMatchObject({ ok: true, value: { result: 'W', bout: { result: 'W', method: 'tko', round: 2, time_s: 107 } } });
    const draw = validateStatLine(line('boxing', { result: 'D', method: 'decision_majority' }), 'boxing', '2026-12-31');
    expect(draw).toMatchObject({ ok: true, value: { result: 'T' } });
    const nc = validateStatLine(line('bjj', { result: 'NC' }), 'bjj', '2026-12-31');
    expect(nc.ok && 'result' in nc.value).toBe(false);
    expect(validateStatLine(line('mma', { result: 'L' }, { result: 'W' }), 'mma', '2026-12-31')).toMatchObject({ ok: false, error: 'The result disagrees with the bout' });
    expect(validateStatLine({ type: 'stat_line', sport_key: 'mma', stats: {} }, 'mma', '2026-12-31')).toMatchObject({ ok: false });
  });

  it('the performance row keeps the bout in its context; a no contest is never a win', async () => {
    const { fromStatLinePost } = await import('@/lib/performance/map');
    const post = (bout: unknown) =>
      fromStatLinePost({ id: '7d4f9e2a-1b3c-4d5e-8f6a-9b0c1d2e3f99', profile_id: 'p', sport_key: 'mma', created_at: '2026-10-16T00:00:00Z', status: 'published', stats_data: line('mma', bout) } as never);
    const win = post({ result: 'W', method: 'submission', round: 1, time_s: 200 })!;
    expect(win.context).toMatchObject({ result: 'W', bout: { method: 'submission' } });
    expect(win.outcome ?? null).toBeNull(); // free-text opponent: no shared game (244)
    const nc = post({ result: 'NC' })!;
    expect(nc.context).toEqual({ opponent: 'J. Rivera', bout: { result: 'NC' } });
  });

  it('first win and first finish badges read the bout; a decision win is not a finish; a no contest is neither', async () => {
    const { evaluateBadges } = await import('@/lib/play/badges/evaluate');
    const row = (key: string, bout: Bout) => ({ natural_key: key, sport_key: 'bjj', occurred_on: '2026-10-10', metrics: {}, outcome: null, context: { bout, ...(envelopeResult(bout.result) ? { result: envelopeResult(bout.result) } : {}) } });
    const award = (rows: ReturnType<typeof row>[]) =>
      evaluateBadges({ rows, resultCounts: { bjj: rows.length }, sportsPlayed: 1, handicapIndex: null, held: new Set() }).map(a => a.badgeKey);
    expect(award([row('post:a', { result: 'W', method: 'points' })])).toEqual(expect.arrayContaining(['bjj.first_win']));
    expect(award([row('post:a', { result: 'W', method: 'points' })])).not.toContain('bjj.first_finish');
    expect(award([row('post:b', { result: 'W', method: 'submission' })])).toEqual(expect.arrayContaining(['bjj.first_win', 'bjj.first_finish']));
    const nc = award([row('post:c', { result: 'NC' })]);
    expect(nc).not.toContain('bjj.first_win');
    expect(nc).not.toContain('bjj.first_finish');
  });

  it('the profile tiles read the record and the finishes from the bouts', async () => {
    const { STAT_SCHEMAS, computeProfileTile } = await import('../stat-schemas');
    const schema = STAT_SCHEMAS.mma!;
    const lines = [
      { result: 'W', method: 'tko' },
      { result: 'W', method: 'submission' },
      { result: 'W', method: 'decision_unanimous' },
      { result: 'L', method: 'decision_split' },
      { result: 'D' },
      { result: 'NC' },
    ].map(b => ({ type: 'stat_line' as const, sport_key: 'mma' as const, stats: {}, bout: b as Bout }));
    expect(schema.profileTiles.map(t => [t.label, computeProfileTile(t, lines)])).toEqual([
      ['Record', '3-1-1 (1 NC)'],
      ['Bouts', '6'],
      ['Finishes', '2'],
      ['Takedowns', '0'],
    ]);
  });
});
