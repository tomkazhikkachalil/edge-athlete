import { describe, expect, it } from 'vitest';
import { SitePatchSchema } from '@/lib/org-sites/validate';
import {
  applySiteAction,
  canonicalJson,
  diffModuleRows,
  overlaySnapshot,
  parseSnapshot,
  rowsFromSnapshot,
  selectRevisionsToPrune,
  snapshotFromRows,
  snapshotsEqual,
  type SiteSnapshot,
  type SnapshotAction,
  type SnapshotModuleRow,
  type SnapshotSiteRow,
} from '../snapshot';
import { seedLayout } from '../seeds';
import { validateLayout } from '../layout';
import { parseStoredLayout } from '../layout-schema';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const COURSE = '22222222-2222-4222-8222-222222222222';
const MEDIA = (n: number) => `33333333-3333-4333-8333-33333333333${n}`;
const IMG = `org-media/${SITE_ID}/hero.jpg`;

const siteRow: SnapshotSiteRow = {
  template_id: 'bold',
  theme_token_set: { accent: '#0f766e', wordmark: 'Proof' },
  nav_config: [{ key: 'standings', label: 'Table' }, { key: 'news' }],
  hero_config: { headline: 'Welcome' },
  contact_config: { email: 'x@example.com' },
};
const rows: SnapshotModuleRow[] = [
  { module_key: 'hero', enabled: true, sort_order: 0, config: {} },
  { module_key: 'standings', enabled: true, sort_order: 1, config: {} },
  { module_key: 'news', enabled: true, sort_order: 2, config: null },
  { module_key: 'sponsors', enabled: false, sort_order: 7, config: { sponsors: [{ name: 'Acme' }] } },
];
const ctx = { side: 'league' as const, sportKey: null };
// Console payloads go through the PATCH schema (optionalTrimmed keys are
// present-but-undefined after parse — the type the server hands the lib).
const patch = (raw: unknown) => SitePatchSchema.parse(raw) as SnapshotAction;
const base = () => snapshotFromRows(siteRow, rows);

describe('snapshot ⇄ rows', () => {
  it('round-trips byte-faithfully (null config becomes {})', () => {
    const s = base();
    const back = rowsFromSnapshot(s);
    // Program 2, C: the mirror always names the two 186 columns (empty when unset).
    expect(back.site).toEqual({ ...siteRow, seo_config: {}, footer_config: {} });
    expect(back.modules).toEqual([
      { module_key: 'hero', enabled: true, sort_order: 0, config: {} },
      { module_key: 'standings', enabled: true, sort_order: 1, config: {} },
      { module_key: 'news', enabled: true, sort_order: 2, config: {} },
      { module_key: 'sponsors', enabled: false, sort_order: 7, config: { sponsors: [{ name: 'Acme' }] } },
    ]);
    expect(snapshotsEqual(s, snapshotFromRows(back.site, back.modules))).toBe(true);
  });

  it('snapshotsEqual ignores key order and undefined, and sees a one-field change', () => {
    const a = base();
    const reordered = JSON.parse(canonicalJson(a)) as SiteSnapshot;
    expect(snapshotsEqual(a, reordered)).toBe(true);
    expect(canonicalJson({ b: 1, a: { d: 2, c: undefined } })).toBe('{"a":{"d":2},"b":1}');
    expect(snapshotsEqual(a, { ...a, hero: { headline: 'Changed' } })).toBe(false);
  });

  it('parseSnapshot accepts a stored snapshot, rejects garbage and the wrong version, keeps layout', () => {
    const s = { ...base(), layout: { version: 1, cols: 12, widgets: [] } };
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(s)));
    expect(parsed).not.toBeNull();
    expect(snapshotsEqual(parsed!, s)).toBe(true);
    expect(parsed!.layout).toEqual({ version: 1, cols: 12, widgets: [] });
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('x')).toBeNull();
    expect(parseSnapshot({ v: 2, templateId: 'classic' })).toBeNull();
    expect(parseSnapshot({ v: 1 })).toBeNull();
    // Malformed module entries degrade, never throw.
    const loose = parseSnapshot({ v: 1, templateId: 'classic', modules: { news: 'nope', hero: { enabled: 1, sortOrder: 'x' } } });
    expect(loose!.modules.news).toEqual({ enabled: false, sortOrder: 0, config: {} });
    expect(loose!.modules.hero).toEqual({ enabled: true, sortOrder: 0, config: {} });
  });

  it('B1: diffModuleRows turns OFF a key the next snapshot lacks (a restore from before the module existed)', () => {
    const a = base();
    const withoutStandings = { ...a, modules: Object.fromEntries(Object.entries(a.modules).filter(([k]) => k !== 'standings')) };
    const rows = diffModuleRows(a, withoutStandings);
    expect(rows.find(r => r.module_key === 'standings')).toMatchObject({ enabled: false, sort_order: a.modules.standings.sortOrder });
    // A key that was already off and is absent adds nothing.
    const offBefore = { ...a, modules: { ...a.modules, standings: { ...a.modules.standings, enabled: false } } };
    expect(diffModuleRows(offBefore, withoutStandings).some(r => r.module_key === 'standings')).toBe(false);
  });

  it('diffModuleRows returns only changed rows, or every row when prev is null', () => {
    const a = base();
    expect(diffModuleRows(null, a)).toHaveLength(4);
    const b = applySiteAction(a, { action: 'set_module', moduleKey: 'sponsors', enabled: true }, ctx);
    expect(diffModuleRows(a, b).map(r => r.module_key)).toEqual(['sponsors']);
    const c = applySiteAction(a, { action: 'set_module', moduleKey: 'teams', enabled: true }, ctx);
    expect(diffModuleRows(a, c).map(r => r.module_key)).toEqual(['teams']);
    expect(diffModuleRows(a, a)).toEqual([]);
  });

  it('overlaySnapshot rebuilds the site row fields and the ordered modules', () => {
    const s = applySiteAction(base(), { action: 'set_template', templateId: 'classic' }, ctx);
    const site = { ...siteRow, id: SITE_ID, published_at: 'TS', logo_path: 'org-logos/x.png', modules: rows };
    const overlaid = overlaySnapshot(site, s);
    expect(overlaid.template_id).toBe('classic');
    expect(overlaid.published_at).toBe('TS');
    expect(overlaid.logo_path).toBe('org-logos/x.png');
    expect(overlaid.modules.map(m => m.module_key)).toEqual(['hero', 'standings', 'news', 'sponsors']);
  });
});

