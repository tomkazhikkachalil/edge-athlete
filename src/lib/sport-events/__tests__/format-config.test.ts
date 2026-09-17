import { describe, expect, it } from 'vitest';
import { applyCut, cutDecided, cutEditable } from '../cut';
import { cutLabel, MATCH_ALLOWANCE_DEFAULT, parseCutRule, parseFormatConfig, parseMatchConfig, readFormatConfig, readMatchConfig } from '../format-config';

describe('parseFormatConfig — strict, a miss names the field', () => {
  const ctx = { roundCount: 3, format: 'stroke_gross' };
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
    expect(readFormatConfig(null, 3, 'stroke_gross')).toEqual({});
    expect(readFormatConfig({ cut: { after_round: 9, top_n: 2 } }, 3, 'stroke_gross')).toEqual({});
    expect(readFormatConfig({ cut: { after_round: 1, top_n: 2 } }, 1, 'stroke_net')).toEqual({ cut: { after_round: 1, top_n: 2 } }); // a stored cut survives a round being cancelled
    expect(cutLabel({ after_round: 2, top_n: 20 })).toBe('Cut after round 2 · top 20');
    expect(cutLabel({ after_round: 1, to_par: 4 })).toBe('Cut after round 1 · +4 or better');
    expect(cutLabel({ after_round: 1, to_par: 0 })).toBe('Cut after round 1 · even or better');
    expect(cutLabel({ after_round: 1, to_par: -2 })).toBe('Cut after round 1 · −2 or better');
    expect(cutLabel(null)).toBeNull();
  });
});

