import { describe, expect, it } from 'vitest';
import type { PublicSite } from '../server';
import { neededFields, resolveHomeData, type SiteReaders } from '../widget-data';
import { deriveLegacyLayout } from '@/lib/site-builder/layout';
import { WEB_WIDGET_KEYS, WIDGETS } from '@/lib/site-builder/catalog';

function site(side: 'league' | 'club', keys: string[], visibility: 'public' | 'private' = 'public'): PublicSite {
  return {
    id: 'site', league_id: side === 'league' ? 'org' : null, club_id: side === 'club' ? 'org' : null,
    subdomain: 'qa', template_id: 'classic', theme_token_set: {}, nav_config: [], logo_path: null,
    hero_config: {}, contact_config: {}, published_at: 'TS',
    orgName: 'QA', side, orgId: 'org', orgCity: null, orgRegion: null, orgCountry: null, orgSportKey: null,
    sportKey: null, visibility, listed: true, orgDescription: null, layout: null,
    modules: keys.map((k, i) => ({ module_key: k, enabled: true, sort_order: i, config: {} })),
  };
}

/** Readers that count their calls and answer recognisable values. */
function spyReaders() {
  const calls: Record<string, number> = {};
  const hit = <T,>(name: string, value: T) => async () => {
    calls[name] = (calls[name] ?? 0) + 1;
    return value;
  };
  const readers: SiteReaders = {
    standings: hit('standings', { competitions: [] } as unknown as Awaited<ReturnType<SiteReaders['standings']>>),
    events: hit('events', [] as never[]),
    teams: hit('teams', ['T'] as never[]),
    staff: hit('staff', ['S'] as never[]),
    venues: hit('venues', ['V'] as never[]),
    affiliations: hit('affiliations', ['A'] as never[]),
    openWindows: hit('openWindows', ['W'] as never[]),
    courses: hit('courses', [{ course: { id: 'c1' } }, { course: { id: 'c2' } }] as never[]),
    divisions: hit('divisions', ['D'] as never[]),
    leaders: hit('leaders', ['L'] as never[]),
    clubGolfBoards: hit('clubGolfBoards', ['B'] as never[]),
    courseStrip: async courses => {
      calls.courseStrip = (calls.courseStrip ?? 0) + 1;
      calls.courseStripIds = courses.length;
      return { roundsPosted: 3 } as unknown as Awaited<ReturnType<SiteReaders['courseStrip']>>;
    },
    golfRounds: hit('golfRounds', ['G'] as never[]),
    news: hit('news', ['N'] as never[]),
    memberStats: hit('memberStats', { members: [] } as unknown as Awaited<ReturnType<SiteReaders['memberStats']>>),
  };
  return { readers, calls };
}

describe('neededFields', () => {
  it('is empty for an empty layout and complete for every web widget on a club', () => {
    expect(neededFields(deriveLegacyLayout(site('club', [])), 'club')).toEqual([]);
    const all = neededFields(deriveLegacyLayout(site('club', [...WEB_WIDGET_KEYS])), 'club');
    const declared = new Set(WEB_WIDGET_KEYS.flatMap(k => [...WIDGETS[k].data]));
    expect(new Set(all)).toEqual(declared);
  });
  it('drops the club-only fields on a league', () => {
    const fields = neededFields(deriveLegacyLayout(site('league', ['courses'])), 'league');
    expect(fields).toEqual(['courses']);
    expect(neededFields(deriveLegacyLayout(site('club', ['courses'])), 'club')).toEqual(['courses', 'clubGolfBoards', 'courseStrip']);
  });
});

describe('resolveHomeData', () => {
  it('runs only the readers the layout needs and leaves the rest at their empty defaults', async () => {
    const { readers, calls } = spyReaders();
    const s = site('league', ['hero', 'standings', 'schedule']);
    const data = await resolveHomeData(readers, s, deriveLegacyLayout(s));
    expect(Object.keys(calls).sort()).toEqual(['events', 'golfRounds', 'standings']);
    expect(data.standings).toEqual({ competitions: [] });
    expect(data.teams).toEqual([]);
    expect(data.news).toEqual([]);
    expect(data.memberStats).toBeNull();
    expect(data.courseStrip).toBeNull();
  });

  it('a club with courses reads the boards and the strip, handing the strip the courses it read', async () => {
    const { readers, calls } = spyReaders();
    const s = site('club', ['courses']);
    const data = await resolveHomeData(readers, s, deriveLegacyLayout(s));
    expect(calls).toMatchObject({ courses: 1, clubGolfBoards: 1, courseStrip: 1, courseStripIds: 2 });
    expect(data.courseStrip).toEqual({ roundsPosted: 3 });
    expect(data.clubGolfBoards).toEqual(['B']);
  });

  it('a league with courses reads the courses only', async () => {
    const { readers, calls } = spyReaders();
    const s = site('league', ['courses']);
    const data = await resolveHomeData(readers, s, deriveLegacyLayout(s));
    expect(Object.keys(calls)).toEqual(['courses']);
    expect(data.clubGolfBoards).toEqual([]);
    expect(data.courseStrip).toBeNull();
  });

  it('members and news read their own fields; each reader runs once', async () => {
    const { readers, calls } = spyReaders();
    const s = site('club', ['members', 'news', 'members']);
    const data = await resolveHomeData(readers, s, deriveLegacyLayout(s));
    expect(calls).toEqual({ memberStats: 1, news: 1 });
    expect(data.memberStats).toEqual({ members: [] });
    expect(data.news).toEqual(['N']);
  });

  it('a disabled module costs nothing', async () => {
    const { readers, calls } = spyReaders();
    const s = site('league', ['teams']);
    s.modules[0].enabled = false;
    await resolveHomeData(readers, s, deriveLegacyLayout(s));
    expect(calls).toEqual({});
  });
});