describe('applySiteAction', () => {
  it('set_module toggles, and self-heals a missing row at its default position', () => {
    const s = applySiteAction(base(), { action: 'set_module', moduleKey: 'teams', enabled: true }, ctx);
    expect(s.modules.teams).toEqual({ enabled: true, sortOrder: 3, config: {} });
    const off = applySiteAction(s, { action: 'set_module', moduleKey: 'teams', enabled: false }, ctx);
    expect(off.modules.teams.enabled).toBe(false);
    expect(off.modules.teams.sortOrder).toBe(3);
  });

  it('set_nav mirrors i+1 into sortOrder for listed keys and keeps unlisted ones; dedupes keys', () => {
    const s = applySiteAction(
      base(),
      patch({ action: 'set_nav', items: [{ key: 'news', label: 'Latest' }, { key: 'standings' }, { key: 'news' }] }),
      ctx
    );
    expect(s.nav).toEqual([{ key: 'news', label: 'Latest' }, { key: 'standings' }]);
    expect(s.modules.news.sortOrder).toBe(1);
    expect(s.modules.standings.sortOrder).toBe(2);
    expect(s.modules.sponsors.sortOrder).toBe(7);
    expect(s.modules.hero.sortOrder).toBe(0);
  });

  it('reset_order restores the recommended order (sport-aware) and keeps labels only', () => {
    const s = applySiteAction(base(), { action: 'reset_order' }, ctx);
    expect(s.modules.hero.sortOrder).toBe(0);
    expect(s.modules.standings.sortOrder).toBe(1); // league default: hero, standings, schedule, teams…
    expect(s.nav).toEqual([{ key: 'standings', label: 'Table' }]);
    const golf = applySiteAction(base(), { action: 'reset_order' }, { side: 'club', sportKey: 'golf' });
    expect(golf.modules.standings.sortOrder).toBe(1); // golf club: hero, standings, leaders, …
    expect(golf.modules.news.sortOrder).toBe(5);
  });

  it('H4: set_module governs the TILE on a stored layout — off removes every instance (compacted), on appends one legacy-id instance once; no stored layout → rows only', () => {
    const noLayout = applySiteAction(base(), patch({ action: 'set_module', moduleKey: 'standings', enabled: false }), ctx);
    expect(noLayout.modules.standings.enabled).toBe(false);
    expect(noLayout.layout).toBeUndefined();

    let s = base();
    const stack = seedLayout({ template_id: 'classic', hero_config: {}, contact_config: {}, visibility: 'public', modules: Object.entries(s.modules).map(([module_key, m]) => ({ module_key, enabled: m.enabled, sort_order: m.sortOrder, config: m.config })) });
    const second = { id: 'std_2', key: 'standings' as const, x: 0, y: 90, w: 12, h: 4, cv: 1, config: { title: 'Div 2' }, visibility: 'public' as const };
    s = { ...s, layout: { ...stack, widgets: [...stack.widgets, second] } };
    expect(parseStoredLayout(s.layout)!.widgets.filter(w => w.key === 'standings')).toHaveLength(2);

    const off = applySiteAction(s, patch({ action: 'set_module', moduleKey: 'standings', enabled: false }), ctx);
    const offLayout = parseStoredLayout(off.layout)!;
    expect(off.modules.standings.enabled).toBe(false);
    expect(offLayout.widgets.some(w => w.key === 'standings')).toBe(false);
    expect(validateLayout(offLayout)).toEqual([]);
    // Compacted: news moved up into standings' rows.
    expect(offLayout.widgets.find(w => w.key === 'news')!.y).toBeLessThan(parseStoredLayout(s.layout)!.widgets.find(w => w.key === 'news')!.y);

    const on = applySiteAction(off, patch({ action: 'set_module', moduleKey: 'standings', enabled: true }), ctx);
    const onLayout = parseStoredLayout(on.layout)!;
    expect(onLayout.widgets.filter(w => w.key === 'standings').map(w => w.id)).toEqual(['legacy:standings']);
    expect(validateLayout(onLayout)).toEqual([]);
    // Already present → the layout is untouched (no second instance).
    const again = applySiteAction(on, patch({ action: 'set_module', moduleKey: 'standings', enabled: true }), ctx);
    expect(parseStoredLayout(again.layout)!.widgets.filter(w => w.key === 'standings')).toHaveLength(1);
    // A module with no instance and no row yet: enabling appends one (self-healed row + tile).
    const teams = applySiteAction(on, patch({ action: 'set_module', moduleKey: 'teams', enabled: true }), ctx);
    expect(parseStoredLayout(teams.layout)!.widgets.filter(w => w.key === 'teams').map(w => w.id)).toEqual(['legacy:teams']);
  });

  it('H4: apply_gallery never writes a layout the readers refuse — past the cap the tail is trimmed; an unfixable result leaves the snapshot unchanged', () => {
    let s = base();
    const stack = seedLayout({ template_id: 'classic', hero_config: {}, contact_config: {}, visibility: 'public', modules: Object.entries(s.modules).map(([module_key, m]) => ({ module_key, enabled: m.enabled, sort_order: m.sortOrder, config: m.config })) });
    const filler = Array.from({ length: 60 - stack.widgets.length }, (_, i) => ({ id: `f${i}`, key: 'text' as const, x: 0, y: 100 + i * 2, w: 12, h: 2, cv: 1, config: { blocks: [{ type: 'paragraph', text: `f${i}` }] }, visibility: 'public' as const }));
    s = { ...s, layout: { ...stack, widgets: [...stack.widgets, ...filler] } };
    expect(parseStoredLayout(s.layout)!.widgets).toHaveLength(60);
    const org = { orgName: 'Kanata Golf', city: 'Kanata', region: 'ON', venues: [{ id: 'v', name: 'Loch March', lat: 45.3, lng: -75.9 }] };
    const out = applySiteAction(s, patch({ action: 'apply_gallery', entryId: 'golf-tour' }), { ...ctx, sportKey: 'golf', gallery: org });
    const layout = parseStoredLayout(out.layout);
    expect(layout).not.toBeNull();
    expect(layout!.widgets.length).toBeLessThanOrEqual(60);
    expect(layout!.widgets.some(w => w.id === 'seed:welcome')).toBe(true);
    expect(out.templateId).toBe('bold');
  });

  it('phase 11: apply_gallery — family + tokens over a stripped design set; the layout re-laid; content generated; nothing destroyed in keep mode', () => {
    let s = base();
    s = applySiteAction(s, patch({ action: 'set_theme', accent: '#0f766e', typeface: 'lora', header: 'band', wordmark: 'W' }), ctx);
    // A manager's own text tile on a stored layout.
    const stack = seedLayout({ template_id: 'classic', hero_config: {}, contact_config: {}, visibility: 'public', modules: Object.entries(s.modules).map(([module_key, m]) => ({ module_key, enabled: m.enabled, sort_order: m.sortOrder, config: m.config })) });
    s = { ...s, layout: { ...stack, widgets: [...stack.widgets.map(w => (w.key === 'standings' ? { ...w, config: { title: 'Table' } } : w)), { id: 'w_mine', key: 'text' as const, x: 0, y: 99, w: 6, h: 3, cv: 1, config: { blocks: [{ type: 'paragraph', text: 'Mine' }] }, visibility: 'public' as const }] } };
    const org = { orgName: 'Kanata Golf', city: 'Kanata', region: 'ON', venues: [{ id: 'v', name: 'Loch March', lat: 45.3, lng: -75.9 }] };
    s = applySiteAction(s, patch({ action: 'apply_gallery', entryId: 'golf-tour' }), { ...ctx, sportKey: 'golf', gallery: org });
    expect(s.templateId).toBe('bold');
    // Design keys stripped then the entry's landed; colours + wordmark kept; typeface replaced (the entry names one).
    expect(s.theme).toEqual({ accent: '#0f766e', wordmark: 'W', typeface: 'oswald', header: 'band', hero: 'bleed', density: 'compact' });
    const out = parseStoredLayout(s.layout)!;
    const byId = (id: string) => out.widgets.find(w => w.id === id);
    expect(byId('legacy:standings')).toMatchObject({ w: 12, config: { title: 'Table' } });
    expect(byId('w_mine')).toBeDefined();
    const welcome = byId('seed:welcome')!;
    expect(JSON.stringify(welcome.config)).toContain('Welcome to Kanata Golf');
    expect(JSON.stringify(welcome.config)).toContain('golf league in Kanata, ON');
    expect(byId('seed:map')).toMatchObject({ key: 'embed', config: { title: 'Where we play', embed: { provider: 'osm', marker: [45.3, -75.9] } } });
    expect(validateLayout(out)).toEqual([]);
    // 'simple' does not name a typeface → the current one stays; clean mode drops the manager's tile and
    // (rest: 'omit') the modules the entry does not name. The fixture enables only hero/standings/news —
    // schedule and contact are NOT created (the seed never adds an instance the org lacks).
    const simple = applySiteAction(s, patch({ action: 'apply_gallery', entryId: 'simple', mode: 'clean' }), { ...ctx, sportKey: 'golf', gallery: org });
    expect(simple.theme.typeface).toBe('oswald');
    const so = parseStoredLayout(simple.layout)!;
    expect(so.widgets.find(w => w.id === 'w_mine')).toBeUndefined();
    expect(so.widgets.map(w => w.key).sort()).toEqual(['hero', 'text']);
    expect(so.widgets.find(w => w.id === 'seed:welcome')).toBeDefined();
    // No stored layout → one is created; no gallery facts → neutral copy.
    const fresh = applySiteAction(base(), patch({ action: 'apply_gallery', entryId: 'team-scoreboard' }), ctx);
    expect(parseStoredLayout(fresh.layout)).not.toBeNull();
    expect(JSON.stringify(parseStoredLayout(fresh.layout))).toContain('Welcome to our league');
    expect(fresh.templateId).toBe('bold');
    // The schema refuses an unknown entry or mode.
    expect(SitePatchSchema.safeParse({ action: 'apply_gallery', entryId: 'nope' }).success).toBe(false);
    expect(SitePatchSchema.safeParse({ action: 'apply_gallery', entryId: 'simple', mode: 'wipe' }).success).toBe(false);
  });

  it('phase 8: set_template re-lays a STORED layout with the template’s seed (tiles keep ids, options, visibility)', () => {
    let s = base();
    const stack = seedLayout({ template_id: 'classic', hero_config: {}, contact_config: {}, visibility: 'public', modules: Object.entries(s.modules).map(([module_key, m]) => ({ module_key, enabled: m.enabled, sort_order: m.sortOrder, config: m.config })) });
    const mine = { ...stack, widgets: [...stack.widgets.map(w => (w.key === 'standings' ? { ...w, config: { title: 'Table' } } : w)), { id: 'w_t1', key: 'text' as const, x: 0, y: 99, w: 6, h: 3, cv: 1, config: { blocks: [] }, visibility: 'public' as const }] };
    s = { ...s, layout: mine };
    s = applySiteAction(s, patch({ action: 'set_template', templateId: 'bold' }), ctx);
    const out = parseStoredLayout(s.layout)!;
    expect(out).not.toBeNull();
    expect(out.widgets.find(w => w.id === 'legacy:standings')).toMatchObject({ w: 6, config: { title: 'Table' } });
    expect(out.widgets.find(w => w.id === 'w_t1')).toBeDefined();
    expect(out.widgets).toHaveLength(mine.widgets.length);
    // B1: a content tile placed SECOND (right after the hero) stays second — not at the bottom.
    const heroH = stack.widgets.find(w => w.key === 'hero')!.h;
    const early = { ...stack, widgets: [{ id: 'w_welcome', key: 'text' as const, x: 0, y: heroH, w: 12, h: 3, cv: 1, config: { blocks: [{ type: 'paragraph', text: 'Hi' }] }, visibility: 'public' as const }, ...stack.widgets.map(w => (w.key === 'hero' ? w : { ...w, y: w.y + 3 }))] };
    const early2 = applySiteAction({ ...base(), layout: early }, patch({ action: 'set_template', templateId: 'bold' }), ctx);
    const outEarly = parseStoredLayout(early2.layout)!;
    const order = [...outEarly.widgets].sort((a, b) => a.y - b.y || a.x - b.x).map(w => w.id);
    expect(order[0]).toBe('legacy:hero');
    expect(order[1]).toBe('w_welcome');
    expect(validateLayout(outEarly)).toEqual([]);
    // Without a stored layout nothing is written (the renderer seeds anyway).
    const bare = applySiteAction(base(), patch({ action: 'set_template', templateId: 'bold' }), ctx);
    expect(bare.layout).toBeUndefined();
  });

  it('phase 7: set_theme carries the design overrides the console never sends; null clears; set_template resets them', () => {
    let s = base();
    s = applySiteAction(s, patch({ action: 'set_theme', accent: '#0f766e', typeface: 'oswald', header: 'band', density: 'compact' }), ctx);
    expect(s.theme).toEqual({ accent: '#0f766e', typeface: 'oswald', header: 'band', density: 'compact' });
    // The console's whole-object save (no design keys) keeps them.
    s = applySiteAction(s, patch({ action: 'set_theme', accent: '#0f766e', surface: 'tinted', typeface: 'oswald', wordmark: 'W' }), ctx);
    expect(s.theme).toEqual({ accent: '#0f766e', surface: 'tinted', typeface: 'oswald', wordmark: 'W', header: 'band', density: 'compact' });
    // null clears one; a value replaces one.
    s = applySiteAction(s, patch({ action: 'set_theme', accent: '#0f766e', header: null, hero: 'bleed' }), ctx);
    expect(s.theme).toEqual({ accent: '#0f766e', density: 'compact', hero: 'bleed' });
    // Choosing a template lets its decisions show through: overrides go, colours stay.
    s = applySiteAction(s, patch({ action: 'set_template', templateId: 'bold' }), ctx);
    expect(s.templateId).toBe('bold');
    expect(s.theme).toEqual({ accent: '#0f766e' });
  });

  it('set_hero / set_theme / set_contact replace whole objects with the same drop rules', () => {
    let s = applySiteAction(
      base(),
      patch({ action: 'set_hero', headline: 'Hi', imagePath: IMG, imageAlt: 'tee', ctaLabel: 'Book', ctaUrl: 'https://x.test', notice: 'N', noticeUntil: '2030-01-01' }),
      ctx
    );
    expect(s.hero).toEqual({ headline: 'Hi', imagePath: IMG, imageAlt: 'tee', ctaLabel: 'Book', ctaUrl: 'https://x.test', notice: 'N', noticeUntil: '2030-01-01' });
    s = applySiteAction(s, patch({ action: 'set_hero', imageAlt: 'orphan alt', noticeUntil: '2030-01-01' }), ctx);
    expect(s.hero).toEqual({});
    s = applySiteAction(s, patch({ action: 'set_theme', accent: '#0F766E', surface: 'plain', typeface: 'sans', wordmark: 'W' }), ctx);
    expect(s.theme).toEqual({ accent: '#0f766e', wordmark: 'W' });
    s = applySiteAction(s, patch({ action: 'set_theme', accent: null }), ctx);
    expect(s.theme).toEqual({});
    s = applySiteAction(s, patch({ action: 'set_contact', email: 'a@b.co', address: [], social: { instagram: 'https://instagram.com/x' } }), ctx);
    expect(s.contact).toEqual({ email: 'a@b.co', social: { instagram: 'https://instagram.com/x' } });
  });

  it('set_sponsors / set_documents replace the module config and create the row enabled when missing', () => {
    let s = applySiteAction(base(), patch({ action: 'set_sponsors', sponsors: [{ name: 'New' }] }), ctx);
    expect(s.modules.sponsors).toEqual({ enabled: false, sortOrder: 7, config: { sponsors: [{ name: 'New' }] } });
    s = applySiteAction(s, patch({ action: 'set_documents', documents: [{ title: 'Rules', url: 'https://r.test/x.pdf' }] }), ctx);
    expect(s.modules.documents).toEqual({ enabled: true, sortOrder: 15, config: { documents: [{ title: 'Rules', url: 'https://r.test/x.pdf' }] } });
  });

  it('set_course_photo merges one course or one hole, and an empty entry disappears', () => {
    let s = applySiteAction(base(), patch({ action: 'set_course_photo', courseId: COURSE, path: IMG, alt: 'The 9th' }), ctx);
    expect(s.modules.courses.enabled).toBe(false);
    expect(s.modules.courses.config).toEqual({ photos: { [COURSE]: { path: IMG, alt: 'The 9th' } } });
    s = applySiteAction(s, patch({ action: 'set_course_photo', courseId: COURSE, path: IMG, hole: 9 }), ctx);
    expect((s.modules.courses.config.photos as Record<string, { holes?: unknown }>)[COURSE].holes).toEqual({ '9': { path: IMG } });
    s = applySiteAction(s, patch({ action: 'set_course_photo', courseId: COURSE }), ctx);
    expect((s.modules.courses.config.photos as Record<string, unknown>)[COURSE]).toEqual({ holes: { '9': { path: IMG } } });
    s = applySiteAction(s, patch({ action: 'set_course_photo', courseId: COURSE, hole: 9 }), ctx);
    expect(s.modules.courses.config).toEqual({ photos: {} });
  });

  it('gallery picks: newest first, deduped, capped at 80; remove filters; other config keys survive', () => {
    const pick = (n: number) => ({ mediaId: MEDIA(n), postId: MEDIA(n), profileId: MEDIA(n), addedAt: 'TS' });
    let s = applySiteAction(base(), { action: 'set_gallery_pick', pick: pick(1) }, ctx);
    s = { ...s, modules: { ...s.modules, gallery: { ...s.modules.gallery, config: { ...s.modules.gallery.config, other: true } } } };
    s = applySiteAction(s, { action: 'set_gallery_pick', pick: pick(2) }, ctx);
    s = applySiteAction(s, { action: 'set_gallery_pick', pick: pick(1) }, ctx);
    expect((s.modules.gallery.config.picks as { mediaId: string }[]).map(p => p.mediaId)).toEqual([MEDIA(1), MEDIA(2)]);
    expect(s.modules.gallery.config.other).toBe(true);
    s = applySiteAction(s, { action: 'remove_gallery_pick', mediaId: MEDIA(2) }, ctx);
    expect((s.modules.gallery.config.picks as { mediaId: string }[]).map(p => p.mediaId)).toEqual([MEDIA(1)]);
    let many = base();
    for (let i = 0; i < 85; i++) {
      const id = `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`;
      many = applySiteAction(many, { action: 'set_gallery_pick', pick: { mediaId: id, postId: id, profileId: id, addedAt: 'TS' } }, ctx);
    }
    expect((many.modules.gallery.config.picks as unknown[]).length).toBe(80);
  });

  it('never mutates its input', () => {
    const a = base();
    const json = canonicalJson(a);
    applySiteAction(a, { action: 'set_module', moduleKey: 'news', enabled: false }, ctx);
    applySiteAction(a, patch({ action: 'set_nav', items: [{ key: 'news' }] }), ctx);
    expect(canonicalJson(a)).toBe(json);
  });
});

