import { describe, expect, it } from 'vitest';
import { MODULE_KEYS } from '@/lib/org-sites/validate';
import { CONTENT_WIDGET_KEYS, QUERY_WIDGET_KEYS, SITE_WIDGET_KEYS, WEB_WIDGET_KEYS, WIDGETS, isContentWidgetKey, isSiteWidgetKey, isWebWidgetKey } from '../catalog';
import { isWidgetEmpty } from '../emptiness';
import { LayoutSchema, parseStoredLayout } from '../layout-schema';
import { appendWidget, newInstanceFor, validateLayout, type SiteLayout, type WidgetInstance } from '../layout';
import { EmbedWidgetSchema, ImageWidgetSchema, InstanceOptionsSchema, TEXT_WIDGET_BLOCKS_MAX, TextWidgetSchema, instanceImagePaths, instanceSchemaFor } from '../schemas';
import type { SiteHomeData } from '@/lib/org-sites/home-data';

// Phase 6: text, image and embed are widgets with no module behind them.
// Their content rides the layout INSTANCE — under the publish gate with the
// placement — so the wire schema, the per-instance validation, emptiness
// and the catalog pins all have to know them.

const SITE_ID = '0f1e2d3c-4b5a-4978-8f6e-5d4c3b2a1908';
const PATH = `org-media/${SITE_ID}/photo-1.jpg`;
const site = { modules: [], hero_config: {}, contact_config: {}, visibility: 'public' as const };
const EMPTY_DATA: SiteHomeData = {
  standings: null, events: null, teams: [], staff: [], venues: [], affiliations: [], openWindows: [], courses: [], divisions: [], leaders: [],
  clubGolfBoards: [], courseStrip: null, golfRounds: [], news: [], memberStats: null,
};
const inst = (key: WidgetInstance['key'], config: unknown, id = `w_${key}`): WidgetInstance => ({ ...newInstanceFor(site, key, id), config });

describe('content widgets — the catalog', () => {
  it('are a third key set: not modules, both surfaces (in-app as tiles), multiple, heading-optional, with a name', () => {
    expect([...SITE_WIDGET_KEYS]).toEqual([...WEB_WIDGET_KEYS, ...CONTENT_WIDGET_KEYS]);
    for (const key of CONTENT_WIDGET_KEYS) {
      expect((MODULE_KEYS as readonly string[]).includes(key), key).toBe(false);
      const def = WIDGETS[key];
      expect(def.moduleKey, key).toBeNull();
      expect(def.family, key).toBe('content');
      // Phase 10: both surfaces — in-app as a TILE (no bubble, no window).
      expect(def.surfaces.default, key).toEqual(['web', 'app']);
      expect(def.surfaces.app?.bubbleKey, key).toBeNull();
      expect(def.surfaces.app?.ownsWindow, key).toBeUndefined();
      expect(def.subpage, key).toBe(false);
      expect(def.data, key).toEqual([]);
      expect(def.multiple, key).toBe(true);
      expect(def.headingOptional, key).toBe(true);
      expect(def.defaultTitle, key).toBeTruthy();
      expect(def.emptyState?.public, key).toBe('hide');
    }
    // Module widgets always head themselves; only the QUERY widgets (phase 9)
    // may repeat — each instance bound to its own competition / venue.
    for (const key of WEB_WIDGET_KEYS) {
      expect(WIDGETS[key].multiple, key).toBe((QUERY_WIDGET_KEYS as readonly string[]).includes(key) ? true : undefined);
      expect(WIDGETS[key].headingOptional, key).toBeUndefined();
    }
    expect([...QUERY_WIDGET_KEYS]).toEqual(['standings', 'schedule', 'leaders']);
  });

  it('type guards tell the three sets apart', () => {
    expect(isContentWidgetKey('text')).toBe(true);
    expect(isContentWidgetKey('staff')).toBe(false);
    expect(isSiteWidgetKey('text')).toBe(true);
    expect(isSiteWidgetKey('staff')).toBe(true);
    expect(isSiteWidgetKey('week')).toBe(false);
    expect(isWebWidgetKey('text')).toBe(false);
  });
});

describe('content widgets — the wire schema', () => {
  const base: SiteLayout = { version: 1, cols: 12, widgets: [] };

  it('accepts content keys on a layout, twice, and the geometry rules still hold', () => {
    const layout = appendWidget(appendWidget(base, inst('text', { blocks: [] }, 'w_1')), inst('text', {}, 'w_2'));
    expect(LayoutSchema.safeParse(layout).success).toBe(true);
    expect(parseStoredLayout(layout)?.widgets.map(w => w.key)).toEqual(['text', 'text']);
    expect(validateLayout(layout)).toEqual([]);
    // Constraints bite: an embed narrower than its minimum.
    const narrow = { ...base, widgets: [{ ...inst('embed', {}), w: 4 }] };
    expect(validateLayout(narrow).map(i => i.message)).toEqual(['embed must be 6–12 columns wide']);
  });

  it('still refuses app-only keys', () => {
    expect(LayoutSchema.safeParse({ ...base, widgets: [{ ...inst('text', {}), key: 'week' }] }).success).toBe(false);
  });
});

