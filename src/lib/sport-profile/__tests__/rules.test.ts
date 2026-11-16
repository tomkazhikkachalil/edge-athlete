import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  aggregateOf, columnRule, careerOf, clipCounts, clipCountsOfGame, cutHeld, filmBehind, filmOfGame, forViewer, gamesOfSeason, NO_SEASON, pageOf, reelOf, reelPlaylist, reelStep, seasonsOf, splitByOpponent, splitByPeriod, totalsOf,
  type ProfileClip, type ProfileGame,
} from '../rules';

/**
 * The athlete's sport profile (Sprint 4): Career → Season → Game → Play.
 * Every number is the sum of the counted games, and every number opens the
 * clips behind it.
 */
const hockeySeason = (d: string): string => {
  const y = Number(d.slice(0, 4));
  const start = Number(d.slice(5, 7)) >= 9 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const clip = (id: string, videoId: string, startMs: number, statKeys: string[], more: Partial<ProfileClip> = {}): ProfileClip => ({
  id, videoId, youtubeId: `yt-${videoId}`, startMs, endMs: null, eventKey: statKeys.includes('goals') ? 'goal' : 'shot', period: 1, label: '', statKeys, ...more,
});
const game = (key: string, more: Partial<ProfileGame> = {}): ProfileGame => ({
  key, source: key.split(':')[0] as ProfileGame['source'], date: '2026-01-10', title: 'Hawks vs Owls', opponent: 'Owls', stats: {}, counted: true, sameAs: null,
  standing: null, videoId: null, href: null, held: false, clips: [], byPeriod: {}, ...more,
});

// A season in two halves of the year, a filmed game beaten by its official line, a recreational game, a spoiler-free game.
const filmA = game('film:a', { date: '2025-10-04', standing: 'verified', videoId: 'a', stats: { goals: 2, shots: 5 }, byPeriod: { 1: { goals: 1, shots: 2 }, 3: { goals: 1, shots: 3 } }, clips: [clip('a2', 'a', 9000, ['goals', 'shots'], { period: 3 }), clip('a1', 'a', 1000, ['goals', 'shots']), clip('a3', 'a', 5000, ['shots'])] });
const officialB = game('official:b', { date: '2026-02-01', opponent: 'owls ', stats: { goals: 1, shots: 4 } });
const filmB = game('film:b', { date: '2026-02-01', standing: 'verified', videoId: 'b', counted: false, sameAs: 'official:b', stats: { goals: 1, shots: 3 }, clips: [clip('b1', 'b', 2000, ['goals', 'shots'])] });
const rec = game('film:r', { date: '2026-02-08', standing: 'recreational', videoId: 'r', counted: false, opponent: 'Kites', stats: { goals: 4 }, clips: [clip('r1', 'r', 100, ['goals'])] });
const heldGame = game('film:h', { date: '2026-03-01', standing: 'verified', videoId: 'h', held: true, opponent: 'Kites', stats: { goals: 3, shots: 3 }, byPeriod: { 2: { goals: 3 } }, clips: [clip('h1', 'h', 100, ['goals'])] });
const post = game('post:p', { date: '2026-10-12', opponent: 'Kites', stats: { goals: 1, shots: 2, hat_tricks_nobody_sums: 9 } });
const undated = game('official:u', { date: null, opponent: null, stats: { goals: 1 } });
const all = [filmA, officialB, filmB, rec, heldGame, post, undated];
const KEYS = ['goals', 'shots'];

describe('level 1: career and seasons', () => {
  it('the career is the counted games; a beaten game and a recreational one add nothing; only the sport\'s fields are summed', () => {
    expect(careerOf(all, KEYS)).toEqual({ games: 5, totals: { goals: 8, shots: 14 } });
    expect(totalsOf([rec, filmB], KEYS)).toEqual({ games: 0, totals: {} });
  });
  it('one row per season by the sport\'s own season, newest first, the undated last', () => {
    const seasons = seasonsOf(all, hockeySeason, KEYS);
    expect(seasons.map(s => s.key)).toEqual(['2026-27', '2025-26', NO_SEASON]);
    expect(seasons[1]).toEqual({ key: '2025-26', games: 3, totals: { goals: 6, shots: 12 }, from: '2025-10-04', to: '2026-03-01' });
    expect(seasons[2].games).toBe(1);
  });
  it('the seasons add up to the career', () => {
    const seasons = seasonsOf(all, hockeySeason, KEYS);
    expect(seasons.reduce((n, s) => n + s.games, 0)).toBe(careerOf(all, KEYS).games);
    expect(seasons.reduce((n, s) => n + (s.totals.goals ?? 0), 0)).toBe(8);
  });
  it('a season with only recreational film is still a season to open — with nothing counted', () => {
    const only = seasonsOf([rec], hockeySeason, KEYS);
    expect(only).toEqual([{ key: '2025-26', games: 0, totals: {}, from: '2026-02-08', to: '2026-02-08' }]);
    expect(seasonsOf([game('post:x', { counted: false })], hockeySeason, KEYS)).toEqual([]);
  });
});

describe('level 2: the season', () => {
  const season = gamesOfSeason(all, '2025-26', hockeySeason);
  it('the game log is every game of the season, newest first', () => {
    expect(season.map(g => g.key)).toEqual(['film:h', 'film:r', 'film:b', 'official:b', 'film:a']);
  });
  it('by opponent: counted games grouped whatever the spelling; a spoiler-free game is never under its opponent', () => {
    const split = splitByOpponent(season, KEYS);
    expect(split.rows).toEqual([{ label: 'Owls', games: 2, totals: { goals: 3, shots: 9 } }]);
    expect(split.rest).toEqual({ games: 1, totals: { goals: 3, shots: 3 } });
  });
  it('by period: what the film says, never a held game', () => {
    expect(splitByPeriod(season, KEYS)).toEqual([
      { period: 1, games: 1, totals: { goals: 1, shots: 2 } },
      { period: 3, games: 1, totals: { goals: 1, shots: 3 } },
    ]);
  });
});

describe('levels 3 and 4: the game and the plays', () => {
  it('the film behind the numbers: counted verified film, and the film of a game its official line counted for — never recreational', () => {
    expect(filmBehind(all).map(g => g.key)).toEqual(['film:a', 'film:b', 'film:h']);
  });
  it('an official line opens the film that is the same game', () => {
    expect(filmOfGame(all, 'official:b')?.key).toBe('film:b');
    expect(filmOfGame(all, 'film:a')?.key).toBe('film:a');
    expect(filmOfGame(all, 'post:p')).toBeNull();
  });
  it('a stat\'s reel: every clip behind it, oldest game first and in game order; a held game gives none', () => {
    expect(reelOf(all, { stat: 'goals' }).map(c => c.id)).toEqual(['a1', 'a2', 'b1']);
    expect(reelOf(all, { stat: 'shots' }).map(c => c.id)).toEqual(['a1', 'a3', 'a2', 'b1']);
    expect(reelOf(all, { stat: 'goals' })[2]).toMatchObject({ gameKey: 'film:b', gameTitle: 'Hawks vs Owls', gameDate: '2026-02-01', youtubeId: 'yt-b' });
  });
  it('narrowed to a game, an event or a period', () => {
    expect(reelOf(all, { game: 'official:b' }).map(c => c.id)).toEqual(['b1']);
    expect(reelOf(all, { game: 'film:a', period: 3 }).map(c => c.id)).toEqual(['a2']);
    expect(reelOf(all, { event: 'shot' }).map(c => c.id)).toEqual(['a3']);
    expect(reelOf(all, { game: 'post:p' })).toEqual([]);
  });
  it('the Clips browser takes every film game, recreational included and marked', () => {
    const every = reelOf(all, { everyFilm: true });
    expect(every.map(c => c.id)).toEqual(['a1', 'a3', 'a2', 'b1', 'r1']);
    expect(every[4].standing).toBe('recreational');
  });
  it('a number is a door only where clips are behind it', () => {
    expect(clipCounts(all)).toEqual({ goals: 3, shots: 4 });
    expect(clipCounts([officialB, post])).toEqual({});
  });
});

describe('a game\'s own doors, and the reel as the player walks it', () => {
  it('a game\'s cells open its own film, or the film that is the same game; a held game and a game with no film open nothing', () => {
    expect(clipCountsOfGame(all, 'film:a')).toEqual({ goals: 2, shots: 3 });
    expect(clipCountsOfGame(all, 'official:b')).toEqual({ goals: 1, shots: 1 });
    expect(clipCountsOfGame(all, 'film:h')).toEqual({});
    expect(clipCountsOfGame(all, 'post:p')).toEqual({});
    expect(clipCountsOfGame(all, 'film:r')).toEqual({ goals: 1 }); // a recreational game still plays its own clips
  });
  it('every clip gets a definite end: its own, or the open length', () => {
    const list = reelPlaylist([{ id: 'x', youtubeId: 'y1', startMs: 1000, endMs: 4000 }, { id: 'z', youtubeId: 'y2', startMs: 9000, endMs: null }], 20_000);
    expect(list).toEqual([{ id: 'x', youtubeId: 'y1', startMs: 1000, endMs: 4000 }, { id: 'z', youtubeId: 'y2', startMs: 9000, endMs: 29_000 }]);
  });
  it('stay until the clip\'s end, step to the next — into another video — and stop after the last', () => {
    const list = reelPlaylist([{ id: 'x', youtubeId: 'y1', startMs: 1000, endMs: 4000 }, { id: 'z', youtubeId: 'y2', startMs: 9000, endMs: null }], 20_000);
    expect(reelStep(list, 0, 0)).toEqual({ action: 'stay' }); // the player still arriving
    expect(reelStep(list, 0, 3999)).toEqual({ action: 'stay' });
    expect(reelStep(list, 0, 4000)).toEqual({ action: 'next', index: 1 });
    expect(reelStep(list, 1, 29_000)).toEqual({ action: 'done' });
    expect(reelStep(list, 5, 0)).toEqual({ action: 'done' });
  });
});

describe('what a viewer has not chosen to see', () => {
  it('a held game keeps its row and loses its line, its periods and its clips; the totals are untouched', () => {
    const cut = cutHeld(heldGame);
    expect(cut).toMatchObject({ key: 'film:h', held: true, counted: true, stats: {}, byPeriod: {}, clips: [] });
    expect(cutHeld(filmA)).toBe(filmA);
    expect(careerOf(all, KEYS).totals.goals).toBe(8);
  });
});

describe('what the athlete hid from their page (311; Tom: the stat still counts)', () => {
  const hiddenGame = { ...filmA, hidden: true };
  const clipHidden = { ...filmB, clips: [{ ...filmB.clips[0], hidden: true }] };
  const mine = [hiddenGame, officialB, clipHidden, post];
  it('the athlete and their guardian are sent everything, marked', () => {
    const own = forViewer(mine, true);
    expect(own.find(g => g.key === 'film:a')).toMatchObject({ hidden: true, clips: filmA.clips });
    expect(own.some(g => g.concealed)).toBe(false);
    expect(reelOf(own, { stat: 'goals' }).map(c => c.id)).toEqual(['a1', 'a2', 'b1']);
  });
  it('a visitor: the hidden game keeps only what a total needs, the hidden clip is gone, and the totals are the same', () => {
    const theirs = forViewer(mine, false);
    expect(theirs.find(g => g.key === 'film:a')).toMatchObject({ concealed: true, clips: [], byPeriod: {}, stats: filmA.stats, counted: true });
    expect(theirs.find(g => g.key === 'film:b')!.clips).toEqual([]);
    expect(careerOf(theirs, KEYS)).toEqual(careerOf(mine, KEYS));
    expect(reelOf(theirs, { stat: 'goals' })).toEqual([]);
    expect(reelOf(theirs, { everyFilm: true })).toEqual([]);
    expect(clipCounts(theirs)).toEqual({});
  });
  it('a hidden game is never under its opponent, and is no film to open', () => {
    const theirs = forViewer(mine, false);
    expect(splitByOpponent(theirs, KEYS).rows.find(r => r.label.toLowerCase() === 'owls')!.games).toBe(1);
    expect(splitByOpponent(theirs, KEYS).rest).toEqual({ games: 1, totals: { goals: 2, shots: 5 } });
    expect(filmOfGame(theirs, 'film:a')).toBeNull();
    expect(clipCountsOfGame(theirs, 'film:a')).toEqual({});
  });
});

describe('paging a reel', () => {
  const items = Array.from({ length: 150 }, (_, i) => i);
  it('sixty at a time, the cursor is how many were taken', () => {
    expect(pageOf(items, 0)).toMatchObject({ next: 60 });
    expect(pageOf(items, 120)).toEqual({ items: items.slice(120), next: null });
  });
  it('a bad cursor starts over and a limit is bounded', () => {
    expect(pageOf(items, Number.NaN).items[0]).toBe(0);
    expect(pageOf(items, 0, 5000).items.length).toBe(150);
    expect(pageOf(items, 0, 0).items.length).toBe(60);
  });
});

describe('the module and its doors', () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');
  it('migration 311: one table, posture A, the grants in the file, a game or a clip hidden once, the ledger row', () => {
    const sql = read('database/migrations/311_profile_film_hidden.sql');
    expect(sql).toContain("IF n < 310 THEN RAISE EXCEPTION '311 pre-flight: ledger head is %, expected 310', n; END IF;");
    expect(sql).toContain('REVOKE ALL ON TABLE public.profile_film_hidden FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT ALL ON TABLE public.profile_film_hidden TO service_role;');
    expect(sql).toMatch(/profile_film_hidden_game_uidx ON public\.profile_film_hidden \(profile_id, video_id\) WHERE highlight_id IS NULL/);
    expect(sql).toMatch(/profile_film_hidden_clip_uidx ON public\.profile_film_hidden \(profile_id, highlight_id\) WHERE highlight_id IS NOT NULL/);
    expect(sql).toContain("VALUES (311, '311_profile_film_hidden.sql') ON CONFLICT (number) DO NOTHING;");
    expect(read('src/lib/account-departure.ts')).toContain("'profile_film_hidden.profile_id': 'goes',");
    expect(read('src/lib/account-deletion.ts')).toContain("await mustDelete('profile_film_hidden', 'profile_id');");
  });
  it('hiding is the athlete\'s or their guardian\'s, and only of something they are tagged in', () => {
    const route = read('src/app/api/profile/[profileId]/film-hidden/route.ts');
    expect(route).toMatch(/resolveActingProfile\(user\.id, profileId, /);
    expect(route).toContain("'Cache-Control': 'private, no-store'");
    const writer = read('src/lib/sport-profile/film-hide-server.ts');
    expect(writer).toMatch(/from\('video_highlight_people'\)\.select\('id'\)\.eq\('profile_id', profileId\)\.eq\('video_id', target\.videoId\)\.eq\('status', 'active'\)/);
    expect(writer).toContain("return { ok: false, status: 404, error: 'That is not on this profile' };");
  });
  it('the rules import nothing', () => {
    expect(read('src/lib/sport-profile/rules.ts')).not.toMatch(/^import /m);
  });
  it('both routes are private, answer 404 for a viewer the profile refuses, and go through the one gate', () => {
    for (const f of ['src/app/api/profile/[profileId]/sport-profile/route.ts', 'src/app/api/profile/[profileId]/sport-clips/route.ts']) {
      const src = read(f);
      expect(src).toContain("'Cache-Control': 'private, no-store'");
      expect(src).toMatch(/const who = await sportProfileViewer\(admin, user \?\? null, profileId\);\s+if \(!who\) return NOT_FOUND\(\);/);
    }
  });
  it('the gate closes on a block in either direction, and so does the tagged list', () => {
    expect(read('src/lib/sport-profile/sport-profile-server.ts')).toMatch(/if \(await blockedFromProfile\(admin, user\?\.id \?\? null, profileId\)\) return null;/);
    expect(read('src/app/api/videos/tagged/route.ts')).toContain('blockedFromProfile(admin, user?.id ?? null, profileId)');
  });
  it('the film read asks who may open a video once per owner, through the same rights every video read uses', () => {
    const src = read('src/lib/sport-profile/sport-profile-server.ts');
    expect(src).toContain('viewRight(facts).allowed');
    expect(src).toContain('profileMemo.get(row.profile_id)');
    expect(src).not.toContain('readVideoForViewer');
  });
});

describe('each column by its own rule (one wave, phase 4)', () => {
  const race = (key: string, date: string, stats: Record<string, number>, more: Partial<ProfileGame> = {}) => game(key, { date, stats, ...more });
  it('a game with sides adds every column up; a race: distance and time add up, a pace or a race time is the lowest, a max the highest, an average averaged', () => {
    for (const k of ['goals', 'time_100m', 'pace_s_per_km', 'max_hr', 'avg_hr']) expect(columnRule(k, true)).toBe('sum');
    expect(['distance_km', 'moving_s', 'elev_gain_m', 'calories'].map(k => columnRule(k, false))).toEqual(['sum', 'sum', 'sum', 'sum']);
    expect(['time_100m', 'time_1500m', 'pace_s_per_km', 'pace_s_per_100m'].map(k => columnRule(k, false))).toEqual(['low', 'low', 'low', 'low']);
    expect([columnRule('max_hr', false), columnRule('avg_hr', false), columnRule('avg_power', false)]).toEqual(['high', 'avg', 'avg']);
  });
  it('a best is the first counted game to reach it; a game that is not counted never sets one', () => {
    const runs = [
      race('post:a', '2026-03-01', { distance_km: 10, moving_s: 3000, pace_s_per_km: 300, avg_hr: 150, max_hr: 171 }),
      race('post:b', '2026-04-01', { distance_km: 5, moving_s: 1400, pace_s_per_km: 280, avg_hr: 161, max_hr: 180 }),
      race('post:c', '2026-05-01', { distance_km: 5, moving_s: 1400, pace_s_per_km: 280, max_hr: 180 }), // equals the best: did not set it
      race('post:x', '2026-06-01', { distance_km: 42, pace_s_per_km: 200 }, { counted: false }),
    ];
    const keys = ['distance_km', 'moving_s', 'pace_s_per_km', 'avg_hr', 'max_hr', 'calories'];
    const a = aggregateOf(runs, keys, k => columnRule(k, false));
    expect(a.games).toBe(3);
    expect(a.totals).toEqual({ distance_km: 20, moving_s: 5800, pace_s_per_km: 280, avg_hr: 155.5, max_hr: 180 });
    expect(a.bestIn).toEqual({ pace_s_per_km: 'post:b', max_hr: 'post:b' });
    // Track: one event a race — each event's season best, and where it was run.
    const meets = [race('official:m1', '2026-05-10', { time_100m: 11.92 }), race('post:m2', '2026-06-10', { time_100m: 11.85, time_200m: 24.1 }), race('post:m3', '2026-07-10', { time_200m: 23.95 })];
    const t = aggregateOf(meets, ['time_100m', 'time_200m', 'time_400m'], k => columnRule(k, false));
    expect(t.totals).toEqual({ time_100m: 11.85, time_200m: 23.95 });
    expect(t.bestIn).toEqual({ time_100m: 'post:m2', time_200m: 'post:m3' });
  });
  it('a sport that adds up is the sum it always was', () => {
    const games = [game('post:1', { stats: { goals: 2, shots: 5 } }), game('post:2', { stats: { goals: 1 } }), game('film:3', { counted: false, stats: { goals: 9 } })];
    const a = aggregateOf(games, ['goals', 'shots'], k => columnRule(k, true));
    expect(a.totals).toEqual(totalsOf(games, ['goals', 'shots']).totals);
    expect(a.bestIn).toEqual({});
  });
});
