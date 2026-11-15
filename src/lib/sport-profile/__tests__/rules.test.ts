import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  careerOf, clipCounts, cutHeld, filmBehind, filmOfGame, gamesOfSeason, NO_SEASON, pageOf, reelOf, seasonsOf, splitByOpponent, splitByPeriod, totalsOf,
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

describe('what a viewer has not chosen to see', () => {
  it('a held game keeps its row and loses its line, its periods and its clips; the totals are untouched', () => {
    const cut = cutHeld(heldGame);
    expect(cut).toMatchObject({ key: 'film:h', held: true, counted: true, stats: {}, byPeriod: {}, clips: [] });
    expect(cutHeld(filmA)).toBe(filmA);
    expect(careerOf(all, KEYS).totals.goals).toBe(8);
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
