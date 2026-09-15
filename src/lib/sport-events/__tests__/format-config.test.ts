import { describe, expect, it } from 'vitest';
import { applyCut, cutDecided, cutEditable } from '../cut';
import { cutLabel, parseCutRule, parseFormatConfig, readFormatConfig } from '../format-config';

describe('parseFormatConfig — strict, a miss names the field', () => {
  const ctx = { roundCount: 3 };
  it('accepts {} and {cut: null} as no cut; refuses an unknown key by name', () => {
    expect(parseFormatConfig({}, ctx)).toEqual({ ok: true, value: {} });
    expect(parseFormatConfig({ cut: null }, ctx)).toEqual({ ok: true, value: {} });
    expect(parseFormatConfig({ stableford: true }, ctx)).toEqual({ ok: false, error: 'Unknown field: format_config.stableford' });
    expect(parseFormatConfig('x', ctx)).toMatchObject({ ok: false });
  });
  it('the cut: after_round 1..n−1, exactly one of top_n | to_par, each bounded', () => {
    expect(parseFormatConfig({ cut: { after_round: 2, top_n: 20 } }, ctx)).toEqual({ ok: true, value: { cut: { after_round: 2, top_n: 20 } } });
    expect(parseFormatConfig({ cut: { after_round: 1, to_par: 4 } }, ctx)).toEqual({ ok: true, value: { cut: { after_round: 1, to_par: 4 } } });
    expect(parseCutRule({ after_round: 3, top_n: 20 }, ctx)).toMatchObject({ ok: false, error: 'format_config.cut.after_round must be a whole number from 1 to 2' });
    expect(parseCutRule({ after_round: 1, top_n: 20 }, { roundCount: 1 })).toMatchObject({ ok: false, error: expect.stringContaining('at least two rounds') });
    expect(parseCutRule({ after_round: 1 }, ctx)).toMatchObject({ ok: false, error: 'format_config.cut needs exactly one of top_n or to_par' });
    expect(parseCutRule({ after_round: 1, top_n: 20, to_par: 4 }, ctx)).toMatchObject({ ok: false, error: expect.stringContaining('exactly one') });
    expect(parseCutRule({ after_round: 1, top_n: 0 }, ctx)).toMatchObject({ ok: false, error: expect.stringContaining('top_n') });
    expect(parseCutRule({ after_round: 1, top_n: 501 }, ctx)).toMatchObject({ ok: false, error: expect.stringContaining('top_n') });
    expect(parseCutRule({ after_round: 1, to_par: 41 }, ctx)).toMatchObject({ ok: false, error: expect.stringContaining('to_par') });
    expect(parseCutRule({ after_round: 1, to_par: 2.5 }, ctx)).toMatchObject({ ok: false });
    expect(parseCutRule({ after_round: 1, top_n: 5, extra: 1 }, ctx)).toEqual({ ok: false, error: 'Unknown field: format_config.cut.extra' });
  });
  it('readFormatConfig never throws on a hand-written row; cutLabel reads as English', () => {
    expect(readFormatConfig(null, 3)).toEqual({});
    expect(readFormatConfig({ cut: { after_round: 9, top_n: 2 } }, 3)).toEqual({});
    expect(readFormatConfig({ cut: { after_round: 1, top_n: 2 } }, 1)).toEqual({ cut: { after_round: 1, top_n: 2 } }); // a stored cut survives a round being cancelled
    expect(cutLabel({ after_round: 2, top_n: 20 })).toBe('Cut after round 2 · top 20');
    expect(cutLabel({ after_round: 1, to_par: 4 })).toBe('Cut after round 1 · +4 or better');
    expect(cutLabel({ after_round: 1, to_par: 0 })).toBe('Cut after round 1 · even or better');
    expect(cutLabel({ after_round: 1, to_par: -2 })).toBe('Cut after round 1 · −2 or better');
    expect(cutLabel(null)).toBeNull();
  });
});

describe('applyCut', () => {
  const row = (id: string, rank: number | null, keyToPar: number | null, key: number | null) => ({ participantId: id, rank, keyToPar, key });
  it('top N: ties at the nth place all make it; the unranked miss; the line carries the cut score', () => {
    const rows = [row('a', 1, -2, 70), row('b', 2, 0, 72), row('c', 2, 0, 72), row('d', 4, 3, 75), row('e', null, null, null)];
    const { made, line } = applyCut(rows, { after_round: 1, top_n: 2 });
    expect([...made]).toEqual(['a', 'b', 'c']);
    expect(line).toEqual({ afterRound: 1, score: 72, madeCut: 3, missed: 2 });
    expect([...applyCut(rows, { after_round: 1, top_n: 1 }).made]).toEqual(['a']);
    expect(applyCut(rows, { after_round: 1, top_n: 500 }).line.missed).toBe(1); // only the unranked
  });
  it('to par: everyone at or under it plays on', () => {
    const rows = [row('a', 1, -2, 70), row('b', 2, 0, 72), row('c', 3, 3, 75)];
    const { made, line } = applyCut(rows, { after_round: 1, to_par: 0 });
    expect([...made]).toEqual(['a', 'b']);
    expect(line).toEqual({ afterRound: 1, score: 72, madeCut: 2, missed: 1 });
    expect(applyCut(rows, { after_round: 1, to_par: -5 }).line).toEqual({ afterRound: 1, score: null, madeCut: 0, missed: 3 });
  });
  it('the cut is decided when its round completes; editable until any round up to it has', () => {
    const rule = { after_round: 2, top_n: 10 };
    expect(cutDecided(rule, [{ sequence: 1, status: 'completed' }, { sequence: 2, status: 'live' }])).toBe(false);
    expect(cutDecided(rule, [{ sequence: 1, status: 'completed' }, { sequence: 2, status: 'completed' }])).toBe(true);
    expect(cutDecided(null, [{ sequence: 2, status: 'completed' }])).toBe(false);
    expect(cutEditable(rule, [{ sequence: 1, status: 'live' }, { sequence: 2, status: 'scheduled' }])).toBe(true);
    expect(cutEditable(rule, [{ sequence: 1, status: 'completed' }, { sequence: 2, status: 'scheduled' }])).toBe(false);
    expect(cutEditable({ after_round: 1, top_n: 5 }, [{ sequence: 1, status: 'scheduled' }, { sequence: 2, status: 'scheduled' }])).toBe(true);
  });
});
