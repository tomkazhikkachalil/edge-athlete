/**
 * The site snapshot — Site Builder phase 2 (Sep 9 2026).
 *
 * A revision is ONE jsonb value holding everything under the publish gate:
 * template, theme tokens, hero, nav, contact, and every module row's
 * enabled / sortOrder / config — the legacy columns, verbatim — plus the
 * optional widget layout (phase 1's `SiteLayout`, in the same jsonb).
 * Restore is a copy; publish MIRRORS the snapshot back into the rows, which
 * stay the published projection every existing reader consumes.
 *
 * Everything here is pure and node-tested: rows → snapshot → rows is
 * byte-faithful, equality is canonical (jsonb round-trips drop key order),
 * and `applySiteAction` ports every `sitePATCH` content branch 1:1 so the
 * draft path and the pre-180 live path produce the same object.
 */

import {
  MODULE_KEYS,
  PAGES_PER_SITE_MAX,
  defaultModuleOrder,
  isPageNavKey,
  pageNavKey,
  parseNavConfig,
  type SitePatchInput,
  THEME_DESIGN_KEYS,
} from '@/lib/org-sites/validate';
import { blankPageLayout, mintPageSlug, orderedPages, pageLayoutFromBody, parseSnapshotPages, sweepModuleFromPages, type SnapshotPage } from './pages';
import { LAYOUT_WIDGETS_MAX, parseStoredLayout } from './layout-schema';
import { LEGACY_ID_PREFIX, appendWidget, compactLayout, newInstanceFor, validateLayout, type LegacySiteShape, type WidgetInstance } from './layout';
import { applySeed, seedLayout } from './seeds';
import { NEUTRAL_ORG, applyGallerySeed, galleryEntry, gallerySeed, type GalleryOrg } from './gallery';
import { GALLERY_PICKS_MAX, readGalleryPicks, type GalleryPick } from '@/lib/org-sites/member-photo-gate';

export const SNAPSHOT_VERSION = 1 as const;

export interface SnapshotModule {
  enabled: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
}

export interface SiteSnapshot {
  v: typeof SNAPSHOT_VERSION;
  templateId: string;
  /** org_sites.theme_token_set, verbatim. */
  theme: Record<string, unknown>;
  /** org_sites.hero_config, verbatim. */
  hero: Record<string, unknown>;
  /** org_sites.nav_config, verbatim. */
  nav: unknown[];
  /** org_sites.contact_config, verbatim. */
  contact: Record<string, unknown>;
  /** org_site_modules, keyed by module_key. */
  modules: Record<string, SnapshotModule>;
  /** Phase 1's SiteLayout slot — absent until a grid layout is authored. */
  layout?: unknown;
  /** Program 2, B (Sep 11 2026): the custom pages, keyed by id — ABSENT when
   *  there are none (a snapshot from before pages and one with no pages must
   *  compare equal, or every draft would read "dirty"). */
  pages?: Record<string, SnapshotPage>;
}

/** An `org_site_pages` row as the snapshot reads and writes it. `layout` /
 *  `in_nav` are undefined pre-185 (the read ladder dropped them). */
export interface SnapshotPageRow {
  id: string;
  slug: string;
  title: string;
  body: unknown;
  visibility: string;
  created_at: string;
  layout?: unknown;
  in_nav?: boolean | null;
}

/** `pages` only when there is at least one. */
function withPages(s: SiteSnapshot, pages: Record<string, SnapshotPage>): SiteSnapshot {
  const rest: SiteSnapshot = { ...s };
  delete rest.pages;
  return Object.keys(pages).length > 0 ? { ...rest, pages } : rest;
}

export interface SnapshotSiteRow {
  template_id: string;
  theme_token_set: unknown;
  nav_config: unknown;
  hero_config: unknown;
  contact_config: unknown;
}

export interface SnapshotModuleRow {
  module_key: string;
  enabled: boolean;
  sort_order: number;
  config: unknown;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Today's rows → the snapshot (the lazy first-draft materialisation and
 *  the pre-180 live path both start here). */