describe('selectRevisionsToPrune', () => {
  const row = (i: number, label: string | null = null, published = true) => ({
    id: `r${i}`,
    label,
    published_at: published ? `2026-09-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` : null,
    created_at: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
  });
  it('keeps the newest N unlabelled, every labelled one, the protected ids, and the draft', () => {
    const rows = [...Array.from({ length: 60 }, (_, i) => row(i)), row(99, 'Launch'), row(100, null, false)];
    const prune = selectRevisionsToPrune(rows, ['r5'], 50);
    expect(prune).toHaveLength(60 - 50 - 1);
    expect(prune).not.toContain('r5');
    expect(prune).not.toContain('r99');
    expect(prune).not.toContain('r100');
    // The oldest unlabelled go first.
    expect(prune).toContain('r0');
    expect(prune).not.toContain('r59');
  });
  it('labelled revisions are capped by the backstop', () => {
    const rows = Array.from({ length: 210 }, (_, i) => row(i, `L${i}`));
    expect(selectRevisionsToPrune(rows, [], 50, 200)).toHaveLength(10);
  });
});

// ── Program 2, B (Sep 11 2026): pages in the ONE snapshot ─────────────────
import { blankPageLayout, pageLayoutFromBody } from '../pages';
import { diffPageRows, type SnapshotPageRow } from '../snapshot';
import { pageNavKey } from '@/lib/org-sites/validate';

