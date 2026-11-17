import { describe, it, expect } from 'vitest';
import { capitalized as cap, gameTitle as gt, landingSport, parseSportView, seasonTitle, sportNoun as sn, sportViewLevel, sportViewSearch, statCell, statFormatOf, statText, statTitle as st, switcherSports } from '../view';

const q = (s: string) => new URLSearchParams(s);
const GAME = 'film:11111111-2222-3333-4444-555555555555';

describe('the sport profile\'s address', () => {
  it('a bare link is the career', () => {
    expect(parseSportView(q(''))).toEqual({ tab: 'stats', season: null, game: null, stat: null, event: null, hole: null, opponent: null, period: null });
    expect(sportViewLevel(parseSportView(q('')))).toBe('career');
  });
  it('each level reads back from the address it writes', () => {
    const views = [
      { tab: 'stats' as const, season: '2025-26', game: null, stat: null, event: null, hole: null, opponent: null, period: null },
      { tab: 'stats' as const, season: '2026', game: GAME, stat: null, event: null, hole: null, opponent: null, period: null },
      { tab: 'stats' as const, season: '2026', game: GAME, stat: 'goals', event: null, hole: null, opponent: null, period: null },
      { tab: 'stats' as const, season: 'undated', game: null, stat: 'shots_on_target', event: null, hole: null, opponent: null, period: null },
      { tab: 'clips' as const, season: null, game: null, stat: null, event: null, hole: null, opponent: null, period: null },
      { tab: 'clips' as const, season: '2026', game: GAME, stat: null, event: 'goal', hole: null, opponent: null, period: null },
    ];
    for (const v of views) expect(parseSportView(q(sportViewSearch(v).slice(1)))).toEqual(v);
    expect(sportViewSearch({})).toBe('');
    expect(sportViewSearch({ season: '2025-26', stat: 'goals' })).toBe('?season=2025-26&stat=goals');
  });
  it('golf: a round is the game, and a hole is one level further', () => {
    const ROUND = 'round:11111111-2222-3333-4444-555555555555';
    const v = { tab: 'stats' as const, season: '2026', game: ROUND, stat: null, event: null, hole: 7, opponent: null, period: null };
    expect(sportViewSearch(v)).toBe(`?season=2026&game=${encodeURIComponent(ROUND)}&hole=7`);
    expect(parseSportView(q(sportViewSearch(v).slice(1)))).toEqual(v);
    for (const bad of ['0', '19', '7a', '-1', '']) expect(parseSportView(q(`hole=${bad}`)).hole).toBeNull();
    expect(parseSportView(q('hole=18')).hole).toBe(18);
  });
  it('the splits\' doors: an opponent and a period ride the season\'s address; a name is cleaned, never trusted', () => {
    const v = { tab: 'stats' as const, season: '2026', game: null, stat: null, event: null, hole: null, opponent: 'QA Owls', period: 2 };
    expect(sportViewSearch(v)).toBe('?season=2026&opponent=QA%20Owls&period=2');
    expect(parseSportView(q(sportViewSearch(v).slice(1)))).toEqual(v);
    expect(parseSportView(q('opponent=%20%20Owls%0A%09FC%20%20')).opponent).toBe('Owls FC');
    expect(parseSportView(q(`opponent=${'x'.repeat(200)}`)).opponent).toHaveLength(60);
    expect(parseSportView(q('opponent=%20')).opponent).toBeNull();
    for (const bad of ['0', '21', '2a', '-1']) expect(parseSportView(q(`period=${bad}`)).period).toBeNull();
  });
  it('the deepest level named is the level', () => {
    expect(sportViewLevel(parseSportView(q('season=2026')))).toBe('season');
    expect(sportViewLevel(parseSportView(q(`season=2026&game=${GAME}`)))).toBe('game');
  });
  it('a malformed part is dropped, never an error', () => {
    expect(parseSportView(q('season=<script>&game=nope&stat=DROP TABLE&view=x&event=A B'))).toEqual({ tab: 'stats', season: null, game: null, stat: null, event: null, hole: null, opponent: null, period: null });
  });
  it('a season reads the way people write it', () => {
    expect(seasonTitle('2025-26')).toBe('2025–26');
    expect(seasonTitle('2026')).toBe('2026');
    expect(seasonTitle('undated')).toBe('No date');
  });
});

