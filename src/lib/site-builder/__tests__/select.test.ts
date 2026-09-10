import { describe, expect, it } from 'vitest';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { isWidgetEmpty } from '../emptiness';
import type { WidgetInstance } from '../layout';
import { QUERY_LIMITS, SCHEDULE_QUERY_LIMIT_MAX, memberLimit, selectForInstance } from '../select';

// Phase 9: an instance's query is a render-side PICK on the org-wide bag —
// the same pick for the renderer and the empty rule. A layout without
// queries selects exactly what the page showed before.
const w = (key: WidgetInstance['key'], config: unknown = {}): WidgetInstance => ({ id: `w_${key}`, key, x: 0, y: 0, w: 6, h: 4, cv: 1, config, visibility: 'public' });
const comp = (id: string, rows: number, golf: unknown = null) => ({ id, name: id, season_label: null, rows: Array.from({ length: rows }, (_, i) => ({ rank: i + 1 })), golf }) as never;
const ev = (id: string, venue_id: string | null) => ({ id, title: id, venue_id }) as never;
const round = (id: string, competitionId: string) => ({ id, competitionId }) as never;
const board = (competitionId: string, rows: number, unsupported = false) => ({ competitionId, competitionName: competitionId, sportKey: 'x', unsupported, stats: [{ label: 'Goals', rows: Array.from({ length: rows }, () => ({})) }] }) as never;

const data: SiteHomeData = {
  standings: { competitions: [comp('empty', 0), comp('a', 3), comp('b', 2)] } as never,
  events: ['A', 'A', 'B', 'A', 'B', 'A', 'A'].map((v, i) => ev(`e${i}`, `venue-${v}`)),
  teams: Array.from({ length: 15 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, divisionLabels: [] })) as never,
  staff: [], venues: [], affiliations: [], openWindows: [], courses: [], divisions: [],
  leaders: [board('a', 2), board('b', 0), board('c', 1, true)],
  clubGolfBoards: [], courseStrip: null,
  golfRounds: [round('r1', 'a'), round('r2', 'b')],
  news: Array.from({ length: 5 }, (_, i) => ({ slug: `n${i}`, title: `N${i}` })) as never,
  memberStats: null,
};
const site = { hero_config: {}, contact_config: {}, modules: [] as { module_key: string; config: unknown }[], visibility: 'public' as const };

