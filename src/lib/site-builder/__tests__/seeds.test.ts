import { describe, expect, it } from 'vitest';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { isWidgetEmpty } from '../emptiness';
import { compactLayout, deriveMobileOrder, validateLayout, type WidgetInstance } from '../layout';
import { applySeed, isSeedLayout, place, seedLayout, isFreshSite } from '../seeds';

const rows = (keys: string[]) => keys.map((k, i) => ({ module_key: k, enabled: true, sort_order: i, config: {} }));
const site = (template_id: 'classic' | 'bold', keys: string[]) => ({
  modules: rows(keys),
  hero_config: {},
  contact_config: {},
  visibility: 'public' as const,
  template_id,
});
const KEYS = ['hero', 'standings', 'schedule', 'teams', 'staff', 'news', 'contact'];

describe('seedLayout (the template’s seed of the module rows)', () => {
  it('classic: a full-width stack, valid, compaction is a no-op', () => {
    const l = seedLayout(site('classic', KEYS));
    expect(l.widgets.every(w => w.x === 0 && w.w === 12)).toBe(true);
    expect(validateLayout(l)).toEqual([]);
    expect(compactLayout(l.widgets)).toEqual(l.widgets);
  });

  it('bold: halves pair up left/right, full-width modules span, a full-width widget starts a new row', () => {
    const l = seedLayout(site('bold', KEYS));
    const by = Object.fromEntries(l.widgets.map(w => [w.key, w])) as Record<string, WidgetInstance>;
    expect(by.hero).toMatchObject({ x: 0, w: 12, y: 0 });
    // standings (half, left) and schedule (half, right) share a row under the hero.
    expect(by.standings).toMatchObject({ x: 0, w: 6 });
    expect(by.schedule).toMatchObject({ x: 6, w: 6 });
    expect(by.schedule.y).toBe(by.standings.y);
    // teams is full-width → its own row below the pair; staff starts the next pair on the left.
    expect(by.teams).toMatchObject({ x: 0, w: 12 });
    expect(by.teams.y).toBeGreaterThanOrEqual(Math.max(by.standings.y + by.standings.h, by.schedule.y + by.schedule.h));
    expect(by.staff).toMatchObject({ x: 0, w: 6 });
    expect(by.news).toMatchObject({ x: 0, w: 12 }); // news is full-width: new row
    expect(by.contact).toMatchObject({ x: 0, w: 6 });
    expect(validateLayout(l)).toEqual([]);
    expect(compactLayout(l.widgets)).toEqual(l.widgets);
  });

  it('deriveMobileOrder is reading order: the right-hand half follows its left partner', () => {
    const l = seedLayout(site('bold', KEYS));
    expect(deriveMobileOrder(l.widgets).map(w => w.key)).toEqual(['hero', 'standings', 'schedule', 'teams', 'staff', 'news', 'contact']);
  });
});

describe('place / applySeed / isSeedLayout (phase 8)', () => {
  it('place: a widget at a cell, default size unless given, seed id', () => {
    expect(place('standings', 6, 3)).toMatchObject({ id: 'seed:standings', key: 'standings', x: 6, y: 3, w: 6, h: 4, cv: 1, config: {}, visibility: 'public' });
    expect(place('news', 0, 0, { h: 6 }, { id: 'w_1', config: { title: 'Latest' } })).toMatchObject({ id: 'w_1', w: 12, h: 6, config: { title: 'Latest' } });
  });

  it('applySeed re-lays known keys, keeps ids/options/visibility, appends the rest below in reading order', () => {
    const bold = seedLayout(site('bold', KEYS));
    // A manager's layout: classic stack, a renamed standings, a members-only teams, two text tiles and a second standings.
    const stack = seedLayout(site('classic', KEYS));
    const mine: WidgetInstance[] = [
      ...stack.widgets.map(w => (w.key === 'standings' ? { ...w, config: { title: 'Table' } } : w.key === 'teams' ? { ...w, visibility: 'members' as const } : w)),
      { id: 'w_t1', key: 'text', x: 0, y: 40, w: 6, h: 3, cv: 1, config: { blocks: [] }, visibility: 'public' },
      { id: 'w_s2', key: 'standings', x: 6, y: 40, w: 6, h: 4, cv: 1, config: { title: 'Second table' }, visibility: 'public' },
    ];
    const out = applySeed({ version: 1, cols: 12, widgets: mine }, bold);
    expect(validateLayout(out)).toEqual([]);
    const by = (id: string) => out.widgets.find(w => w.id === id)!;
    const seedBy = Object.fromEntries(bold.widgets.map(w => [w.key, w]));
    // Known keys took the seed's cell — and kept what was theirs.
    expect(by('legacy:standings')).toMatchObject({ x: seedBy.standings.x, y: seedBy.standings.y, w: 6, config: { title: 'Table' } });
    expect(by('legacy:teams')).toMatchObject({ x: 0, w: 12, visibility: 'members' });
    // The extras follow below everything the seed placed, in their reading order.
    const bottom = Math.max(...bold.widgets.map(w => w.y + w.h));
    expect(by('w_t1').y).toBeGreaterThanOrEqual(bottom);
    expect(by('w_s2').y).toBeGreaterThan(by('w_t1').y);
    expect(by('w_s2').config).toEqual({ title: 'Second table' });
    expect(out.widgets).toHaveLength(mine.length);
  });

  it('isSeedLayout compares placement only', () => {
    const seed = seedLayout(site('bold', KEYS));
    expect(isSeedLayout(seed, seed)).toBe(true);
    const renamed = { ...seed, widgets: seed.widgets.map(w => ({ ...w, id: `x_${w.key}`, config: { title: 'T' } })) };
    expect(isSeedLayout(renamed, seed)).toBe(true);
    const moved = { ...seed, widgets: seed.widgets.map(w => (w.key === 'staff' ? { ...w, x: 6 } : w)) };
    expect(isSeedLayout(moved, seed)).toBe(false);
  });
});

