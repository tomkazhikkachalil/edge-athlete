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
import { selectForInstance } from '../select';
import { instanceSchemaFor } from '../schemas';

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

  it('follow EITHER switch — its own competitions, or its teams in another org’s; both off hides them', () => {
    for (const key of GAME_WIDGET_KEYS) {
      expect(widgetAllowed({ teams: true, competitions: false }, key), key).toBe(true);
      expect(widgetAllowed({ teams: false, competitions: true }, key), key).toBe(true);
      expect(widgetAllowed({ teams: false, competitions: false }, key), key).toBe(false);
    }
  });

  it('G3: a team query narrows the games to the ones that team plays; no query shows all; an untagged game never matches', () => {
    const tagged = (key: string, state: TeamScheduleItem['state'], teamIds?: string[]): TeamScheduleItem => ({ ...item(state), key, ...(teamIds ? { teamIds } : {}) });
    const games = {
      upcoming: [tagged('a', 'upcoming', ['t1', 't2']), tagged('b', 'upcoming', ['t3', 't4']), tagged('c', 'upcoming')],
      results: [tagged('d', 'final', ['t2', 't3'])],
    };
    const data = { ...EMPTY, games };
    const bound = (key: 'next_game' | 'results', teamId: string): WidgetInstance => ({ ...inst(key), config: { query: { teamId } } });
    expect(selectForInstance(inst('next_game'), data).games).toBe(games);
    expect(selectForInstance(bound('next_game', 't1'), data).games!.upcoming.map(g => g.key)).toEqual(['a']);
    expect(selectForInstance(bound('results', 't3'), data).games!.results.map(g => g.key)).toEqual(['d']);
    // A team with no games: the tile is empty (never renders publicly).
    expect(isWidgetEmpty(bound('next_game', 't9'), data, site)).toBe(true);
    expect(isWidgetEmpty(bound('next_game', 't4'), data, site)).toBe(false);
  });

  it('G3: a team query on the schedule keeps that team’s own events', () => {
    const ev = (id: string, team_id: string | null) => ({ id, title: id, description: null, location: null, starts_at: '2026-10-01T10:00:00Z', ends_at: null, all_day: false, timezone: null, category: null, venue_id: null, facility_id: null, team_id });
    const data = { ...EMPTY, events: [ev('org', null), ev('mine', 't1'), ev('other', 't2')] };
    const w: WidgetInstance = { ...inst('schedule'), config: { query: { teamId: 't1' } } };
    expect(selectForInstance(w, data).events!.map(e => e.id)).toEqual(['mine']);
    expect(selectForInstance(inst('schedule'), data).events!.map(e => e.id)).toEqual(['org', 'mine', 'other']);
  });

  it('G3: the draft schema takes a team id (a uuid only)', () => {
    const schema = instanceSchemaFor('results');
    expect(schema.safeParse({ query: { teamId: '6a1f5b0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b' } }).success).toBe(true);
    expect(schema.safeParse({ query: { teamId: 'not-a-team' } }).success).toBe(false);
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