describe('which sport opens (Tom, Nov 15 2026: the athlete\'s own order)', () => {
  const cards = [{ sportKey: 'soccer', enabled: true }, { sportKey: 'tennis', enabled: false }, { sportKey: 'basketball', enabled: true }];
  it('the switcher offers the sports with a stats door, in the order given', () => {
    expect(switcherSports(cards).map(c => c.sportKey)).toEqual(['soccer', 'basketball']);
  });
  it('a sport with no sport profile (golf, track) is not offered, and a link to it opens the first that has one', () => {
    const mixed = [{ sportKey: 'golf', enabled: true, sportProfile: false }, { sportKey: 'ice_hockey', enabled: true, sportProfile: true }, { sportKey: 'soccer', enabled: true }];
    expect(switcherSports(mixed).map(c => c.sportKey)).toEqual(['ice_hockey', 'soccer']);
    expect(landingSport(mixed, 'golf')).toBe('ice_hockey');
    expect(landingSport([{ sportKey: 'golf', enabled: true, sportProfile: false }], 'golf')).toBeNull();
  });
  it('a link that names a sport the athlete has opens it; anything else opens the first in their order', () => {
    expect(landingSport(cards, 'basketball')).toBe('basketball');
    expect(landingSport(cards, 'tennis')).toBe('soccer');
    expect(landingSport(cards, 'curling')).toBe('soccer');
    expect(landingSport(cards, null)).toBe('soccer');
    expect(landingSport([], 'soccer')).toBeNull();
  });
});

describe('a stat cell', () => {
  it('whole numbers as they are, others to one decimal, nothing as a dash', () => {
    expect(statText(12)).toBe('12');
    expect(statText(11.85)).toBe('11.9');
    expect(statText(undefined)).toBe('–');
  });
});

describe('how a column reads', () => {
  it('a race time, a clock, a number — from the field\'s own key', () => {
    expect(['time_100m', 'pace_s_per_km', 'moving_s', 'elapsed_s', 'distance_km', 'goals', 'avg_hr'].map(statFormatOf)).toEqual(['race_time', 'clock', 'clock', 'clock', 'number', 'number', 'number']);
    expect([statCell(11.85, 'race_time'), statCell(245.3, 'race_time'), statCell(60, 'race_time')]).toEqual(['11.85', '4:05.30', '1:00.00']);
    expect([statCell(280, 'clock'), statCell(3725, 'clock'), statCell(59.6, 'clock')]).toEqual(['4:40', '1:02:05', '1:00']);
    expect([statCell(12, 'number'), statCell(155.5), statCell(0, 'clock'), statCell(undefined, 'race_time')]).toEqual(['12', '155.5', '0', '–']);
  });
});

// ── Wording that does not assume a team game (Nov 16 2026) ──────────────

describe('the wording of a sport without sides', () => {
  it('"vs" belongs to a sport with two sides; a meet or a place reads as its own name', () => {
    expect(gt(true, 'QA Owls', 'Match')).toBe('vs QA Owls');
    expect(gt(false, 'Spring Open', 'Race')).toBe('Spring Open');
    expect(gt(false, '  ', 'Race')).toBe('Race');
    expect(gt(true, null, 'Game')).toBe('Game');
  });

  it('a formatted time drops the entry form\'s seconds and keeps the rest of the unit; a plain number keeps its unit', () => {
    expect(st('100m time (s)', 'race_time')).toBe('100m time');
    expect(st('Moving time (s)', 'clock')).toBe('Moving time');
    expect(st('Pace (s /km)', 'clock')).toBe('Pace /km');
    expect(st('Distance (km)', 'number')).toBe('Distance (km)');
    expect(st('Goals', 'number')).toBe('Goals');
  });

  it('one entry is a "game" where there are sides, else the sheet\'s own noun', () => {
    expect(sn(true, 'Match')).toEqual({ one: 'game', many: 'games' });
    expect(sn(false, 'Race')).toEqual({ one: 'race', many: 'races' });
    expect(sn(false, 'Run')).toEqual({ one: 'run', many: 'runs' });
    expect(sn(false, null)).toEqual({ one: 'game', many: 'games' });
    expect(cap('race')).toBe('Race');
  });
});
