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
  defaultModuleOrder,
  parseNavConfig,
  type SitePatchInput,
} from '@/lib/org-sites/validate';
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
export function snapshotFromRows(site: SnapshotSiteRow, modules: SnapshotModuleRow[]): SiteSnapshot {
  const out: Record<string, SnapshotModule> = {};
  for (const m of modules) {
    if (typeof m.module_key !== 'string') continue;
    out[m.module_key] = { enabled: !!m.enabled, sortOrder: Number(m.sort_order) || 0, config: asRecord(m.config) };
  }
  return {
    v: SNAPSHOT_VERSION,
    templateId: typeof site.template_id === 'string' ? site.template_id : 'classic',
    theme: asRecord(site.theme_token_set),
    hero: asRecord(site.hero_config),
    nav: asArray(site.nav_config),
    contact: asRecord(site.contact_config),
    modules: out,
  };
}

/** The snapshot → the rows publish writes (the published projection). */
export function rowsFromSnapshot(s: SiteSnapshot): { site: SnapshotSiteRow; modules: SnapshotModuleRow[] } {
  return {
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
  return all.filter(row => {
    const before = prev.modules[row.module_key];
    if (!before) return true;
    return (
      before.enabled !== row.enabled ||
      before.sortOrder !== row.sort_order ||
      canonicalJson(before.config) !== canonicalJson(row.config)
    );
  });
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
  return {
    v: SNAPSHOT_VERSION,
    templateId: r.templateId,
    theme: asRecord(r.theme),
    hero: asRecord(r.hero),
    nav: asArray(r.nav),
    contact: asRecord(r.contact),
    modules,
    ...(r.layout !== undefined ? { layout: r.layout } : {}),
  };
}

// ── The content actions, ported 1:1 from sitePATCH ─────────────────────────

/** Every SitePatch content action. Gallery picks arrive PRE-EVALUATED: the
 *  async member-photo gate runs in the server before this pure step. */
export type SnapshotAction =
  | Exclude<SitePatchInput, { action: 'publish' | 'unpublish' | 'set_gallery_pick' | 'remove_gallery_pick' }>
  | { action: 'set_gallery_pick'; pick: GalleryPick }
  | { action: 'remove_gallery_pick'; mediaId: string };

export interface ApplyContext {
  side: 'league' | 'club';
  sportKey: string | null;
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
      return { ...s, modules };
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
    case 'set_theme':
      return {
        ...s,
        theme: {
          ...(input.accent ? { accent: input.accent.toLowerCase() } : {}),
          ...(input.accentStrong ? { accentStrong: input.accentStrong.toLowerCase() } : {}),
          ...(input.surface && input.surface !== 'plain' ? { surface: input.surface } : {}),
          ...(input.typeface && input.typeface !== 'sans' ? { typeface: input.typeface } : {}),
          ...(input.wordmark ? { wordmark: input.wordmark } : {}),
        },
      };
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
    case 'set_template':
      return { ...s, templateId: input.templateId };
    case 'reset_order': {
      // Back to the side's recommended order; nav order cleared, LABELS kept.
      const order = defaultModuleOrder(ctx.side, ctx.sportKey);
      order.forEach((key, i) => {
        if (modules[key]) modules[key] = { ...modules[key], sortOrder: i };
      });
      const labels = parseNavConfig(s.nav).labels;
      const nav = order.filter(key => labels[key]).map(key => ({ key, label: labels[key] }));
      return { ...s, modules, nav };
    }
    case 'set_nav': {
      // nav_config (labels + display order) AND the rows' sortOrder follow
      // one list; unlisted modules keep theirs; hero stays first at 0.
      const seen = new Set<string>();
      const items = input.items.filter(i => (seen.has(i.key) ? false : (seen.add(i.key), true)));
      const nav = items.map(i => ({ key: i.key, ...(i.label ? { label: i.label } : {}) }));
      items.forEach((item, i) => {
        if (modules[item.key]) modules[item.key] = { ...modules[item.key], sortOrder: i + 1 };
      });
      return { ...s, modules, nav };
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
