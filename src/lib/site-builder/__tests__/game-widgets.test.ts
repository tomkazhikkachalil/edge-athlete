import { describe, expect, it } from 'vitest';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import type { TeamScheduleItem } from '@/lib/teams/schedule';
import { divisionSchedule } from '@/lib/teams/schedule';
import { GAME_WIDGET_KEYS } from '../catalog';
import { displayNumber, displayString, instanceDisplay } from '../display';
import { isWidgetEmpty } from '../emptiness';
import { newInstanceFor, type WidgetInstance } from '../layout';
import { SAMPLE_SENTINEL, sampleHomeData } from '../sample';
import { widgetAllowed } from '@/lib/orgs/switches';

// Sports-team website program, G2 (Sep 28 2026): the game-day sections —
// the next game and the latest results over the org's games bag.

const site = { modules: [{ module_key: 'schedule', enabled: true, sort_order: 0, config: {} }], hero_config: {}, contact_config: {}, visibility: 'public' as const };
const EMPTY: SiteHomeData = {
  standings: null, events: null, teams: [], staff: [], venues: [], affiliations: [], openWindows: [], courses: [], divisions: [], leaders: [],
  clubGolfBoards: [], courseStrip: null, golfRounds: [], news: [], memberStats: null,
};
const inst = (key: WidgetInstance['key']): WidgetInstance => newInstanceFor(site, key, `w_${key}`);
const item = (state: TeamScheduleItem['state']): TeamScheduleItem => ({
  kind: 'contest', key: `contest:${state}`, when: '2026-10-03T14:00:00Z', allDay: false, timezone: null,
  title: 'A vs B', opponent: null, location: null, href: null, state, result: null,
});

describe('game-day widgets', () => {
  it('are empty with no games (never rendered publicly), full with one; an absent bag is empty', () => {
    for (const key of GAME_WIDGET_KEYS) expect(isWidgetEmpty(inst(key), EMPTY, site), key).toBe(true);
    const games = { upcoming: [item('upcoming')], results: [] };
    expect(isWidgetEmpty(inst('next_game'), { ...EMPTY, games }, site)).toBe(false);
    expect(isWidgetEmpty(inst('results'), { ...EMPTY, games }, site)).toBe(true);
    expect(isWidgetEmpty(inst('results'), { ...EMPTY, games: { upcoming: [], results: [item('final')] } }, site)).toBe(false);
  });

  it('display: the first option is the default look (card; a 5-game list)', () => {
    expect(displayString(instanceDisplay(inst('next_game')), 'variant')).toBe('card');
    const d = instanceDisplay(inst('results'));
    expect(displayString(d, 'variant')).toBe('list');
    expect(displayNumber(d, 'count', 0)).toBe(5);
  });

  it('follow "We run competitions" — a switched-off org shows no game tile', () => {
    for (const key of GAME_WIDGET_KEYS) {
      expect(widgetAllowed({ teams: true, competitions: false }, key), key).toBe(false);
      expect(widgetAllowed({ teams: false, competitions: true }, key), key).toBe(true);
    }
  });

  it('sample: a next game and three finals, home first, sentinel-marked, scored', () => {
    const games = sampleHomeData('ice_hockey', 'league', new Date('2026-09-28T12:00:00Z')).games!;
    expect(games.upcoming.length).toBeGreaterThan(0);
    expect(games.results).toHaveLength(3);
    for (const g of [...games.upcoming, ...games.results]) expect(g.location).toContain(SAMPLE_SENTINEL);
    expect(games.results.every(g => g.state === 'final' && g.pair && g.pair.homeScore !== null)).toBe(true);
    expect(games.upcoming.every(g => g.state === 'upcoming' && g.pair && g.pair.homeScore === null)).toBe(true);
  });

  it('divisionSchedule carries the two sides as data (the scoreboard) — scores only once both are in', () => {
    const outcome = (h: number | null, a: number | null) => ({
      kind: 'fixture' as const,
      home: { participantId: 'p1', entryId: 'e1', name: 'Comets', score: h },
      away: { participantId: 'p2', entryId: 'e2', name: 'Blazers', score: a },
    });
    const base = { competitionName: 'Cup', round: null, playFrom: null, eventId: null, href: null };
    const out = divisionSchedule({
      calendar: [],
      contests: [
        { ...base, id: 'c1', scheduledAt: '2026-09-20T14:00:00Z', status: 'completed', outcome: outcome(2, 3) as never },
        { ...base, id: 'c2', scheduledAt: '2026-10-20T14:00:00Z', status: 'scheduled', outcome: outcome(null, null) as never },
      ],
    });
    expect(out.results[0].pair).toEqual({ home: 'Comets', away: 'Blazers', homeScore: 2, awayScore: 3 });
    expect(out.upcoming[0].pair).toEqual({ home: 'Comets', away: 'Blazers', homeScore: null, awayScore: null });
  });
});
