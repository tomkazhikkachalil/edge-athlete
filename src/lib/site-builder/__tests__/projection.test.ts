import { describe, expect, it } from 'vitest';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { isWidgetEmpty } from '../emptiness';
import { compactLayout, deriveMobileOrder, layoutFromModules, validateLayout, type WidgetInstance } from '../layout';

const rows = (keys: string[]) => keys.map((k, i) => ({ module_key: k, enabled: true, sort_order: i, config: {} }));
const site = (template_id: 'classic' | 'bold', keys: string[]) => ({
  modules: rows(keys),
  hero_config: {},
  contact_config: {},
  visibility: 'public' as const,
  template_id,
});
const KEYS = ['hero', 'standings', 'schedule', 'teams', 'staff', 'news', 'contact'];

describe('layoutFromModules', () => {
  it('classic: a full-width stack, valid, compaction is a no-op', () => {
    const l = layoutFromModules(site('classic', KEYS));
    expect(l.widgets.every(w => w.x === 0 && w.w === 12)).toBe(true);
    expect(validateLayout(l)).toEqual([]);
    expect(compactLayout(l.widgets)).toEqual(l.widgets);
  });

  it('bold: halves pair up left/right, full-width modules span, a full-width widget starts a new row', () => {
    const l = layoutFromModules(site('bold', KEYS));
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
    const l = layoutFromModules(site('bold', KEYS));
    expect(deriveMobileOrder(l.widgets).map(w => w.key)).toEqual(['hero', 'standings', 'schedule', 'teams', 'staff', 'news', 'contact']);
  });
});

describe('isWidgetEmpty', () => {
  const w = (key: WidgetInstance['key'], config: unknown = {}, visibility: WidgetInstance['visibility'] = 'public'): WidgetInstance => ({
    id: key, key, x: 0, y: 0, w: 12, h: 2, cv: 1, config, visibility,
  });
  const empty: SiteHomeData = {
    standings: null, events: null, teams: [], staff: [], venues: [], affiliations: [], openWindows: [], courses: [],
    divisions: [], leaders: [], clubGolfBoards: [], courseStrip: null, golfRounds: [], news: [], memberStats: null,
  };
  it('every data widget is empty on empty data; hero and gallery never are; members-only tiles never are', () => {
    for (const key of ['standings', 'schedule', 'teams', 'staff', 'venues', 'affiliations', 'sponsors', 'documents', 'contact', 'register', 'courses', 'divisions', 'leaders', 'news', 'members'] as const) {
      expect(isWidgetEmpty(w(key), empty), key).toBe(true);
    }
    expect(isWidgetEmpty(w('hero'), empty)).toBe(false);
    expect(isWidgetEmpty(w('gallery'), empty)).toBe(false);
    expect(isWidgetEmpty(w('standings', {}, 'members'), empty)).toBe(false);
  });
  it('content flips a widget non-empty', () => {
    expect(isWidgetEmpty(w('teams'), { ...empty, teams: ['T'] as never })).toBe(false);
    expect(isWidgetEmpty(w('schedule'), { ...empty, golfRounds: ['R'] as never })).toBe(false);
    expect(isWidgetEmpty(w('courses'), { ...empty, courseStrip: { roundsPosted: 2 } as never })).toBe(false);
    expect(isWidgetEmpty(w('courses'), { ...empty, clubGolfBoards: ['B'] as never })).toBe(false);
    expect(isWidgetEmpty(w('sponsors', { sponsors: [{ name: 'Acme' }] }), empty)).toBe(false);
    expect(isWidgetEmpty(w('contact', { email: 'x@example.com' }), empty)).toBe(false);
    expect(isWidgetEmpty(w('members'), { ...empty, memberStats: { members: [] } as never })).toBe(false);
    expect(isWidgetEmpty(w('standings'), { ...empty, standings: { competitions: [{ rows: [], golf: null }] } as never })).toBe(true);
    expect(isWidgetEmpty(w('standings'), { ...empty, standings: { competitions: [{ rows: [1], golf: null }] } as never })).toBe(false);
  });
});