describe('selectForInstance', () => {
  it('no query: exactly today’s slices (the identity pin)', () => {
    const st = selectForInstance(w('standings'), data);
    expect(st.standings!.competitions.map(c => c.id)).toEqual(['a']); // the first with results — StandingsPreview's rule
    expect(selectForInstance(w('schedule'), data).events!.length).toBe(5);
    expect(selectForInstance(w('schedule'), data).golfRounds!.length).toBe(2);
    expect(selectForInstance(w('teams'), data).teams.length).toBe(12);
    expect(selectForInstance(w('news'), data).news!.length).toBe(3);
    expect(selectForInstance(w('leaders'), data).leaders.length).toBe(3);
    expect(memberLimit(w('members'))).toBe(8);
    // Widgets without a query dimension pass the bag through untouched.
    expect(selectForInstance(w('staff'), data)).toBe(data);
    expect(selectForInstance(w('hero'), data)).toBe(data);
  });

  it('standings: bound to one competition — that one, even when empty; a vanished id → nothing', () => {
    expect(selectForInstance(w('standings', { query: { competitionId: 'b' } }), data).standings!.competitions.map(c => c.id)).toEqual(['b']);
    expect(selectForInstance(w('standings', { query: { competitionId: 'empty' } }), data).standings!.competitions.map(c => c.id)).toEqual(['empty']);
    expect(selectForInstance(w('standings', { query: { competitionId: 'gone' } }), data).standings!.competitions).toEqual([]);
    expect(selectForInstance(w('standings'), { ...data, standings: null }).standings).toBeNull();
  });

  it('schedule: a venue narrows EVENTS (not rounds), a competition narrows the rounds, the limit clamps', () => {
    const byVenue = selectForInstance(w('schedule', { query: { venueId: 'venue-B', limit: 10 } }), data);
    expect(byVenue.events!.map(e => (e as { id: string }).id)).toEqual(['e2', 'e4']);
    expect(byVenue.golfRounds!.length).toBe(2);
    const byComp = selectForInstance(w('schedule', { query: { competitionId: 'b' } }), data);
    expect(byComp.golfRounds!.map(r => (r as { id: string }).id)).toEqual(['r2']);
    expect(byComp.events!.length).toBe(5);
    expect(selectForInstance(w('schedule', { query: { limit: 1 } }), data).events!.length).toBe(1);
    expect(selectForInstance(w('schedule', { query: { limit: 999 } }), data).events!.length).toBe(7); // clamped to the max, which the bag never exceeds
    expect(QUERY_LIMITS.schedule.max).toBe(SCHEDULE_QUERY_LIMIT_MAX);
    // Null events stay null (the reader's "no schedule" answer).
    expect(selectForInstance(w('schedule'), { ...data, events: null, golfRounds: undefined }).events).toBeNull();
  });

  it('leaders / news / teams / members: filter or slice; nothing else touched', () => {
    expect(selectForInstance(w('leaders', { query: { competitionId: 'a' } }), data).leaders.map(b => b.competitionId)).toEqual(['a']);
    expect(selectForInstance(w('news', { query: { limit: 5 } }), data).news!.length).toBe(5);
    expect(selectForInstance(w('news', { query: { limit: 50 } }), data).news!.length).toBe(5);
    expect(selectForInstance(w('teams', { query: { limit: 2 } }), data).teams.length).toBe(2);
    expect(memberLimit(w('members', { query: { limit: 3 } }))).toBe(3);
    expect(memberLimit(w('members', { query: { limit: 500 } }))).toBe(QUERY_LIMITS.members.max);
    const out = selectForInstance(w('teams', { query: { limit: 2 } }), data);
    expect(out.leaders).toBe(data.leaders);
    expect(out.events).toBe(data.events);
  });
});

describe('isWidgetEmpty honours the query', () => {
  it('a standings tile bound to a competition with no rows is empty; bound to one with rows it is not; unbound = the org', () => {
    expect(isWidgetEmpty(w('standings', { query: { competitionId: 'empty' } }), data, site)).toBe(true);
    expect(isWidgetEmpty(w('standings', { query: { competitionId: 'gone' } }), data, site)).toBe(true);
    expect(isWidgetEmpty(w('standings', { query: { competitionId: 'b' } }), data, site)).toBe(false);
    expect(isWidgetEmpty(w('standings'), data, site)).toBe(false);
    expect(isWidgetEmpty(w('standings'), { ...data, standings: { competitions: [comp('only', 0)] } as never }, site)).toBe(true);
  });
  it('a schedule bound to a venue with no events is empty unless golf rounds remain', () => {
    expect(isWidgetEmpty(w('schedule', { query: { venueId: 'venue-Z' } }), { ...data, golfRounds: [] }, site)).toBe(true);
    expect(isWidgetEmpty(w('schedule', { query: { venueId: 'venue-Z' } }), data, site)).toBe(false);
  });
  it('leaders: a board with no rows or an unsupported sport counts as empty', () => {
    expect(isWidgetEmpty(w('leaders', { query: { competitionId: 'b' } }), data, site)).toBe(true);
    expect(isWidgetEmpty(w('leaders', { query: { competitionId: 'c' } }), data, site)).toBe(true);
    expect(isWidgetEmpty(w('leaders', { query: { competitionId: 'a' } }), data, site)).toBe(false);
    expect(isWidgetEmpty(w('leaders'), data, site)).toBe(false);
    expect(isWidgetEmpty(w('leaders'), { ...data, leaders: [board('b', 0), board('c', 0, true)] }, site)).toBe(true);
  });
});
