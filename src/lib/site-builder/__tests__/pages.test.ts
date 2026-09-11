import { describe, expect, it } from 'vitest';
import { parseStoredLayout } from '../layout-schema';
import { validateLayout } from '../layout';
import { blankPageLayout, blocksFromPageLayout, mintPageSlug, orderedPages, pageLayoutFromBody, parsePageLayout, parseSnapshotPages, sweepModuleFromPages, validatePageLayout, PAGE_WIDGETS_MAX } from '../pages';

// Program 2, B (Sep 11 2026): the pure page core — a legacy body converts
// losslessly and deterministically; a page layout obeys the home rules plus
// the page ones; slugs mint like the server used to.

const SITE = '11111111-1111-4111-8111-111111111111';
const PAGE = '2f1b46c8-2964-4139-9689-d1c3f736ed93';
const IMG = `org-media/${SITE}/photo.jpg`;
const PDF = `org-media/${SITE}/rules.pdf`;

const body = [
  { type: 'heading', text: 'About us' },
  { type: 'paragraph', text: 'We play on Tuesdays.' },
  { type: 'image', path: IMG, alt: 'The green', width: 1200, height: 800 },
  { type: 'link-list', links: [{ label: 'Rules', url: 'https://example.com/rules' }] },
  { type: 'image', path: PDF, alt: 'A document path stays a block' },
  { type: 'paragraph', text: 'See you there.' },
];

describe('pageLayoutFromBody', () => {
  it('converts runs of blocks into text sections and site images into image sections — lossless and deterministic', () => {
    const layout = pageLayoutFromBody(PAGE, body);
    expect(layout.widgets.map(w => `${w.id}:${w.key}`)).toEqual([`legacy:page:${PAGE}:0:text`, `legacy:page:${PAGE}:1:image`, `legacy:page:${PAGE}:2:text`]);
    expect(layout.widgets.every(w => w.x === 0 && w.w === 12)).toBe(true);
    expect(validatePageLayout(layout)).toEqual([]);
    expect(parsePageLayout(layout)).not.toBeNull();
    // The image section carries the measured size; the pdf stayed inside a text block.
    expect(layout.widgets[1].config).toMatchObject({ path: IMG, alt: 'The green', width: 1200, height: 800 });
    expect((layout.widgets[2].config as { blocks: unknown[] }).blocks).toHaveLength(3);
    // The inverse gives the original blocks back, in order.
    expect(blocksFromPageLayout(layout)).toEqual(body);
    // Deterministic: two materialisations are byte-equal.
    expect(JSON.stringify(pageLayoutFromBody(PAGE, body))).toBe(JSON.stringify(layout));
  });
  it('splits a long run at the text widget cap and fits a 40-block page', () => {
    const forty = Array.from({ length: 40 }, (_, i) => ({ type: 'paragraph', text: `Paragraph ${i}` }));
    const layout = pageLayoutFromBody(PAGE, forty);
    expect(layout.widgets).toHaveLength(4); // 12 + 12 + 12 + 4
    expect(layout.widgets.length).toBeLessThanOrEqual(PAGE_WIDGETS_MAX);
    expect(blocksFromPageLayout(layout)).toEqual(forty);
    expect(validateLayout(layout)).toEqual([]);
  });
  it('an empty or junk body becomes the blank page (one empty text section); junk blocks are dropped', () => {
    expect(pageLayoutFromBody(PAGE, [])).toEqual(blankPageLayout(PAGE));
    expect(pageLayoutFromBody(PAGE, 'nope')).toEqual(blankPageLayout(PAGE));
    const layout = pageLayoutFromBody(PAGE, [{ type: 'bogus' }, { type: 'paragraph', text: 'ok' }]);
    expect(blocksFromPageLayout(layout)).toEqual([{ type: 'paragraph', text: 'ok' }]);
  });
});

