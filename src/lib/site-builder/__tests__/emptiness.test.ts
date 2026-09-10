import { describe, expect, it } from 'vitest';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { EMPTY_MEMBER_STATS } from '@/lib/org-sites/member-stats';
import { isWidgetEmpty } from '../emptiness';
import { publicWidgets } from '../public-view';
import { place, seedLayout } from '../seeds';

// Hardening H1: "empty widgets never render publicly" — the structural rule,
// finally pinned per key, plus the two things the review found it missing:
// the members widget's EMPTY OBJECT, and the org's privacy re-asked at render.

const EMPTY: SiteHomeData = {
  standings: null, events: null, teams: [], staff: [], venues: [], affiliations: [], openWindows: [], courses: [], divisions: [], leaders: [],
  clubGolfBoards: [], courseStrip: null, golfRounds: [], news: [], memberStats: null,
};
const rows = (keys: string[], disabled: string[] = []) => keys.map((k, i) => ({ module_key: k, enabled: !disabled.includes(k), sort_order: i, config: {} }));
const site = (visibility: 'public' | 'private' = 'public', keys = ['hero', 'standings', 'schedule', 'teams', 'staff', 'news', 'members', 'contact'], disabled: string[] = []) => ({
  modules: rows(keys, disabled),
  hero_config: {},
  contact_config: {},
  visibility,
  template_id: 'classic',
});

describe('isWidgetEmpty', () => {
  it('members: null OR the empty stats object are both empty; one member is not', () => {
    const w = place('members', 0, 0);
    expect(isWidgetEmpty(w, EMPTY, site())).toBe(true);
    expect(isWidgetEmpty(w, { ...EMPTY, memberStats: EMPTY_MEMBER_STATS }, site())).toBe(true);
    expect(isWidgetEmpty(w, { ...EMPTY, memberStats: { ...EMPTY_MEMBER_STATS, memberCount: 1, members: [{ profileId: 'p', name: 'A' } as never] } }, site())).toBe(false);
  });

  it('every live module with no data is empty; hero and gallery never are', () => {
    for (const key of ['standings', 'schedule', 'teams', 'staff', 'venues', 'affiliations', 'sponsors', 'documents', 'contact', 'register', 'courses', 'divisions', 'leaders', 'news', 'members'] as const) {
      expect(isWidgetEmpty(place(key, 0, 0), EMPTY, site()), key).toBe(true);
    }
    expect(isWidgetEmpty(place('hero', 0, 0), EMPTY, site())).toBe(false);
    expect(isWidgetEmpty(place('gallery', 0, 0), EMPTY, site())).toBe(false);
  });

  it('a PRIVATE club: a members-only module is NOT empty even when its instance is stored public (its panel is the content); a public module still is', () => {
    const standings = place('standings', 0, 0); // stored 'public' — arranged while the club was public
    expect(isWidgetEmpty(standings, EMPTY, site('public'))).toBe(true);
    expect(isWidgetEmpty(standings, EMPTY, site('private'))).toBe(false);
    expect(isWidgetEmpty(place('schedule', 0, 0), EMPTY, site('private'))).toBe(true);
  });

  it('content widgets: empty until authored, whatever the module rows say', () => {
    expect(isWidgetEmpty(place('text', 0, 0), EMPTY, site())).toBe(true);
    expect(isWidgetEmpty(place('text', 0, 0, undefined, { config: { blocks: [{ type: 'paragraph', text: 'Hi' }] } }), EMPTY, site('private', []))).toBe(false);
    expect(isWidgetEmpty(place('image', 0, 0, undefined, { config: { path: 'org-media/x/a.jpg' } }), EMPTY, site())).toBe(false);
    expect(isWidgetEmpty(place('embed', 0, 0, undefined, { config: { embed: { provider: 'youtube', id: 'abcdefghijk' } } }), EMPTY, site())).toBe(false);
  });
});

describe('publicWidgets — the one public-render rule', () => {
  const data: SiteHomeData = { ...EMPTY, teams: [{ id: 't', name: 'Blazers' } as never], news: [{ id: 'n' } as never] };
  it('drops empties, staff-only and DISABLED modules; keeps a private club’s members-only panel; compacts', () => {
    const s = site('public', ['hero', 'standings', 'teams', 'news', 'contact'], ['news']);
    const layout = seedLayout(s);
    const out = publicWidgets(s, layout, data);
    // standings (empty) and contact (empty) drop; news is disabled → drops even though it has data.
    expect(out.map(w => w.key)).toEqual(['hero', 'teams']);
    expect(out[1].y).toBe(out[0].y + out[0].h);
    // The same layout on a PRIVATE club: standings and teams are members-only → both render (as panels).
    const priv = { ...s, visibility: 'private' as const };
    expect(publicWidgets(priv, layout, data).map(w => w.key)).toEqual(['hero', 'standings', 'teams']);
    // A staff-only instance never renders publicly.
    const withStaff = { ...layout, widgets: [...layout.widgets, place('text', 0, 50, undefined, { id: 't', visibility: 'staff', config: { blocks: [{ type: 'paragraph', text: 'internal' }] } })] };
    expect(publicWidgets(s, withStaff, data).some(w => w.id === 't')).toBe(false);
  });
});
