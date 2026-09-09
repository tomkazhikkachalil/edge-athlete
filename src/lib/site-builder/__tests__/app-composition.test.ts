import { describe, expect, it } from 'vitest';
import { buildAppComposition, resolveTile } from '../app-composition';
import { deriveAppLayout, isVisibleTo, projectLayoutForApp, spanFor } from '../app-layout';
import { place, seedLayout } from '../seeds';
import type { SiteLayout } from '../layout';

// Phase 10: the org GET carries the site's composition — the app-capable
// instances in reading order, pruned to the viewer — and the glance grid
// interleaves the app-only / pinned widgets at their registry priority.
const rows = (keys: string[]) => keys.map((k, i) => ({ module_key: k, enabled: true, sort_order: i, config: {} }));
const site = (keys: string[]) => ({ modules: rows(keys), hero_config: {}, contact_config: {}, visibility: 'public' as const, template_id: 'classic' });
const SITE = '0f1e2d3c-4b5a-4978-8f6e-5d4c3b2a1908';
const ANON = { isMember: false, canManage: false };
const MEMBER = { isMember: true, canManage: false };
const MANAGER = { isMember: true, canManage: true };

describe('projectLayoutForApp / buildAppComposition', () => {
  it('null layout → null; the layout’s app-capable instances in reading order with their titles; web-only widgets dropped', () => {
    expect(buildAppComposition(null, SITE, ANON)).toBeNull();
    const layout = seedLayout(site(['hero', 'staff', 'standings', 'schedule', 'contact', 'news']));
    const titled: SiteLayout = { ...layout, widgets: layout.widgets.map(w => (w.key === 'standings' ? { ...w, config: { title: 'Table' } } : w)) };
    const comp = buildAppComposition(titled, SITE, ANON)!;
    // hero, staff, contact have no app surface.
    expect(comp.widgets.map(w => w.key)).toEqual(['standings', 'schedule', 'news']);
    expect(comp.widgets[0]).toMatchObject({ id: 'legacy:standings', title: 'Table', visibility: 'public' });
    expect(comp.widgets[1].title).toBeNull();
  });

  it('reading order is the phone’s: top to bottom, then left to right', () => {
    const layout: SiteLayout = {
      version: 1,
      cols: 12,
      widgets: [place('hero', 0, 0), place('news', 6, 3, { w: 6 }, { id: 'n' }), place('standings', 0, 3, { w: 6 }, { id: 's' }), place('schedule', 0, 7, { w: 12 }, { id: 'e' })],
    };
    expect(projectLayoutForApp(layout).map(w => w.id)).toEqual(['s', 'n', 'e']);
  });

  it('prunes by the viewer: members-only for members and managers, staff for managers; pinned ignores visibility', () => {
    const layout: SiteLayout = {
      version: 1,
      cols: 12,
      widgets: [
        place('standings', 0, 0, undefined, { id: 'pub' }),
        place('schedule', 6, 0, undefined, { id: 'mem', visibility: 'members' }),
        place('news', 0, 4, undefined, { id: 'staff', visibility: 'staff' }),
        place('members', 0, 8, undefined, { id: 'pinned', visibility: 'members' }),
      ],
    };
    expect(buildAppComposition(layout, SITE, ANON)!.widgets.map(w => w.id)).toEqual(['pub', 'pinned']);
    expect(buildAppComposition(layout, SITE, MEMBER)!.widgets.map(w => w.id)).toEqual(['pub', 'mem', 'pinned']);
    expect(buildAppComposition(layout, SITE, MANAGER)!.widgets.map(w => w.id)).toEqual(['pub', 'mem', 'staff', 'pinned']);
    expect(isVisibleTo({ key: 'standings', visibility: 'staff' }, MEMBER)).toBe(false);
    expect(isVisibleTo({ key: 'gallery', visibility: 'staff' }, ANON)).toBe(true);
  });

  it('spanFor: module bubbles keep the registry span; a content tile spans by width, never sm', () => {
    expect(spanFor({ key: 'standings', w: 12 })).toBe('md');
    expect(spanFor({ key: 'schedule', w: 12 })).toBe('sm');
    expect(spanFor({ key: 'text', w: 6 })).toBe('md');
    expect(spanFor({ key: 'text', w: 12 })).toBe('lg');
    expect(spanFor({ key: 'image', w: 4 })).toBe('md');
  });
});

