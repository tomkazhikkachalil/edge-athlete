/**
 * Pages as compositions — Site Builder program 2, B (Sep 11 2026).
 *
 * A custom page is a layout of the same registered widgets as the home page
 * (every site widget except the hero), living in the ONE revision snapshot
 * (`snapshot.pages[pageId]`) under the same draft → publish → revisions gate;
 * `org_site_pages` is its PUBLISHED PROJECTION (as `org_site_modules` is of
 * `snapshot.modules`). Everything here is pure and node-tested.
 *
 * Legacy pages (mig 155's `body` blocks) convert in app code, never SQL:
 * `pageLayoutFromBody` turns runs of heading / paragraph / link-list blocks
 * into `text` instances (split at TEXT_WIDGET_BLOCKS_MAX) and each site-
 * image block into an `image` instance, all full-width and stacked, with
 * DETERMINISTIC ids (`legacy:page:<pageId>:<n>`) so two materialisations of
 * the same rows compare equal (else every draft would read "dirty").
 * `blocksFromPageLayout` is the exact inverse for a converted layout.
 */
import { PAGE_WIDGET_KEYS, SITE_WIDGET_KEYS, WIDGETS, type PageWidgetKey } from './catalog';
import { GRID, compactLayout, validateLayout, type LayoutIssue, type SiteLayout, type WidgetInstance } from './layout';
import { parseStoredLayout } from './layout-schema';
import { TEXT_WIDGET_BLOCKS_MAX } from './fields';
import { ORG_IMAGE_PATH_RE, PAGES_PER_SITE_MAX, isValidPageSlug, parsePageBody, slugifyPageTitle, type PageBlock } from '@/lib/org-sites/validate';

export { PAGE_WIDGET_KEYS, PAGES_PER_SITE_MAX };

/** A page holds at most as many instances as a legacy body held blocks, so
 *  every legacy page converts. */
export const PAGE_WIDGETS_MAX = 40;
export const PAGE_TITLE_MAX = 120;
/** Converted-legacy instance ids: `legacy:page:<pageId>:<n>`. */
export const PAGE_LEGACY_ID_PREFIX = 'legacy:page:';

export type PageVisibility = 'public' | 'draft';

export interface SnapshotPage {
  id: string;
  slug: string;
  title: string;
  /** The module-`enabled` analogue: a draft page is invisible publicly. It
   *  rides the gate like everything else — never a second draft. */
  visibility: PageVisibility;
  /** Listed in the header; a hidden page stays reachable at its address. */
  inNav: boolean;
  /** ISO timestamp — the unlisted order in the header. */
  createdAt: string;
  /** The page's SiteLayout (stored as unknown, parsed by the readers). */
  layout: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Defensive: a stored `pages` map from any build; unusable entries are
 *  dropped. Never throws. */
export function parseSnapshotPages(raw: unknown): Record<string, SnapshotPage> {
  const out: Record<string, SnapshotPage> = {};
  if (!isRecord(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const slug = value.slug;
    const title = value.title;
    if (typeof slug !== 'string' || typeof title !== 'string') continue;
    out[id] = {
      id,
      slug,
      title,
      visibility: value.visibility === 'draft' ? 'draft' : 'public',
      inNav: value.inNav !== false,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
      layout: value.layout ?? null,
    };
  }
  return out;
}

/** Pages in their natural order (creation time, then id — stable). */
export function orderedPages(pages: Record<string, SnapshotPage> | undefined): SnapshotPage[] {
  return Object.values(pages ?? {}).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id)));
}

/** The slug a new page gets: the title's slug, else -2..-20 — the first
 *  valid one nobody holds. Null when every candidate is taken or reserved. */
export function mintPageSlug(title: string, taken: ReadonlySet<string>, wanted?: string): string | null {
  if (wanted !== undefined) return isValidPageSlug(wanted) && !taken.has(wanted) ? wanted : null;
  const base = slugifyPageTitle(title) || 'page';
  const candidates = [base, ...Array.from({ length: 19 }, (_, i) => `${base}-${i + 2}`)].map(c => c.slice(0, 80)).filter(isValidPageSlug);
  for (const c of candidates) if (!taken.has(c)) return c;
  return null;
}

/** What a schema cannot say about a PAGE layout: the home rules, plus no
 *  hero, only page widgets, and the page cap. Empty = valid. */
