import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countGames, distinctKey, type CountableGame } from '../same-game';

const g = (id: string, source: CountableGame['source'], date: string | null, over: Partial<CountableGame> = {}): CountableGame => ({ id, source, date, ...over });
const run = (games: CountableGame[], distinct: string[] = [], matchByDate = true) => {
  const out = countGames(games, { matchByDate, distinct: new Set(distinct) });
  return Object.fromEntries([...out.values()].map(r => [r.id, r.counted ? 'counted' : `${r.reason}<${r.beatenBy}`]));
};

describe('countGames — one game, counted once', () => {
  it('official beats film beats post on the same date; the post is beaten by the official line, not by the beaten film', () => {
    expect(run([g('p', 'post', '2026-11-01'), g('f', 'film', '2026-11-01'), g('o', 'official', '2026-11-01')])).toEqual({ o: 'counted', f: 'same_date<o', p: 'same_date<o' });
    expect(run([g('p', 'post', '2026-11-01'), g('f', 'film', '2026-11-01')])).toEqual({ f: 'counted', p: 'same_date<f' });
    expect(run([g('p', 'post', '2026-11-01'), g('o', 'official', '2026-11-01')])).toEqual({ o: 'counted', p: 'same_date<o' });
  });
  it('different dates, or no date, are different games', () => {
    expect(run([g('p', 'post', '2026-11-02'), g('o', 'official', '2026-11-01')])).toEqual({ o: 'counted', p: 'counted' });
    expect(run([g('p', 'post', null), g('o', 'official', null)])).toEqual({ o: 'counted', p: 'counted' });
  });
  it('the same contest is the same game with no date at all, and for every film of it', () => {
    expect(run([g('o', 'official', null, { contestId: 'c1' }), g('f1', 'film', '2026-11-01', { contestId: 'c1' }), g('f2', 'film', null, { contestId: 'c1' })])).toEqual({ o: 'counted', f1: 'same_contest<o', f2: 'same_contest<o' });
  });
  it('two different contests on one date are two games — the date does not join them', () => {
    expect(run([g('o', 'official', '2026-11-01', { contestId: 'c1' }), g('f', 'film', '2026-11-01', { contestId: 'c2' })])).toEqual({ o: 'counted', f: 'counted' });
  });
  it('one to one: a tournament day with one official line and three posts counts three games', () => {
    const out = run([g('o', 'official', '2026-11-01'), g('p1', 'post', '2026-11-01'), g('p2', 'post', '2026-11-01'), g('p3', 'post', '2026-11-01')]);
    expect(Object.values(out).filter(v => v === 'counted')).toHaveLength(3);
    expect(out.p1).toBe('same_date<o');
  });
  it('among same-date candidates the opponent decides, whatever its case or spacing', () => {
    const out = run([g('o', 'official', '2026-11-01', { opponent: 'QA  Owls' }), g('p1', 'post', '2026-11-01', { opponent: 'Hawks' }), g('p2', 'post', '2026-11-01', { opponent: 'qa owls' })]);
    expect(out).toEqual({ o: 'counted', p1: 'counted', p2: 'same_date<o' });
  });
  it('three official lines and three posts on one day: each line takes one post', () => {
    const out = run(['a', 'b', 'c'].flatMap(k => [g(`o${k}`, 'official', '2026-11-01', { contestId: `c-${k}` }), g(`p${k}`, 'post', '2026-11-01')]));
    expect(Object.values(out).filter(v => v === 'counted')).toHaveLength(3);
  });
  it('posts are never matched against each other; two films of one date count once', () => {
    expect(run([g('p1', 'post', '2026-11-01'), g('p2', 'post', '2026-11-01')])).toEqual({ p1: 'counted', p2: 'counted' });
    expect(run([g('f1', 'film', '2026-11-01'), g('f2', 'film', '2026-11-01')])).toEqual({ f1: 'counted', f2: 'same_date<f1' });
    // The film tied to a contest is the one kept.
    expect(run([g('f1', 'film', '2026-11-01'), g('f2', 'film', '2026-11-01', { contestId: 'c1' })])).toEqual({ f2: 'counted', f1: 'same_date<f2' });
  });
  it('"these are two different games" lets both count — but never undoes a contest link', () => {
    expect(run([g('p', 'post', '2026-11-01'), g('f', 'film', '2026-11-01')], [distinctKey('p', 'f')])).toEqual({ f: 'counted', p: 'counted' });
    expect(run([g('o', 'official', '2026-11-01', { contestId: 'c1' }), g('f', 'film', '2026-11-01', { contestId: 'c1' })], [distinctKey('o', 'f')])).toEqual({ o: 'counted', f: 'same_contest<o' });
    expect(distinctKey('b', 'a')).toBe(distinctKey('a', 'b'));
  });
  it('a sport without sides (a meet, a round) is matched by contest only', () => {
    expect(run([g('p', 'post', '2026-11-01'), g('o', 'official', '2026-11-01')], [], false)).toEqual({ o: 'counted', p: 'counted' });
    expect(run([g('f', 'film', '2026-11-01', { contestId: 'c1' }), g('o', 'official', '2026-11-01', { contestId: 'c1' })], [], false)).toEqual({ o: 'counted', f: 'same_contest<o' });
  });
  it('the same id twice is one game; nothing in, nothing out', () => {
    expect(run([g('p', 'post', '2026-11-01'), g('p', 'post', '2026-11-01')])).toEqual({ p: 'counted' });
    expect(run([])).toEqual({});
  });
});

describe('both Stats readers count through the rule', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
  it('the tiles: after the visibility filter, an org\'s contest line is official and everything else the athlete\'s own', () => {
    const src = read('src/lib/performance/rollups-server.ts');
    expect(src).toContain('const counted = countGames(rows.map(rollupGame), { matchByDate: gameHasSides(sportKey) });');
    expect(src).toContain('rows = rows.filter(r => counted.get(r.id)?.counted !== false);');
    expect(src.indexOf("rows = rows.filter(r => r.source !== 'post' || visible.has(r.source_id));")).toBeLessThan(src.indexOf('countGames(rows.map(rollupGame)'));
    expect(src).toContain("source: r.source_table === 'contest_stat_lines' ? 'official' : 'post'");
  });
  it('the season totals: a disputed line neither counts nor beats anything; the log row says what beat it', () => {
    const src = read('src/app/api/sports/stat-lines/route.ts');
    expect(src).toContain('const confirmed = officialInYear.filter(l => !l.disputed);');
    expect(src).toContain('{ matchByDate: gameHasSides(schema.sport_key) }');
    expect(src).toContain('counted: verdict?.counted !== false,');
    expect(src).toContain('counted: !l.disputed,');
  });
});