export function snapshotFromRows(site: SnapshotSiteRow, modules: SnapshotModuleRow[], pages: SnapshotPageRow[] = []): SiteSnapshot {
  const out: Record<string, SnapshotModule> = {};
  for (const m of modules) {
    if (typeof m.module_key !== 'string') continue;
    out[m.module_key] = { enabled: !!m.enabled, sortOrder: Number(m.sort_order) || 0, config: asRecord(m.config) };
  }
  const pageMap: Record<string, SnapshotPage> = {};
  for (const p of pages) {
    if (typeof p.id !== 'string' || typeof p.slug !== 'string' || typeof p.title !== 'string') continue;
    // A row whose `layout` is null still speaks in blocks: convert it here
    // (deterministically — the ids derive from the page id) so the snapshot
    // is the truth from its first materialisation and the mirror never
    // touches `body` again.
    const layout = p.layout ?? pageLayoutFromBody(p.id, p.body);
    pageMap[p.id] = { id: p.id, slug: p.slug, title: p.title, visibility: p.visibility === 'draft' ? 'draft' : 'public', inNav: p.in_nav !== false, createdAt: p.created_at, layout };
  }
  return withPages(
    {
      v: SNAPSHOT_VERSION,
      templateId: typeof site.template_id === 'string' ? site.template_id : 'classic',
      theme: asRecord(site.theme_token_set),
      hero: asRecord(site.hero_config),
      nav: asArray(site.nav_config),
      contact: asRecord(site.contact_config),
      modules: out,
    },
    pageMap
  );
}

/** The snapshot → the rows publish writes (the published projection). */
export function rowsFromSnapshot(s: SiteSnapshot): { site: SnapshotSiteRow; modules: SnapshotModuleRow[]; pages: SnapshotPageRow[] } {
  return {
    pages: orderedPages(s.pages).map(p => ({ id: p.id, slug: p.slug, title: p.title, body: [], visibility: p.visibility, created_at: p.createdAt, layout: p.layout, in_nav: p.inNav })),
    site: {
      template_id: s.templateId,
      theme_token_set: s.theme,
      nav_config: s.nav,
      hero_config: s.hero,
      contact_config: s.contact,
    },
    modules: Object.entries(s.modules)
      .map(([module_key, m]) => ({ module_key, enabled: m.enabled, sort_order: m.sortOrder, config: m.config }))
      .sort((a, b) => a.sort_order - b.sort_order || a.module_key.localeCompare(b.module_key)),
  };
}

/** Key-sorted JSON — jsonb does not preserve key order, so equality must not
 *  depend on it. */
export function canonicalJson(value: unknown): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          const inner = (v as Record<string, unknown>)[k];
          if (inner !== undefined) acc[k] = sortKeys(inner);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sortKeys(value));
}

export function snapshotsEqual(a: SiteSnapshot, b: SiteSnapshot): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Only the module rows that differ between two snapshots (every row when
 *  `prev` is null) — publish writes these, per-row, never an upsert. */
export function diffModuleRows(prev: SiteSnapshot | null, next: SiteSnapshot): SnapshotModuleRow[] {
  const all = rowsFromSnapshot(next).modules;
  if (!prev) return all;
  const changed = all.filter(row => {
    const before = prev.modules[row.module_key];
    if (!before) return true;
    return (
      before.enabled !== row.enabled ||
      before.sortOrder !== row.sort_order ||
      canonicalJson(before.config) !== canonicalJson(row.config)
    );
  });
  // Backlog B1: a key the NEXT snapshot lacks (a restore of a revision taken
  // before that module existed) must turn its live row OFF — before, an
  // absent key was simply not written and the module stayed enabled forever.
  const nextKeys = new Set(all.map(r => r.module_key));
  for (const [module_key, before] of Object.entries(prev.modules)) {
    if (!nextKeys.has(module_key) && before.enabled) changed.push({ module_key, enabled: false, sort_order: before.sortOrder, config: before.config });
  }
  return changed;
}

/** The page rows publish writes: upserts for pages that are new or changed
 *  (whole rows — the mirror UPDATEs by id, INSERTs the rest) and the ids the
 *  next snapshot no longer holds. Every row when `prev` is null. */
export function diffPageRows(prev: SiteSnapshot | null, next: SiteSnapshot): { upsert: SnapshotPageRow[]; deleteIds: string[] } {
  const all = rowsFromSnapshot(next).pages;
  if (!prev) return { upsert: all, deleteIds: [] };
  const before = prev.pages ?? {};
  const upsert = all.filter(row => {
    const b = before[row.id];
    return !b || canonicalJson(next.pages?.[row.id]) !== canonicalJson(b);
  });
  const nextIds = new Set(all.map(r => r.id));
  const deleteIds = Object.keys(before).filter(id => !nextIds.has(id));
  return { upsert, deleteIds };
}