describe('content tiles (P10-B): resolved on the server, empty ones dropped for non-managers', () => {
  const PATH = `org-media/${SITE}/photo-1.jpg`;
  it('resolveTile: text through the strict parser, image through the streamer URL, embed through the structure', () => {
    expect(resolveTile(place('text', 0, 0, undefined, { config: { blocks: [{ type: 'paragraph', text: 'Hi' }, { type: 'paragraph', text: '' }] } }), SITE)).toEqual({ kind: 'text', blocks: [{ type: 'paragraph', text: 'Hi' }] });
    expect(resolveTile(place('text', 0, 0, undefined, { config: { blocks: [{ type: 'paragraph', text: '' }] } }), SITE)).toBeNull();
    const img = resolveTile(place('image', 0, 0, undefined, { config: { path: PATH, alt: 'Tee', caption: ' Day one ', href: 'https://example.com', width: 800, height: 600 } }), SITE);
    expect(img).toMatchObject({ kind: 'image', alt: 'Tee', caption: 'Day one', href: 'https://example.com', width: 800, height: 600 });
    expect((img as { src: string }).src).toContain(SITE);
    // A path outside THIS site's prefix streams nothing → empty; an http link is dropped.
    expect(resolveTile(place('image', 0, 0, undefined, { config: { path: 'org-media/00000000-0000-4000-8000-000000000000/x.jpg' } }), SITE)).toBeNull();
    expect((resolveTile(place('image', 0, 0, undefined, { config: { path: PATH, href: 'http://example.com' } }), SITE) as { href: string | null }).href).toBeNull();
    expect(resolveTile(place('embed', 0, 0, undefined, { config: { embed: { provider: 'youtube', id: 'dQw4w9WgXcQ' } } }), SITE)).toEqual({ kind: 'embed', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', title: 'YouTube video', provider: 'youtube' });
    expect(resolveTile(place('embed', 0, 0, undefined, { config: { embed: 'https://youtu.be/dQw4w9WgXcQ' } }), SITE)).toBeNull();
  });
  it('the composition carries resolved tiles; an empty tile reaches managers only; a members-only tile obeys the viewer', () => {
    const layout: SiteLayout = {
      version: 1,
      cols: 12,
      widgets: [
        place('standings', 0, 0),
        place('text', 0, 4, undefined, { id: 'full', config: { blocks: [{ type: 'paragraph', text: 'Hello' }] } }),
        place('text', 6, 4, undefined, { id: 'blank', config: { blocks: [] } }),
        place('embed', 0, 8, undefined, { id: 'mem', visibility: 'members', config: { embed: { provider: 'vimeo', id: '123456789' } } }),
      ],
    };
    expect(buildAppComposition(layout, SITE, ANON)!.widgets.map(w => w.id)).toEqual(['seed:standings', 'full']);
    expect(buildAppComposition(layout, SITE, MEMBER)!.widgets.map(w => w.id)).toEqual(['seed:standings', 'full', 'mem']);
    const manager = buildAppComposition(layout, SITE, MANAGER)!.widgets;
    expect(manager.map(w => w.id)).toEqual(['seed:standings', 'full', 'blank', 'mem']);
    expect(manager.find(w => w.id === 'full')!.tile).toEqual({ kind: 'text', blocks: [{ type: 'paragraph', text: 'Hello' }] });
    expect(manager.find(w => w.id === 'blank')!.tile).toBeUndefined();
    expect(manager.find(w => w.id === 'mem')!.tile).toMatchObject({ kind: 'embed', provider: 'vimeo' });
  });
  it('in the interleave a tile is a slot with a null bubble key that inherits its neighbour’s anchor; the registry order never lists tiles', () => {
    const comp = { widgets: [
      { id: 's', key: 'standings' as const, w: 12, title: null, visibility: 'public' as const },
      { id: 't', key: 'text' as const, w: 6, title: 'Notes', visibility: 'public' as const, tile: { kind: 'text' as const, blocks: [] } },
      { id: 'm', key: 'members' as const, w: 12, title: null, visibility: 'public' as const },
    ] };
    const out = deriveAppLayout(comp);
    // week(20) goes before standings(30); the tile sticks to standings (anchor 30 < 60), announcements(60) after members.
    expect(out.map(s => s.instanceId ?? s.key)).toEqual(['week', 's', 't', 'm', 'announcements', 'activity', 'gallery', 'posts']);
    expect(out.find(s => s.instanceId === 't')).toMatchObject({ bubbleKey: null, span: 'md', title: 'Notes' });
    expect(deriveAppLayout().some(s => s.bubbleKey === null)).toBe(false);
  });
});

describe('deriveAppLayout(composition) — the interleave', () => {
  const comp = (keys: string[]) => ({ widgets: keys.map((k, i) => ({ id: `i${i}`, key: k as never, w: 12, title: null, visibility: 'public' as const })) });
  const keys = (c: Parameters<typeof deriveAppLayout>[0]) => deriveAppLayout(c).map(s => s.key);

  it('no composition (null / undefined) is the registry order; an empty one is the app-only + pinned set in registry order', () => {
    const registry = keys(undefined);
    expect(keys(null)).toEqual(registry);
    expect(keys({ widgets: [] })).toEqual(['members', 'week', 'announcements', 'activity', 'gallery', 'posts']);
  });

  it('the layout’s order drives the module bubbles; app-only widgets slot in at their priority; posts is last', () => {
    // standings(30) then members(10): week(20) goes before the first anchor > 20 — standings.
    expect(keys(comp(['standings', 'members']))).toEqual(['week', 'standings', 'members', 'announcements', 'activity', 'gallery', 'posts']);
    // members first: week sits between members(10) and standings(30) — today's order.
    expect(keys(comp(['members', 'standings']))).toEqual(['members', 'week', 'standings', 'announcements', 'activity', 'gallery', 'posts']);
    // A long composition: posts still last, every present module once, missing unpinned modules dropped.
    const out = keys(comp(['news', 'affiliations', 'venues', 'schedule', 'standings', 'gallery']));
    expect(out[out.length - 1]).toBe('posts');
    expect(out.filter(k => k === 'standings')).toHaveLength(1);
    expect(out).not.toContain('teams');
    expect(out.indexOf('news')).toBeLessThan(out.indexOf('standings'));
  });

  it('a module absent from the composition is dropped unless pinned; pinned ones appear at their priority', () => {
    const out = keys(comp(['standings']));
    expect(out).toEqual(['members', 'week', 'standings', 'announcements', 'activity', 'gallery', 'posts']);
    expect(out).not.toContain('schedule');
  });

  it('carries the instance id and title; registry-placed slots carry neither', () => {
    const slots = deriveAppLayout({ widgets: [{ id: 'x1', key: 'standings', w: 6, title: 'Div 1', visibility: 'public' }] });
    const standings = slots.find(s => s.key === 'standings')!;
    expect(standings).toMatchObject({ instanceId: 'x1', title: 'Div 1', span: 'md', bubbleKey: 'standings' });
    expect(slots.find(s => s.key === 'week')).toMatchObject({ instanceId: null, title: null });
  });
});