describe('isWidgetEmpty', () => {
  const noContent = { hero_config: {}, contact_config: {}, modules: [] as { module_key: string; config: unknown }[], visibility: 'public' as const };
  const w = (key: WidgetInstance['key'], config: unknown = {}, visibility: WidgetInstance['visibility'] = 'public'): WidgetInstance => ({
    id: key, key, x: 0, y: 0, w: 12, h: 2, cv: 1, config, visibility,
  });
  const empty: SiteHomeData = {
    standings: null, events: null, teams: [], staff: [], venues: [], affiliations: [], openWindows: [], courses: [],
    divisions: [], leaders: [], clubGolfBoards: [], courseStrip: null, golfRounds: [], news: [], memberStats: null,
  };
  it('every data widget is empty on empty data; hero and gallery never are; members-only tiles never are', () => {
    for (const key of ['standings', 'schedule', 'teams', 'staff', 'venues', 'affiliations', 'sponsors', 'documents', 'contact', 'register', 'courses', 'divisions', 'leaders', 'news', 'members'] as const) {
      expect(isWidgetEmpty(w(key), empty, noContent), key).toBe(true);
    }
    expect(isWidgetEmpty(w('hero'), empty, noContent)).toBe(false);
    expect(isWidgetEmpty(w('gallery'), empty, noContent)).toBe(false);
    expect(isWidgetEmpty(w('standings', {}, 'members'), empty, noContent)).toBe(false);
  });
  it('content flips a widget non-empty', () => {
    expect(isWidgetEmpty(w('teams'), { ...empty, teams: ['T'] as never }, noContent)).toBe(false);
    expect(isWidgetEmpty(w('schedule'), { ...empty, golfRounds: ['R'] as never }, noContent)).toBe(false);
    expect(isWidgetEmpty(w('courses'), { ...empty, courseStrip: { roundsPosted: 2 } as never }, noContent)).toBe(false);
    expect(isWidgetEmpty(w('courses'), { ...empty, clubGolfBoards: ['B'] as never }, noContent)).toBe(false);
    expect(isWidgetEmpty(w('sponsors', { sponsors: [{ name: 'Acme' }] }), empty, noContent)).toBe(false);
    expect(isWidgetEmpty(w('contact', { email: 'x@example.com' }), empty, noContent)).toBe(false);
    expect(isWidgetEmpty(w('members'), { ...empty, memberStats: { members: [{ profileId: 'p' }] } as never }, noContent)).toBe(false);
    expect(isWidgetEmpty(w('standings'), { ...empty, standings: { competitions: [{ rows: [], golf: null }] } as never }, noContent)).toBe(true);
    expect(isWidgetEmpty(w('standings'), { ...empty, standings: { competitions: [{ rows: [1], golf: null }] } as never }, noContent)).toBe(false);
  });
});

// Sep 11 2026: the ONE fresh-site rule — shared by the editor's first-open
// gallery offer and the console's welcome design pick.
describe('isFreshSite', () => {
  const fresh = site('classic', ['hero', 'standings', 'schedule']);
  const seed = seedLayout(fresh);
  it('true only when: no draft, not live, and the layout is still the seed', () => {
    expect(isFreshSite({ draft: null, published: undefined, layout: seed, site: fresh })).toBe(true);
    expect(isFreshSite({ draft: null, published: false, layout: seed, site: fresh })).toBe(true);
    expect(isFreshSite({ draft: { id: 'd', rev: 1 }, published: false, layout: seed, site: fresh })).toBe(false);
    expect(isFreshSite({ draft: null, published: true, layout: seed, site: fresh })).toBe(false);
    expect(seed.widgets.length).toBeGreaterThan(0);
    const arranged = { ...seed, widgets: seed.widgets.map((w, i) => (i === 0 ? { ...w, h: w.h + 1 } : w)) };
    expect(isFreshSite({ draft: null, published: false, layout: arranged, site: fresh })).toBe(false);
  });
});
