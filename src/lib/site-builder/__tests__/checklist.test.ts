import { describe, expect, it } from 'vitest';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { buildSiteChecklistSteps, remainingSteps, siteChecklistInput } from '../checklist';
import { place, seedLayout } from '../seeds';
import type { SiteLayout } from '../layout';

// Phase 8: six steps derived from what the editor already holds; each
// step's href names what completes it.
const EMPTY: SiteHomeData = {
  standings: null, events: null, teams: [], staff: [], venues: [], affiliations: [], openWindows: [], courses: [],
  divisions: [], leaders: [], clubGolfBoards: [], courseStrip: null, golfRounds: [], news: [], memberStats: null,
};
const rows = (keys: string[]) => keys.map((k, i) => ({ module_key: k, enabled: true, sort_order: i, config: {} }));
const site = (over: Partial<{ hero_config: unknown; theme_token_set: unknown }> = {}) => ({
  modules: rows(['hero', 'standings', 'schedule', 'staff']),
  hero_config: {},
  contact_config: {},
  theme_token_set: {},
  visibility: 'public' as const,
  template_id: 'classic',
  ...over,
});

describe('siteChecklistInput', () => {
  it('a fresh site: nothing done, the hero and the first empty live tile named', () => {
    const s = site();
    const layout = seedLayout(s);
    const input = siteChecklistInput(s, layout, EMPTY, false);
    expect(input).toEqual({
      hasAccent: false,
      hasHeroImage: false,
      hasWelcome: false,
      arranged: false,
      filled: false,
      published: false,
      heroId: 'legacy:hero',
      firstEmptyLiveId: 'legacy:standings',
    });
    const steps = buildSiteChecklistSteps(input);
    expect(steps.map(st => st.key)).toEqual(['colours', 'photo', 'welcome', 'arrange', 'fill', 'publish']);
    expect(steps.every(st => !st.done)).toBe(true);
    expect(steps.find(st => st.key === 'photo')!.href).toBe('#w=legacy:hero');
    // Phase 11: arranging starts at the design gallery.
    expect(steps.find(st => st.key === 'arrange')!.href).toBe('#gallery');
    expect(steps.find(st => st.key === 'fill')!.href).toBe('#w=legacy:standings');
    expect(steps.find(st => st.key === 'fill')!.optional).toBe(true);
    // The optional step never gates "all done".
    expect(remainingSteps(steps).map(st => st.key)).toEqual(['colours', 'photo', 'welcome', 'arrange', 'publish']);
  });

  it('each step flips on its own evidence', () => {
    const s = site({ hero_config: { headline: 'Welcome!', imagePath: 'org-media/0f1e2d3c-4b5a-4978-8f6e-5d4c3b2a1908/a.jpg' }, theme_token_set: { accent: '#0f766e' } });
    const layout = seedLayout(s);
    const data: SiteHomeData = { ...EMPTY, staff: [{ name: 'Edge B.' }] as never };
    const input = siteChecklistInput(s, layout, data, true);
    expect(input).toMatchObject({ hasAccent: true, hasHeroImage: true, hasWelcome: true, arranged: false, filled: true, published: true });
    expect(input.firstEmptyLiveId).toBe('legacy:standings');
    expect(remainingSteps(buildSiteChecklistSteps(input)).map(st => st.key)).toEqual(['arrange']);
  });

  it('arranged: a moved tile or any content tile; welcome: a non-empty text tile counts', () => {
    const s = site();
    const seed = seedLayout(s);
    const moved: SiteLayout = { ...seed, widgets: seed.widgets.map(w => (w.key === 'staff' ? { ...w, w: 6 } : w)) };
    expect(siteChecklistInput(s, moved, EMPTY, false).arranged).toBe(true);
    const withText: SiteLayout = { ...seed, widgets: [...seed.widgets, place('text', 0, 50, undefined, { id: 'w_t', config: { blocks: [{ type: 'paragraph', text: 'Hello there.' }] } })] };
    const input = siteChecklistInput(s, withText, EMPTY, false);
    expect(input.arranged).toBe(true);
    expect(input.hasWelcome).toBe(true);
    const emptyText: SiteLayout = { ...seed, widgets: [...seed.widgets, place('text', 0, 50, undefined, { id: 'w_t', config: { blocks: [] } })] };
    expect(siteChecklistInput(s, emptyText, EMPTY, false).hasWelcome).toBe(false);
  });

  it('phase 9: a live tile bound to an EMPTY competition is not filled, and is the first empty live tile', () => {
    const s = site();
    const layout = seedLayout(s);
    const standings = { competitions: [{ id: 'a', rows: [{}], golf: null }, { id: 'b', rows: [], golf: null }] } as never;
    const bound: SiteLayout = { ...layout, widgets: layout.widgets.map(w => (w.key === 'standings' ? { ...w, config: { query: { competitionId: 'b' } } } : w)) };
    const input = siteChecklistInput(s, bound, { ...EMPTY, standings }, false);
    expect(input.filled).toBe(false);
    expect(input.firstEmptyLiveId).toBe('legacy:standings');
    // Bound to the competition WITH rows: filled.
    const boundA: SiteLayout = { ...layout, widgets: layout.widgets.map(w => (w.key === 'standings' ? { ...w, config: { query: { competitionId: 'a' } } } : w)) };
    expect(siteChecklistInput(s, boundA, { ...EMPTY, standings }, false).filled).toBe(true);
  });

  it('no hero on the layout: the hero steps carry no href; nothing empty: no fill href', () => {
    const s = site();
    const layout: SiteLayout = { version: 1, cols: 12, widgets: [place('staff', 0, 0)] };
    const input = siteChecklistInput(s, layout, { ...EMPTY, staff: [{ name: 'x' }] as never }, false);
    expect(input.heroId).toBeNull();
    expect(input.firstEmptyLiveId).toBeNull();
    const steps = buildSiteChecklistSteps(input);
    expect(steps.find(st => st.key === 'photo')!.href).toBeUndefined();
    expect(steps.find(st => st.key === 'fill')!.href).toBeUndefined();
  });
});