/** Defensive: a stored snapshot from any build, or null when unusable
 *  (the caller then falls back to the rows). Never throws. */
export function parseSnapshot(raw: unknown): SiteSnapshot | null {
  const r = asRecord(raw);
  if (r.v !== SNAPSHOT_VERSION) return null;
  if (typeof r.templateId !== 'string') return null;
  const modulesRaw = asRecord(r.modules);
  const modules: Record<string, SnapshotModule> = {};
  for (const [key, value] of Object.entries(modulesRaw)) {
    const m = asRecord(value);
    modules[key] = {
      enabled: !!m.enabled,
      sortOrder: typeof m.sortOrder === 'number' && Number.isFinite(m.sortOrder) ? m.sortOrder : 0,
      config: asRecord(m.config),
    };
  }
  // Program 2, B: `pages` MUST ride through here — a whitelist that dropped
  // them would lose every page on the next restore or publish.
  return withPages(
    {
      v: SNAPSHOT_VERSION,
      templateId: r.templateId,
      theme: asRecord(r.theme),
      hero: asRecord(r.hero),
      nav: asArray(r.nav),
      contact: asRecord(r.contact),
      modules,
      ...(r.layout !== undefined ? { layout: r.layout } : {}),
    },
    parseSnapshotPages(r.pages)
  );
}

// ── The content actions, ported 1:1 from sitePATCH ─────────────────────────

/** Every SitePatch content action. Gallery picks arrive PRE-EVALUATED: the
 *  async member-photo gate runs in the server before this pure step. */
export type SnapshotAction =
  | Exclude<SitePatchInput, { action: 'publish' | 'unpublish' | 'set_gallery_pick' | 'remove_gallery_pick' | 'add_page' }>
  | { action: 'set_gallery_pick'; pick: GalleryPick }
  | { action: 'remove_gallery_pick'; mediaId: string }
  /** Program 2, B: the server mints the id and the timestamp (the reducer stays pure). */
  | (Extract<SitePatchInput, { action: 'add_page' }> & { id: string; createdAt: string });

export interface ApplyContext {
  side: 'league' | 'club';
  sportKey: string | null;
  /** Phase 11, `apply_gallery` only — the org facts the generated content is
   *  written from, loaded once by the server; the reducer stays pure. */
  gallery?: GalleryOrg;
}

const moduleOr = (s: SiteSnapshot, key: string, enabledIfNew: boolean): SnapshotModule =>
  s.modules[key] ?? { enabled: enabledIfNew, sortOrder: MODULE_KEYS.indexOf(key as (typeof MODULE_KEYS)[number]), config: {} };

/** A new snapshot with the action applied. The draft path and the legacy
 *  live path both call this, so the two can never disagree. */