describe('pages in the snapshot (program 2, B)', () => {
  const P1 = '2f1b46c8-2964-4139-9689-d1c3f736ed93';
  const P2 = '3a2c57d9-3a75-4240-a79a-e2d4a847fea4';
  const pageRows: SnapshotPageRow[] = [
    { id: P1, slug: 'about', title: 'About', body: [{ type: 'paragraph', text: 'Hello' }], visibility: 'public', created_at: '2026-09-11T09:00:00Z' },
    { id: P2, slug: 'rules', title: 'Rules', body: [], visibility: 'draft', created_at: '2026-09-11T10:00:00Z', layout: blankPageLayout(P2), in_nav: false },
  ];
  const withPages = () => snapshotFromRows(siteRow, rows, pageRows);

  it('rows → snapshot → rows: a null-layout row converts (deterministically), a layout row rides verbatim, and the mirror never writes body', () => {
    const s = withPages();
    expect(Object.keys(s.pages ?? {}).sort()).toEqual([P1, P2].sort());
    expect(s.pages![P1]).toMatchObject({ slug: 'about', visibility: 'public', inNav: true, layout: pageLayoutFromBody(P1, pageRows[0].body) });
    expect(s.pages![P2]).toMatchObject({ visibility: 'draft', inNav: false, layout: blankPageLayout(P2) });
    expect(snapshotsEqual(s, withPages())).toBe(true);
    const out = rowsFromSnapshot(s).pages;
    expect(out.map(r => r.id)).toEqual([P1, P2]);
    expect(out[0]).toMatchObject({ slug: 'about', body: [], visibility: 'public', in_nav: true, created_at: '2026-09-11T09:00:00Z' });
    expect(out[0].layout).toEqual(pageLayoutFromBody(P1, pageRows[0].body));
  });
  it('no pages ⇒ no `pages` key: a pre-pages snapshot and a page-less one are equal; parseSnapshot carries pages through', () => {
    expect(snapshotFromRows(siteRow, rows)).not.toHaveProperty('pages');
    expect(snapshotsEqual(snapshotFromRows(siteRow, rows), snapshotFromRows(siteRow, rows, []))).toBe(true);
    const s = withPages();
    const round = parseSnapshot(JSON.parse(JSON.stringify(s)));
    expect(round).not.toBeNull();
    expect(snapshotsEqual(round!, s)).toBe(true);
    expect(parseSnapshot({ ...s, pages: 'junk' })).not.toHaveProperty('pages');
  });
  it('diffPageRows: every row when prev is null; only changed rows; ids the next snapshot lacks are deletes', () => {
    const s = withPages();
    expect(diffPageRows(null, s).upsert.map(r => r.id)).toEqual([P1, P2]);
    expect(diffPageRows(s, s)).toEqual({ upsert: [], deleteIds: [] });
    const renamed = applySiteAction(s, patch({ action: 'set_page', pageId: P1, title: 'About us' }), ctx);
    expect(diffPageRows(s, renamed).upsert.map(r => r.id)).toEqual([P1]);
    const removed = applySiteAction(s, patch({ action: 'remove_page', pageId: P2 }), ctx);
    expect(diffPageRows(s, removed)).toEqual({ upsert: [], deleteIds: [P2] });
  });
  it('add_page mints a slug (collision → -2, reserved refused), starts as a blank draft, respects the cap; set_page renames/reslugs/toggles; remove_page drops the page and its nav entry', () => {
    const s = withPages();
    const added = applySiteAction(s, { ...(patch({ action: 'add_page', title: 'About' }) as { action: 'add_page'; title: string }), id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: '2026-09-11T11:00:00Z' }, ctx);
    expect(added.pages!['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']).toMatchObject({ slug: 'about-2', title: 'About', visibility: 'draft', inNav: true, layout: blankPageLayout('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') });
    const reserved = applySiteAction(s, { action: 'add_page', title: 'X', slug: 'api', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', createdAt: '2026-09-11T11:00:00Z' }, ctx);
    expect(reserved).toBe(s);
    const full = { ...s, pages: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, { ...s.pages![P1], id: `p${i}`, slug: `p${i}` }])) };
    expect(applySiteAction(full, { action: 'add_page', title: 'One more', id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', createdAt: '2026-09-11T11:00:00Z' }, ctx)).toBe(full);
    const set = applySiteAction(s, patch({ action: 'set_page', pageId: P1, title: 'About us', slug: 'about-us', visibility: 'draft', inNav: false }), ctx);
    expect(set.pages![P1]).toMatchObject({ title: 'About us', slug: 'about-us', visibility: 'draft', inNav: false });
    expect(applySiteAction(s, patch({ action: 'set_page', pageId: P1, slug: 'rules' }), ctx)).toBe(s); // taken
    expect(applySiteAction(s, patch({ action: 'set_page', pageId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: 'x' }), ctx)).toBe(s); // unknown
    const listed = applySiteAction(s, patch({ action: 'set_nav', items: [{ key: pageNavKey(P1) }, { key: 'standings', label: 'Table' }] }), ctx);
    expect(listed.nav).toEqual([{ key: pageNavKey(P1) }, { key: 'standings', label: 'Table' }]);
    expect(listed.modules.standings.sortOrder).toBe(1); // pages take no module position
    const gone = applySiteAction(listed, patch({ action: 'remove_page', pageId: P1 }), ctx);
    expect(gone.pages).not.toHaveProperty(P1);
    expect(gone.nav).toEqual([{ key: 'standings', label: 'Table' }]);
    const empty = applySiteAction(gone, patch({ action: 'remove_page', pageId: P2 }), ctx);
    expect(empty).not.toHaveProperty('pages');
  });
  it('set_nav drops a page key the snapshot lacks; reset_order keeps surviving page entries after the modules; set_module off sweeps pages', () => {
    const s = withPages();
    const stale = applySiteAction(s, patch({ action: 'set_nav', items: [{ key: 'page:dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, { key: 'news' }] }), ctx);
    expect(stale.nav).toEqual([{ key: 'news' }]);
    const listed = applySiteAction(s, patch({ action: 'set_nav', items: [{ key: pageNavKey(P1) }, { key: 'standings', label: 'Table' }] }), ctx);
    const reset = applySiteAction(listed, patch({ action: 'reset_order' }), ctx);
    expect(reset.nav).toEqual([{ key: 'standings', label: 'Table' }, { key: pageNavKey(P1) }]);
    const base = blankPageLayout(P1);
    const withStandings = { ...s, pages: { ...s.pages!, [P1]: { ...s.pages![P1], layout: { ...base, widgets: [...base.widgets, { id: 'st', key: 'standings', x: 0, y: 10, w: 12, h: 4, cv: 1, config: {}, visibility: 'public' as const }] } } } };
    const off = applySiteAction(withStandings, patch({ action: 'set_module', moduleKey: 'standings', enabled: false }), ctx);
    expect((off.pages![P1].layout as { widgets: { key: string }[] }).widgets.map(w => w.key)).toEqual(['text']);
    expect(validateLayout(parseStoredLayout(off.pages![P1].layout)!)).toEqual([]);
  });
});

// ── Program 2, C (Sep 11 2026): seo / footer on the snapshot; the icon token ──
describe('seo + footer + icon (program 2, C)', () => {
  const SITE2 = '2f1b46c8-2964-4139-9689-d1c3f736ed93';
  it('rows ⇄ snapshot carry seo_config / footer_config; absent when empty (a pre-186 row and an empty one are equal)', () => {
    const plain = snapshotFromRows(siteRow, rows);
    expect(plain).not.toHaveProperty('seo');
    expect(plain).not.toHaveProperty('footer');
    expect(snapshotsEqual(plain, snapshotFromRows({ ...siteRow, seo_config: {}, footer_config: {} }, rows))).toBe(true);
    const s = snapshotFromRows({ ...siteRow, seo_config: { title: 'T' }, footer_config: { text: 'F' } }, rows);
    expect(s.seo).toEqual({ title: 'T' });
    expect(s.footer).toEqual({ text: 'F' });
    expect(rowsFromSnapshot(s).site).toMatchObject({ seo_config: { title: 'T' }, footer_config: { text: 'F' } });
    expect(rowsFromSnapshot(plain).site).toMatchObject({ seo_config: {}, footer_config: {} });
    const round = parseSnapshot(JSON.parse(JSON.stringify(s)));
    expect(round && snapshotsEqual(round, s)).toBe(true);
  });
  it('set_seo / set_footer replace whole objects with the drop rules; set_theme carries the icon over, null clears it', () => {
    const s = base();
    const seo = applySiteAction(s, patch({ action: 'set_seo', title: 'T', description: '', imagePath: `org-media/${SITE2}/a.jpg` }), ctx);
    expect(seo.seo).toEqual({ title: 'T', imagePath: `org-media/${SITE2}/a.jpg` });
    expect(applySiteAction(seo, patch({ action: 'set_seo' }), ctx)).not.toHaveProperty('seo');
    const footer = applySiteAction(seo, patch({ action: 'set_footer', text: 'Est. 1962', links: [{ label: 'Rules', url: 'https://example.com' }], showSocials: true }), ctx);
    expect(footer.footer).toEqual({ text: 'Est. 1962', links: [{ label: 'Rules', url: 'https://example.com' }], showSocials: true });
    expect(footer.seo).toEqual(seo.seo); // untouched
    expect(applySiteAction(footer, patch({ action: 'set_footer', showSocials: false }), ctx)).not.toHaveProperty('footer');
    const withIcon = applySiteAction(s, patch({ action: 'set_theme', accent: '#0f766e', iconPath: `org-media/${SITE2}/icon.png` }), ctx);
    expect(withIcon.theme.iconPath).toBe(`org-media/${SITE2}/icon.png`);
    const kept = applySiteAction(withIcon, patch({ action: 'set_theme', accent: '#0f766e' }), ctx);
    expect(kept.theme.iconPath).toBe(`org-media/${SITE2}/icon.png`);
    const cleared = applySiteAction(withIcon, patch({ action: 'set_theme', accent: '#0f766e', iconPath: null }), ctx);
    expect(cleared.theme).not.toHaveProperty('iconPath');
  });
});