describe('the match options (phase 3, 212)', () => {
  const match = { roundCount: 3, format: 'match_net' };
  it('sides is required and one of three; bracket defaults false; allowance 0..100 whole; unknown keys by name', () => {
    expect(parseMatchConfig({ sides: 'singles' })).toEqual({ ok: true, value: { sides: 'singles', bracket: false } });
    expect(parseMatchConfig({ sides: 'fourball', bracket: true, allowance: 85 })).toEqual({ ok: true, value: { sides: 'fourball', bracket: true, allowance: 85 } });
    expect(parseMatchConfig({})).toMatchObject({ ok: false, error: 'format_config.match.sides must be one of singles, fourball, foursomes' });
    expect(parseMatchConfig({ sides: 'scramble' })).toMatchObject({ ok: false, error: expect.stringContaining('sides') });
    expect(parseMatchConfig({ sides: 'singles', bracket: 'yes' })).toMatchObject({ ok: false, error: 'format_config.match.bracket must be true or false' });
    expect(parseMatchConfig({ sides: 'singles', allowance: 101 })).toMatchObject({ ok: false, error: expect.stringContaining('allowance') });
    expect(parseMatchConfig({ sides: 'singles', allowance: 90.5 })).toMatchObject({ ok: false });
    expect(parseMatchConfig({ sides: 'singles', extra_holes: 3 })).toEqual({ ok: false, error: 'Unknown field: format_config.match.extra_holes' });
  });
  it('cut and match never coexist: a cut on a match format and a match on a stroke format are refused by name', () => {
    expect(parseFormatConfig({ match: { sides: 'singles' } }, match)).toEqual({ ok: true, value: { match: { sides: 'singles', bracket: false } } });
    expect(parseFormatConfig({ match: null }, match)).toEqual({ ok: true, value: {} });
    expect(parseFormatConfig({ cut: { after_round: 1, top_n: 4 } }, match)).toEqual({ ok: false, error: 'format_config.cut is not allowed on a match-play format' });
    expect(parseFormatConfig({ match: { sides: 'singles' } }, { roundCount: 3, format: 'stroke_net' })).toEqual({ ok: false, error: 'format_config.match is only allowed on a match-play format' });
  });
  it('readMatchConfig: null on a stroke format; a match format with no key reads as singles, no bracket, the WHS allowance; a stored allowance wins', () => {
    expect(readMatchConfig({}, 'stroke_gross')).toBeNull();
    expect(readMatchConfig({}, 'match_gross')).toEqual({ sides: 'singles', bracket: false, allowance: 100 });
    expect(readMatchConfig({ match: { sides: 'foursomes', bracket: true } }, 'match_net')).toEqual({ sides: 'foursomes', bracket: true, allowance: 50 });
    expect(readMatchConfig({ match: { sides: 'fourball', bracket: false, allowance: 75 } }, 'match_net')).toEqual({ sides: 'fourball', bracket: false, allowance: 75 });
    expect(MATCH_ALLOWANCE_DEFAULT).toEqual({ singles: 100, fourball: 90, foursomes: 50 });
    // A stored match key on a row whose format went back to stroke reads as no options (tolerant), never a throw.
    expect(readFormatConfig({ match: { sides: 'singles' } }, 3, 'stroke_gross')).toEqual({});
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

import { parseGameConfig as parseGame, readGameConfig as readGame } from '../format-config';

describe('side teams (leftovers PR 5)', () => {
  const t1 = '11111111-1111-4111-8111-111111111111';
  const t2 = '22222222-2222-4222-8222-222222222222';
  it('two distinct team ids ride the game config; the names default to Home / Away until the route fills them', () => {
    expect(parseGame({ side_team_ids: [t1, t2] })).toEqual({ ok: true, value: { side_names: ['Home', 'Away'], side_team_ids: [t1, t2] } });
    expect(parseGame({ side_names: ['Reds', 'Blues'], side_team_ids: [t1, t2] })).toMatchObject({ ok: true, value: { side_names: ['Reds', 'Blues'], side_team_ids: [t1, t2] } });
    expect(parseGame({ side_team_ids: [t1, t1] })).toMatchObject({ ok: false, error: expect.stringContaining('differ') });
    expect(parseGame({ side_team_ids: [t1] })).toMatchObject({ ok: false, error: expect.stringContaining('two teams') });
    expect(parseGame({ side_team_ids: [t1, t2] }, 'format_config.game', { allowSideTeams: false })).toMatchObject({ ok: false, error: expect.stringContaining('created') });
    expect(readGame({ game: { side_names: ['A', 'B'], side_team_ids: [t1, t2] } }, 'game')).toEqual({ side_names: ['A', 'B'], side_team_ids: [t1, t2] });
  });
});

import { applyCut as applyCutDir } from '../cut';
import { formatConfigStale, parseCutRule as parseCut } from '../format-config';

describe('Stableford (leftovers) — the cut by places only, the stale rule, the line by direction', () => {
  it('to_par is refused by name on a Stableford format; top_n is fine', () => {
    expect(parseCut({ after_round: 1, to_par: 2 }, { roundCount: 2, format: 'stableford_net' })).toMatchObject({ ok: false, error: expect.stringContaining('to_par is not allowed on a Stableford') });
    expect(parseCut({ after_round: 1, top_n: 5 }, { roundCount: 2, format: 'stableford_net' })).toEqual({ ok: true, value: { after_round: 1, top_n: 5 } });
    expect(parseCut({ after_round: 1, to_par: 2 }, { roundCount: 2, format: 'stroke_net' }).ok).toBe(true);
  });
  it('formatConfigStale: a family change with stored keys, or a move onto Stableford with a to-par cut', () => {
    expect(formatConfigStale('stroke_gross', 'match_gross', { cut: { after_round: 1, top_n: 3 } })).toBe(true);
    expect(formatConfigStale('stroke_gross', 'stroke_net', { cut: { after_round: 1, to_par: 2 } })).toBe(false);
    expect(formatConfigStale('stroke_gross', 'stableford_gross', { cut: { after_round: 1, to_par: 2 } })).toBe(true);
    expect(formatConfigStale('stroke_gross', 'stableford_gross', { cut: { after_round: 1, top_n: 2 } })).toBe(false);
    expect(formatConfigStale('stableford_gross', 'stableford_net', {})).toBe(false);
  });
  it('the cut line is the fewest points that made it on a descending board', () => {
    const rows = [{ participantId: 'a', rank: 1, keyToPar: null, key: 40 }, { participantId: 'b', rank: 2, keyToPar: null, key: 36 }, { participantId: 'c', rank: 3, keyToPar: null, key: 30 }];
    expect(applyCutDir(rows, { after_round: 1, top_n: 2 }, 'desc').line.score).toBe(36);
    expect(applyCutDir(rows, { after_round: 1, top_n: 2 }, 'asc').line.score).toBe(40);
  });
});