describe('content widgets — per-instance config schemas', () => {
  it('instanceSchemaFor: options only for module widgets, options + content for content widgets', () => {
    expect(instanceSchemaFor('staff')).toBe(InstanceOptionsSchema);
    expect(instanceSchemaFor('hero')).toBe(InstanceOptionsSchema);
    expect(instanceSchemaFor('text')).toBe(TextWidgetSchema);
    expect(instanceSchemaFor('image')).toBe(ImageWidgetSchema);
    expect(instanceSchemaFor('embed')).toBe(EmbedWidgetSchema);
  });

  it('text: the page block vocabulary (stored leniently — a block being typed may be empty), capped, title still allowed, unknown keys kept', () => {
    const ok = TextWidgetSchema.safeParse({ title: 'About us', blocks: [{ type: 'heading', text: 'Hi' }, { type: 'paragraph', text: 'Welcome.' }], legacy: 1 });
    expect(ok.success).toBe(true);
    if (ok.success) expect((ok.data as Record<string, unknown>).legacy).toBe(1);
    expect(TextWidgetSchema.safeParse({ blocks: [{ type: 'paragraph', text: '' }, { type: 'link-list', links: [{ label: '', url: 'https://exa' }] }] }).success).toBe(true);
    expect(TextWidgetSchema.safeParse({ blocks: [{ type: 'paragraph', text: 'x'.repeat(2001) }] }).success).toBe(false);
    expect(TextWidgetSchema.safeParse({ blocks: [{ type: 'html', html: '<b>' }] }).success).toBe(false);
    expect(TextWidgetSchema.safeParse({ blocks: Array.from({ length: TEXT_WIDGET_BLOCKS_MAX + 1 }, () => ({ type: 'paragraph', text: 'x' })) }).success).toBe(false);
    expect(TextWidgetSchema.safeParse({ title: 'x'.repeat(61) }).success).toBe(false);
  });

  it('image: a site image path, alt/caption caps, https link, measured size', () => {
    expect(ImageWidgetSchema.safeParse({ path: PATH, alt: 'The first tee', caption: 'Opening day', href: 'https://example.com', width: 1600, height: 900 }).success).toBe(true);
    expect(ImageWidgetSchema.safeParse({ path: `org-media/${SITE_ID}/policy.pdf` }).success).toBe(false);
    expect(ImageWidgetSchema.safeParse({ path: 'https://example.com/x.jpg' }).success).toBe(false);
    // The link is STORED as typed (a half-typed address must not fail the
    // autosave); the renderer shows it only once it is https://.
    expect(ImageWidgetSchema.safeParse({ path: PATH, href: 'http://exa' }).success).toBe(true);
    expect(ImageWidgetSchema.safeParse({ path: PATH, href: 'x'.repeat(201) }).success).toBe(false);
    expect(ImageWidgetSchema.safeParse({ path: PATH, caption: 'x'.repeat(201) }).success).toBe(false);
    expect(ImageWidgetSchema.safeParse({ path: PATH, width: 0 }).success).toBe(false);
  });

  it('embed: the structure, never a URL', () => {
    expect(EmbedWidgetSchema.safeParse({ embed: { provider: 'youtube', id: 'dQw4w9WgXcQ' } }).success).toBe(true);
    expect(EmbedWidgetSchema.safeParse({ embed: { provider: 'vimeo', id: '123456789' } }).success).toBe(true);
    expect(EmbedWidgetSchema.safeParse({ embed: { provider: 'osm', bbox: [-0.13, 51.5, -0.11, 51.51], marker: [51.505, -0.12] } }).success).toBe(true);
    expect(EmbedWidgetSchema.safeParse({ embed: { provider: 'youtube', id: 'x' } }).success).toBe(false);
    expect(EmbedWidgetSchema.safeParse({ embed: { provider: 'gmaps', src: 'https://maps.google.com/embed' } }).success).toBe(false);
    expect(EmbedWidgetSchema.safeParse({ embed: { provider: 'osm', bbox: [0, 0, 1] } }).success).toBe(false);
    expect(EmbedWidgetSchema.safeParse({ embed: 'https://youtu.be/dQw4w9WgXcQ' }).success).toBe(false);
  });

  it('instanceImagePaths: the image widget’s photo and a text widget’s image blocks (for the site-prefix check)', () => {
    expect(instanceImagePaths('image', { path: PATH })).toEqual([PATH]);
    expect(instanceImagePaths('image', {})).toEqual([]);
    expect(instanceImagePaths('text', { blocks: [{ type: 'paragraph', text: 'x' }, { type: 'image', path: PATH, alt: 'a' }] })).toEqual([PATH]);
    expect(instanceImagePaths('staff', { title: 'x' })).toEqual([]);
  });
});

describe('content widgets — empty never renders publicly', () => {
  it('text is empty until a block parses; image until it has a path; embed until the structure parses', () => {
    expect(isWidgetEmpty(inst('text', {}), EMPTY_DATA, site)).toBe(true);
    expect(isWidgetEmpty(inst('text', { blocks: [{ type: 'paragraph', text: '' }] }), EMPTY_DATA, site)).toBe(true);
    expect(isWidgetEmpty(inst('text', { blocks: [{ type: 'paragraph', text: 'Welcome.' }] }), EMPTY_DATA, site)).toBe(false);
    expect(isWidgetEmpty(inst('image', { alt: 'x' }), EMPTY_DATA, site)).toBe(true);
    expect(isWidgetEmpty(inst('image', { path: PATH }), EMPTY_DATA, site)).toBe(false);
    expect(isWidgetEmpty(inst('embed', {}), EMPTY_DATA, site)).toBe(true);
    expect(isWidgetEmpty(inst('embed', { embed: { provider: 'youtube', id: 'bad' } }), EMPTY_DATA, site)).toBe(true);
    expect(isWidgetEmpty(inst('embed', { embed: { provider: 'youtube', id: 'dQw4w9WgXcQ' } }), EMPTY_DATA, site)).toBe(false);
  });

  it('a members-only content tile is never empty (its panel is the content)', () => {
    expect(isWidgetEmpty({ ...inst('text', {}), visibility: 'members' }, EMPTY_DATA, site)).toBe(false);
  });
});
