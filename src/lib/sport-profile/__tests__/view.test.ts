import { describe, it, expect } from 'vitest';
import { landingSport, parseSportView, seasonTitle, sportViewLevel, sportViewSearch, statText, switcherSports } from '../view';

const q = (s: string) => new URLSearchParams(s);
const GAME = 'film:11111111-2222-3333-4444-555555555555';

describe('the sport profile\'s address', () => {
  it('a bare link is the career', () => {
    expect(parseSportView(q(''))).toEqual({ tab: 'stats', season: null, game: null, stat: null });
    expect(sportViewLevel(parseSportView(q('')))).toBe('career');
  });
  it('each level reads back from the address it writes', () => {
    const views = [
      { tab: 'stats' as const, season: '2025-26', game: null, stat: null },
      { tab: 'stats' as const, season: '2026', game: GAME, stat: null },
      { tab: 'stats' as const, season: '2026', game: GAME, stat: 'goals' },
      { tab: 'stats' as const, season: 'undated', game: null, stat: 'shots_on_target' },
      { tab: 'clips' as const, season: null, game: null, stat: null },
    ];
    for (const v of views) expect(parseSportView(q(sportViewSearch(v).slice(1)))).toEqual(v);
    expect(sportViewSearch({})).toBe('');
    expect(sportViewSearch({ season: '2025-26', stat: 'goals' })).toBe('?season=2025-26&stat=goals');
  });
  it('the deepest level named is the level', () => {
    expect(sportViewLevel(parseSportView(q('season=2026')))).toBe('season');
    expect(sportViewLevel(parseSportView(q(`season=2026&game=${GAME}`)))).toBe('game');
  });
  it('a malformed part is dropped, never an error', () => {
    expect(parseSportView(q('season=<script>&game=nope&stat=DROP TABLE&view=x'))).toEqual({ tab: 'stats', season: null, game: null, stat: null });
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
