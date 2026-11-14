import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countGames, distinctKey, gameKey, parseDistinctBody, type CountableGame } from '../same-game';

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
  it('a beaten game speaks for its winner: the film of a contest carries its date to the undated official line, and the post of that day is the same game', () => {
    expect(run([g('o', 'official', null, { contestId: 'c1' }), g('f', 'film', '2026-11-01', { contestId: 'c1' }), g('p', 'post', '2026-11-01')])).toEqual({ o: 'counted', f: 'same_contest<o', p: 'same_date<o' });
    // …but still one to one per winner: the line and its film together take ONE post of the day, not two.
    const out = run([g('o', 'official', '2026-11-01'), g('f', 'film', '2026-11-01'), g('p1', 'post', '2026-11-01'), g('p2', 'post', '2026-11-01')]);
    expect(out).toEqual({ o: 'counted', f: 'same_date<o', p1: 'same_date<o', p2: 'counted' });
    // And "different games" is asked of the winner: the athlete said the post is not the official game.
    expect(run([g('o', 'official', null, { contestId: 'c1' }), g('f', 'film', '2026-11-01', { contestId: 'c1' }), g('p', 'post', '2026-11-01')], [distinctKey('o', 'p')])).toEqual({ o: 'counted', f: 'same_contest<o', p: 'counted' });
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
    expect(src).toContain("[...rows.map(rollupGame), ...film.map(f => ({ id: filmId(f.videoId), source: 'film' as const, date: f.date, contestId: f.contestId }))],");
    expect(src).toContain('{ matchByDate: gameHasSides(sportKey), distinct }');
    expect(src).toContain('...rows.filter(r => counted.get(rollupGame(r).id)?.counted !== false),');
    // A counted film game is one more event — the club's record — and film is never stored.
    expect(src).toContain("...film.filter(f => counted.get(filmId(f.videoId))?.counted !== false).map(f => ({ occurred_on: f.date, metrics: f.stats, provenance: 'club_recorded' })),");
    expect(src.indexOf("rows = rows.filter(r => r.source !== 'post' || visible.has(r.source_id));")).toBeLessThan(src.indexOf('...rows.map(rollupGame)'));
    expect(src).toContain("const official = r.source_table === 'contest_stat_lines';");
  });
  it('the season totals: a disputed line neither counts nor beats anything; the log row says what beat it', () => {
    const src = read('src/app/api/sports/stat-lines/route.ts');
    expect(src).toContain('const confirmed = officialInYear.filter(l => !l.disputed);');
    expect(src).toContain('matchByDate: gameHasSides(schema.sport_key)');
    expect(src).toContain('counted: isCounted(postGameId(l.postId)),');
    expect(src).toContain("...filmInYear.map(f => ({ id: filmGameId(f.videoId), source: 'film' as const, date: f.date, contestId: f.contestId })),");
    expect(src).toContain('const film = filmInYear.map(f => ({ videoId: f.videoId, key: filmGameId(f.videoId), counted: isCounted(filmGameId(f.videoId)), sameAs: sameAsOf(filmGameId(f.videoId)), splitFrom: splitFromOf(filmGameId(f.videoId)) }));');
    expect(src).toContain("{ headers: { 'Cache-Control': 'private, no-store' } }");
    expect(src).toContain('counted: !l.disputed,');
  });
});

describe('"these are two different games" (migration 309)', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
  const A = gameKey.post('11111111-1111-4111-8111-111111111111');
  const B = gameKey.film('22222222-2222-4222-8222-222222222222');
  it('the body names two different games as the rule names them, stored in one order', () => {
    expect(parseDistinctBody({ sport: 'basketball', a: A, b: B, distinct: true })).toEqual({ ok: true, value: { sport: 'basketball', a: B, b: A, distinct: true } });
    expect(parseDistinctBody({ sport: 'basketball', a: B, b: A, distinct: false })).toEqual({ ok: true, value: { sport: 'basketball', a: B, b: A, distinct: false } });
    expect(parseDistinctBody({ sport: 'basketball', a: A, b: A, distinct: true }).ok).toBe(false);
    expect(parseDistinctBody({ sport: 'basketball', a: 'post:nope', b: B, distinct: true }).ok).toBe(false);
    expect(parseDistinctBody({ sport: '', a: A, b: B, distinct: true }).ok).toBe(false);
    expect(parseDistinctBody({ sport: 'basketball', a: A, b: B }).ok).toBe(false);
    expect(parseDistinctBody(null).ok).toBe(false);
  });
  it('only the athlete or their guardian says it, about their own stats; both readers ask the same pairs under the same names', () => {
    const route = read('src/app/api/sports/stat-lines/distinct/route.ts');
    expect(route).toContain("resolveActingProfile(user.id, request.nextUrl.searchParams.get('profileId'), 'Only the athlete or their guardian can say this')");
    expect(route).toContain('setDistinctPair(getSupabaseAdmin(), acting.actorId, user.id, parsed.value)');
    expect(route).toContain("getServerAuth(request, { limit: 'settings-write' })");
    const totals = read('src/app/api/sports/stat-lines/route.ts');
    expect(totals).toContain('const pairs = await readDistinctPairs(supabase, profileId, schema.sport_key);');
    expect(totals).toContain('{ matchByDate: gameHasSides(schema.sport_key), distinct: distinctSet(pairs) }');
    expect(totals).toContain("canSplit: verdict.reason === 'same_date'");
    expect(totals).toContain('canEdit: isOwner || actsFor,');
    const tiles = read('src/lib/performance/rollups-server.ts');
    expect(tiles).toContain('const distinct = distinctSet(await readDistinctPairs(admin, profileId, sportKey));');
    expect(tiles).toContain("r.source_table === 'posts' ? gameKey.post(r.source_id) : r.id");
  });
  it('the table: service role only, the pair in one spelling, gone with the person', () => {
    const sql = read('database/migrations/309_stat_game_distinct.sql');
    expect(sql).toContain('CONSTRAINT stat_game_distinct_order_check CHECK (game_a < game_b)');
    expect(sql).toContain('REVOKE ALL ON TABLE public.stat_game_distinct FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT ALL ON TABLE public.stat_game_distinct TO service_role;');
    expect(sql).toContain('FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE');
    expect(read('src/lib/account-deletion.ts')).toContain("await mustDelete('stat_game_distinct', 'profile_id');");
    expect(read('src/lib/account-departure.ts')).toContain("'stat_game_distinct.profile_id': 'goes',");
  });
});