export function validatePageLayout(layout: SiteLayout): LayoutIssue[] {
  const issues = validateLayout(layout);
  if (layout.widgets.length > PAGE_WIDGETS_MAX) issues.push({ id: '', message: `A page holds at most ${PAGE_WIDGETS_MAX} sections` });
  for (const w of layout.widgets) {
    if (w.key === 'hero') issues.push({ id: w.id, message: 'The hero belongs to the home page' });
    else if (!(PAGE_WIDGET_KEYS as readonly string[]).includes(w.key)) issues.push({ id: w.id, message: `${w.key}: not a page widget` });
  }
  return issues;
}

/** A page layout the readers accept, or null. */
export function parsePageLayout(raw: unknown): SiteLayout | null {
  const parsed = parseStoredLayout(raw);
  if (!parsed) return null;
  return validatePageLayout(parsed).length === 0 ? parsed : null;
}

const instance = (pageId: string, n: number, key: PageWidgetKey, y: number, config: Record<string, unknown>): WidgetInstance => ({
  id: `${PAGE_LEGACY_ID_PREFIX}${pageId}:${n}`,
  key,
  x: 0,
  y,
  w: GRID.cols,
  h: WIDGETS[key].constraints.defaultSize.h,
  cv: 1,
  config,
  visibility: 'public',
});

/** The blank page: one full-width empty text section — a page is a
 *  document from its first second; no hero. */
export function blankPageLayout(pageId: string): SiteLayout {
  return { version: 1, cols: GRID.cols, widgets: [instance(pageId, 0, 'text', 0, { blocks: [] })] };
}

/** Legacy `body` blocks → a page layout (lossless, deterministic). */
export function pageLayoutFromBody(pageId: string, body: unknown): SiteLayout {
  const blocks = parsePageBody(body);
  const widgets: WidgetInstance[] = [];
  let run: PageBlock[] = [];
  let y = 0;
  let n = 0;
  const flush = () => {
    for (let i = 0; i < run.length; i += TEXT_WIDGET_BLOCKS_MAX) {
      const w = instance(pageId, n++, 'text', y, { blocks: run.slice(i, i + TEXT_WIDGET_BLOCKS_MAX) });
      widgets.push(w);
      y += w.h;
    }
    run = [];
  };
  for (const block of blocks) {
    // A site IMAGE becomes its own section; any other media path (a
    // document, say) stays a text block — TextBlockSchema admits it.
    if (block.type === 'image' && ORG_IMAGE_PATH_RE.test(block.path)) {
      flush();
      const w = instance(pageId, n++, 'image', y, {
        path: block.path,
        alt: block.alt,
        ...(block.width ? { width: block.width } : {}),
        ...(block.height ? { height: block.height } : {}),
      });
      widgets.push(w);
      y += w.h;
      continue;
    }
    run.push(block);
  }
  flush();
  if (widgets.length === 0) return blankPageLayout(pageId);
  return { version: 1, cols: GRID.cols, widgets: compactLayout(widgets) };
}

/** The inverse of `pageLayoutFromBody` for a converted layout — the blocks
 *  in reading order. Instances that are not text/image contribute nothing. */
export function blocksFromPageLayout(layout: SiteLayout): PageBlock[] {
  const out: PageBlock[] = [];
  const ordered = [...layout.widgets].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const w of ordered) {
    if (w.key === 'text') {
      for (const b of parsePageBody((w.config as Record<string, unknown>).blocks)) out.push(b);
    } else if (w.key === 'image') {
      const c = w.config as Record<string, unknown>;
      if (typeof c.path === 'string' && ORG_IMAGE_PATH_RE.test(c.path)) {
        out.push({
          type: 'image',
          path: c.path,
          alt: typeof c.alt === 'string' ? c.alt : '',
          ...(typeof c.width === 'number' ? { width: c.width } : {}),
          ...(typeof c.height === 'number' ? { height: c.height } : {}),
        });
      }
    }
  }
  return out;
}

/** Every page layout minus the given module key (the `set_module` sweep). */
export function sweepModuleFromPages(pages: Record<string, SnapshotPage>, moduleKey: string): Record<string, SnapshotPage> {
  if (!(SITE_WIDGET_KEYS as readonly string[]).includes(moduleKey)) return pages;
  let changed = false;
  const out: Record<string, SnapshotPage> = {};
  for (const [id, page] of Object.entries(pages)) {
    const layout = parseStoredLayout(page.layout);
    if (!layout || !layout.widgets.some(w => w.key === moduleKey)) {
      out[id] = page;
      continue;
    }
    changed = true;
    out[id] = { ...page, layout: { ...layout, widgets: compactLayout(layout.widgets.filter(w => w.key !== moduleKey)) } };
  }
  return changed ? out : pages;
}