describe('validatePageLayout / parsePageLayout', () => {
  it('refuses the hero, an app-only key, and more than the page cap; accepts module widgets', () => {
    const base = blankPageLayout(PAGE);
    const withHero = { ...base, widgets: [...base.widgets, { id: 'h', key: 'hero', x: 0, y: 10, w: 12, h: 3, cv: 1, config: {}, visibility: 'public' as const }] };
    expect(validatePageLayout(withHero as never).map(i => i.message)).toContain('The hero belongs to the home page');
    expect(parsePageLayout(withHero)).toBeNull();
    const withStandings = { ...base, widgets: [...base.widgets, { id: 's', key: 'standings', x: 0, y: 10, w: 12, h: 4, cv: 1, config: {}, visibility: 'public' as const }] };
    expect(validatePageLayout(withStandings as never)).toEqual([]);
    expect(parsePageLayout(withStandings)).not.toBeNull();
    const tooMany = { ...base, widgets: Array.from({ length: PAGE_WIDGETS_MAX + 1 }, (_, i) => ({ id: `t${i}`, key: 'text', x: 0, y: i * 3, w: 12, h: 3, cv: 1, config: {}, visibility: 'public' as const })) };
    expect(validatePageLayout(tooMany as never).some(i => i.message.includes('at most'))).toBe(true);
    expect(parseStoredLayout(tooMany)).not.toBeNull(); // the home cap is 60 — the PAGE rule is the stricter one
    expect(parsePageLayout(tooMany)).toBeNull();
  });
});

describe('mintPageSlug', () => {
  it('mints from the title, steps -2..-20 past taken slugs, honours a wanted slug, refuses reserved ones', () => {
    expect(mintPageSlug('About Us!', new Set())).toBe('about-us');
    expect(mintPageSlug('About Us', new Set(['about-us']))).toBe('about-us-2');
    expect(mintPageSlug('About Us', new Set(['about-us', 'about-us-2']))).toBe('about-us-3');
    expect(mintPageSlug('Standings', new Set())).toBe('standings-2'); // 'standings' is a module (reserved)
    expect(mintPageSlug('', new Set())).toBe('page');
    expect(mintPageSlug('Whatever', new Set(), 'custom')).toBe('custom');
    expect(mintPageSlug('Whatever', new Set(['custom']), 'custom')).toBeNull();
    expect(mintPageSlug('Whatever', new Set(), 'api')).toBeNull();
    const all = new Set(['about', ...Array.from({ length: 19 }, (_, i) => `about-${i + 2}`)]);
    expect(mintPageSlug('About', all)).toBeNull();
  });
});

describe('parseSnapshotPages / orderedPages / sweepModuleFromPages', () => {
  it('reads a stored map leniently and orders by creation time', () => {
    const pages = parseSnapshotPages({
      b: { slug: 'b', title: 'B', createdAt: '2026-09-11T10:00:00Z', visibility: 'draft', inNav: false, layout: blankPageLayout('b') },
      a: { slug: 'a', title: 'A', createdAt: '2026-09-11T09:00:00Z' },
      junk: { title: 'no slug' },
      also: 'nope',
    });
    expect(Object.keys(pages).sort()).toEqual(['a', 'b']);
    expect(pages.a).toMatchObject({ id: 'a', visibility: 'public', inNav: true, layout: null });
    expect(pages.b).toMatchObject({ visibility: 'draft', inNav: false });
    expect(orderedPages(pages).map(p => p.id)).toEqual(['a', 'b']);
  });
  it('sweeps a disabled module off every page layout and returns the same object when nothing changes', () => {
    const base = blankPageLayout(PAGE);
    const layout = { ...base, widgets: [...base.widgets, { id: 's', key: 'standings', x: 0, y: 10, w: 12, h: 4, cv: 1, config: {}, visibility: 'public' as const }] };
    const pages = { [PAGE]: { id: PAGE, slug: 'about', title: 'About', visibility: 'public' as const, inNav: true, createdAt: '2026-09-11T09:00:00Z', layout } };
    const swept = sweepModuleFromPages(pages, 'standings');
    expect((swept[PAGE].layout as { widgets: { key: string }[] }).widgets.map(w => w.key)).toEqual(['text']);
    expect(sweepModuleFromPages(pages, 'news')).toBe(pages);
    expect(sweepModuleFromPages(pages, 'not-a-key')).toBe(pages);
  });
});