export function applySiteAction(s: SiteSnapshot, input: SnapshotAction, ctx: ApplyContext): SiteSnapshot {
  const modules = { ...s.modules };
  switch (input.action) {
    case 'set_module': {
      // Self-heals a missing row at its default position (the toggle must
      // never brick on a deleted row).
      const m = moduleOr(s, input.moduleKey, input.enabled);
      modules[input.moduleKey] = { ...m, enabled: input.enabled };
      // H4 (Tom: "the toggle governs the tile"): a STORED layout follows the
      // switch — off removes every instance of the module, on appends one
      // (the legacy id, so an untouched page still matches its seed) when
      // none is there. No stored layout → the seed already reads the rows.
      // Program 2, B: off sweeps the module off every PAGE layout too.
      const swept = !input.enabled && s.pages ? withPages(s, sweepModuleFromPages(s.pages, input.moduleKey)) : s;
      const stored = parseStoredLayout(s.layout);
      if (!stored) return { ...swept, modules };
      const key = input.moduleKey as WidgetInstance['key'];
      if (!input.enabled) {
        const kept = stored.widgets.filter(w => w.key !== key);
        return { ...swept, modules, layout: kept.length === stored.widgets.length ? stored : { ...stored, widgets: compactLayout(kept) } };
      }
      if (stored.widgets.some(w => w.key === key)) return { ...s, modules, layout: stored };
      const shape: LegacySiteShape = {
        hero_config: s.hero,
        contact_config: s.contact,
        visibility: 'public',
        modules: Object.entries(modules).map(([module_key, mod]) => ({ module_key, enabled: mod.enabled, sort_order: mod.sortOrder, config: mod.config })),
      };
      return { ...s, modules, layout: appendWidget(stored, newInstanceFor(shape, key, `${LEGACY_ID_PREFIX}${key}`)) };
    }
    case 'set_hero':
      return {
        ...s,
        // Whole-object replace — the console always sends every field.
        hero: {
          ...(input.headline ? { headline: input.headline } : {}),
          ...(input.tagline ? { tagline: input.tagline } : {}),
          ...(input.imagePath ? { imagePath: input.imagePath } : {}),
          ...(input.imagePath && input.imageAlt ? { imageAlt: input.imageAlt } : {}),
          ...(input.ctaLabel && input.ctaUrl ? { ctaLabel: input.ctaLabel, ctaUrl: input.ctaUrl } : {}),
          ...(input.notice ? { notice: input.notice } : {}),
          ...(input.notice && input.noticeUntil ? { noticeUntil: input.noticeUntil } : {}),
        },
      };
    case 'set_theme': {
      // Phase 7: the design overrides (header / hero / density / teams) are
      // the editor's. The console's whole-object save never names them, so
      // they CARRY OVER unless the input does — a value sets, null clears.
      const design: Record<string, unknown> = {};
      for (const k of THEME_DESIGN_KEYS) {
        const v = k in input ? input[k] : s.theme[k];
        if (typeof v === 'string') design[k] = v;
      }
      return {
        ...s,
        theme: {
          ...design,
          ...(input.accent ? { accent: input.accent.toLowerCase() } : {}),
          ...(input.accentStrong ? { accentStrong: input.accentStrong.toLowerCase() } : {}),
          ...(input.surface && input.surface !== 'plain' ? { surface: input.surface } : {}),
          ...(input.typeface && input.typeface !== 'sans' ? { typeface: input.typeface } : {}),
          ...(input.wordmark ? { wordmark: input.wordmark } : {}),
        },
      };
    }
    case 'set_contact':
      return {
        ...s,
        contact: {
          ...(input.email ? { email: input.email } : {}),
          ...(input.phone ? { phone: input.phone } : {}),
          ...(input.website ? { website: input.website } : {}),
          ...(input.address && input.address.length ? { address: input.address } : {}),
          ...(input.hours ? { hours: input.hours } : {}),
          ...(input.directionsUrl ? { directionsUrl: input.directionsUrl } : {}),
          ...(input.social && Object.values(input.social).some(Boolean)
            ? { social: Object.fromEntries(Object.entries(input.social).filter(([, v]) => typeof v === 'string' && v)) }
            : {}),
        },
      };
    case 'apply_gallery': {
      // Phase 11: a starting point for the whole page. Family → templateId
      // (inside the mig-170 CHECK); the design overrides go, then the
      // entry's tokens land (typeface only when named; colours, wordmark and
      // surface untouched); the layout is re-laid with the entry's seed —
      // over what the site renders today when nothing is stored yet.
      const entry = galleryEntry(input.entryId);
      if (!entry) return s;
      const theme = { ...s.theme };
      for (const k of THEME_DESIGN_KEYS) delete theme[k];
      for (const [k, v] of Object.entries(entry.tokens)) if (v) theme[k] = v;
      const shape = (template_id: string) => ({
        template_id,
        hero_config: s.hero,
        contact_config: s.contact,
        visibility: 'public' as const,
        modules: Object.entries(s.modules).map(([module_key, m]) => ({ module_key, enabled: m.enabled, sort_order: m.sortOrder, config: m.config })),
      });
      const current = parseStoredLayout(s.layout) ?? seedLayout(shape(s.templateId));
      const seed = gallerySeed(entry, shape(entry.family), ctx.gallery ?? NEUTRAL_ORG(ctx.side), ctx.side, ctx.sportKey);
      const layout = applyGallerySeed(current, seed, input.mode ?? 'keep', entry.rest === 'omit', LAYOUT_WIDGETS_MAX);
      // H4: never write a layout the readers would refuse — a refused
      // layout parses as null and the page silently reverts to its seed.
      const parsed = parseStoredLayout(layout);
      if (!parsed || validateLayout(parsed).length > 0) return s;
      return { ...s, templateId: entry.family, theme, layout };
    }
    case 'set_template': {
      // "Apply the seed": the template's decisions show through again, so
      // its design overrides go (colours, typeface and wordmark stay) —
      // and, phase 8, a STORED layout is re-laid with the template's seed
      // (every tile keeps its id, options and visibility; content tiles
      // follow below). A site without a stored layout renders the seed anyway.
      const theme = { ...s.theme };
      for (const k of THEME_DESIGN_KEYS) delete theme[k];
      const stored = parseStoredLayout(s.layout);
      if (!stored) return { ...s, templateId: input.templateId, theme };
      const shape = {
        template_id: input.templateId,
        hero_config: s.hero,
        contact_config: s.contact,
        visibility: 'public' as const,
        modules: Object.entries(s.modules).map(([module_key, m]) => ({ module_key, enabled: m.enabled, sort_order: m.sortOrder, config: m.config })),
      };
      return { ...s, templateId: input.templateId, theme, layout: applySeed(stored, seedLayout(shape)) };
    }
    case 'reset_order': {
      // Back to the side's recommended order; nav order cleared, LABELS kept.
      const order = defaultModuleOrder(ctx.side, ctx.sportKey);
      order.forEach((key, i) => {
        if (modules[key]) modules[key] = { ...modules[key], sortOrder: i };
      });
      const parsedNav = parseNavConfig(s.nav);
      const labels = parsedNav.labels;
      // Program 2, B: the pages keep their header places, after the modules.
      const pageEntries = parsedNav.entries.filter(k => isPageNavKey(k) && !!s.pages?.[k.slice('page:'.length)]).map(key => ({ key }));
      const nav = [...order.filter(key => labels[key]).map(key => ({ key, label: labels[key] })), ...pageEntries];
      return { ...s, modules, nav };
    }
    case 'set_nav': {
      // nav_config (labels + display order) AND the rows' sortOrder follow
      // one list; unlisted modules keep theirs; hero stays first at 0.
      const seen = new Set<string>();
      // Program 2, B: a page key names a page the snapshot holds, or it is
      // dropped silently (a stale console list may name a removed page).
      const items = input.items.filter(i => {
        if (seen.has(i.key)) return false;
        if (isPageNavKey(i.key) && !s.pages?.[i.key.slice('page:'.length)]) return false;
        seen.add(i.key);
        return true;
      });
      const nav = items.map(i => ({ key: i.key, ...(i.label && !isPageNavKey(i.key) ? { label: i.label } : {}) }));
      let position = 0;
      for (const item of items) {
        if (isPageNavKey(item.key)) continue;
        position += 1;
        if (modules[item.key]) modules[item.key] = { ...modules[item.key], sortOrder: position };
      }
      return { ...s, modules, nav };
    }
    case 'add_page': {
      // Program 2, B: a new page — the blank layout, unlisted in the header
      // (navEntries places it after the listed ones by creation time).
      const pages = { ...(s.pages ?? {}) };
      if (Object.keys(pages).length >= PAGES_PER_SITE_MAX || pages[input.id]) return s;
      const taken = new Set(Object.values(pages).map(p => p.slug));
      const slug = mintPageSlug(input.title, taken, input.slug);
      if (!slug) return s;
      pages[input.id] = { id: input.id, slug, title: input.title, visibility: 'draft', inNav: true, createdAt: input.createdAt, layout: blankPageLayout(input.id) };
      return withPages(s, pages);
    }
    case 'set_page': {
      const current = s.pages?.[input.pageId];
      if (!current) return s;
      let next: SnapshotPage = current;
      if (input.title) next = { ...next, title: input.title };
      if (input.slug !== undefined && input.slug !== current.slug) {
        const taken = new Set(Object.values(s.pages ?? {}).filter(p => p.id !== current.id).map(p => p.slug));
        const slug = mintPageSlug(current.title, taken, input.slug);
        if (!slug) return s;
        next = { ...next, slug };
      }
      if (input.visibility) next = { ...next, visibility: input.visibility };
      if (typeof input.inNav === 'boolean') next = { ...next, inNav: input.inNav };
      return withPages(s, { ...(s.pages ?? {}), [input.pageId]: next });
    }
    case 'remove_page': {
      if (!s.pages?.[input.pageId]) return s;
      const pages = { ...s.pages };
      delete pages[input.pageId];
      const key = pageNavKey(input.pageId);
      const nav = s.nav.filter(item => !(item && typeof item === 'object' && (item as Record<string, unknown>).key === key));
      return withPages({ ...s, nav }, pages);
    }
    case 'set_sponsors': {
      const m = moduleOr(s, 'sponsors', true);
      modules.sponsors = { ...m, config: { sponsors: input.sponsors } };
      return { ...s, modules };
    }
    case 'set_documents': {
      const m = moduleOr(s, 'documents', true);
      modules.documents = { ...m, config: { documents: input.documents } };
      return { ...s, modules };
    }
    case 'set_course_photo': {
      // Merge ONE course's photo (or one hole's) into config.photos; an
      // entry with nothing left disappears.
      const m = moduleOr(s, 'courses', false);
      const existing = asRecord(m.config.photos);
      const photos: Record<string, unknown> = { ...existing };
      const prior = existing[input.courseId];
      const entry: Record<string, unknown> = prior && typeof prior === 'object' ? { ...(prior as Record<string, unknown>) } : {};
      if (input.hole) {
        const holes: Record<string, unknown> = entry.holes && typeof entry.holes === 'object' ? { ...(entry.holes as Record<string, unknown>) } : {};
        if (input.path) holes[String(input.hole)] = { path: input.path, ...(input.alt ? { alt: input.alt } : {}) };
        else delete holes[String(input.hole)];
        if (Object.keys(holes).length > 0) entry.holes = holes;
        else delete entry.holes;
      } else if (input.path) {
        entry.path = input.path;
        if (input.alt) entry.alt = input.alt;
        else delete entry.alt;
      } else {
        delete entry.path;
        delete entry.alt;
      }
      const hasHoles = !!entry.holes && Object.keys(entry.holes as Record<string, unknown>).length > 0;
      if (entry.path || hasHoles) photos[input.courseId] = entry;
      else delete photos[input.courseId];
      modules.courses = { ...m, config: { ...m.config, photos } };
      return { ...s, modules };
    }
    case 'set_gallery_pick':
    case 'remove_gallery_pick': {
      const m = moduleOr(s, 'gallery', false);
      const mediaId = input.action === 'set_gallery_pick' ? input.pick.mediaId : input.mediaId;
      const current = readGalleryPicks(m.config).filter(p => p.mediaId !== mediaId);
      const picks = input.action === 'set_gallery_pick' ? [input.pick, ...current].slice(0, GALLERY_PICKS_MAX) : current;
      modules.gallery = { ...m, config: { ...m.config, picks } };
      return { ...s, modules };
    }
    default:
      return s;
  }
}

/** Overlay a snapshot onto a SiteRow-shaped object and rebuild its ordered
 *  modules — the draft view of a site (siteGET, the preview). Row-only
 *  fields (published_at, logo_path, the domain columns) come from `site`. */
export function overlaySnapshot<T extends SnapshotSiteRow & { modules: SnapshotModuleRow[] }>(site: T, s: SiteSnapshot): T {
  const rows = rowsFromSnapshot(s);
  return { ...site, ...rows.site, modules: rows.modules };
}

// ── Retention ───────────────────────────────────────────────────────────────

export interface PrunableRevision {
  id: string;
  label: string | null;
  published_at: string | null;
  created_at: string;
}

export const REVISION_KEEP = 50;
export const LABELLED_REVISION_KEEP = 200;

/** Which PUBLISHED revisions to delete: keep the newest `keep`, every
 *  labelled one (backstop `keepLabelled`), and anything in `protectIds`
 *  (the current published revision, the draft). */
export function selectRevisionsToPrune(
  rows: PrunableRevision[],
  protectIds: readonly string[],
  keep = REVISION_KEEP,
  keepLabelled = LABELLED_REVISION_KEEP
): string[] {
  const protect = new Set(protectIds);
  const published = rows
    .filter(r => r.published_at)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const prune: string[] = [];
  let unlabelledKept = 0;
  let labelledKept = 0;
  for (const r of published) {
    if (protect.has(r.id)) continue;
    if (r.label) {
      if (labelledKept < keepLabelled) labelledKept++;
      else prune.push(r.id);
      continue;
    }
    if (unlabelledKept < keep) unlabelledKept++;
    else prune.push(r.id);
  }
  return prune;
}
