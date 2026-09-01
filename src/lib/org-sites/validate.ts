/**
 * Org sites (155) — the PURE validation half (node-only vitest; no
 * framework or Supabase imports; the structure/validate.ts pattern).
 *
 * The subdomain is a DNS LABEL: [a-z0-9-], 3–63, no edge hyphens —
 * deliberately STRICTER than is_valid_handle (006 allows '.' and '_',
 * both illegal in DNS). slugifyOrgName is the minting half: org name →
 * candidate label; collision/reserved handling is the server lib's job.
 */

import { z } from 'zod';

export { isMissingTableError } from '@/lib/leagues/validate';

export const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
export const SUBDOMAIN_MIN = 3;
export const SUBDOMAIN_MAX = 63;

export function isValidSubdomain(value: string): boolean {
  return (
    value.length >= SUBDOMAIN_MIN &&
    value.length <= SUBDOMAIN_MAX &&
    SUBDOMAIN_RE.test(value)
  );
}

/** Org name → DNS-label candidate: lowercase, non-alphanumerics collapse
 *  to single hyphens, edges trimmed, padded to the 3-char floor. */
export function slugifyOrgName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SUBDOMAIN_MAX);
  const trimmed = base.replace(/-+$/g, '');
  if (trimmed.length >= SUBDOMAIN_MIN) return trimmed;
  return (trimmed + '-site').slice(0, SUBDOMAIN_MAX).replace(/^-+/, 'org-');
}

/** The nine module keys, in default render order. Page slugs must never
 *  collide with these (the /org/{slug}/{page} route shadow rule). */
export const MODULE_KEYS = [
  'hero',
  'standings',
  'schedule',
  'teams',
  'staff',
  'venues',
  'affiliations',
  'sponsors',
  'contact',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Every module except hero can be toggled from the console (hero is the
 *  site's identity — excluded at the SCHEMA level, not just the UI). */
export const TOGGLEABLE_MODULE_KEYS = [
  'standings',
  'schedule',
  'teams',
  'staff',
  'venues',
  'affiliations',
  'sponsors',
  'contact',
] as const;
export type ToggleableModuleKey = (typeof TOGGLEABLE_MODULE_KEYS)[number];

// ── Branding primitives (phase 3 R3) ────────────────────────────────────────

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** https-only external link, ≤200 chars. Pure (URL ctor), node-testable. */
export const httpsUrl = z
  .string()
  .trim()
  .max(200)
  .refine(v => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be an https:// link');

/** WCAG relative luminance of #rrggbb (0 = black, 1 = white). */
export function hexLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** The hero renders white text on the accent. L ≤ 0.30 guarantees the
 *  gradient's LIGHT end keeps ≥3:1 against white — WCAG AA for large
 *  text, which the hero h1 is. (R5 tightened this from 0.55, which was
 *  only a readability floor; the violet-500 default sits at L ≈ 0.198,
 *  i.e. 4.23:1 — the exact ratio a pre-launch WCAG audit once failed
 *  white-on-violet at, so the default clears its own bar with room.) */
export const ACCENT_MAX_LUMINANCE = 0.3;

/** #rrggbb → its darker companion (each channel ×0.85) — the gradient end
 *  and link color when a site sets a single accent. */
export function deriveStrongAccent(hex: string): string {
  const part = (i: number) =>
    Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * 0.85)
      .toString(16)
      .padStart(2, '0');
  return `#${part(0)}${part(1)}${part(2)}`;
}

/** Defensive render-side parse: unknown jsonb → validated accent or null.
 *  The strict hex check here is the inline-style injection defense — raw
 *  theme_token_set must never reach a style attribute. Never throws. */
export function parseThemeAccent(themeTokenSet: unknown): string | null {
  if (!themeTokenSet || typeof themeTokenSet !== 'object') return null;
  const accent = (themeTokenSet as Record<string, unknown>).accent;
  return typeof accent === 'string' && HEX_COLOR_RE.test(accent)
    ? accent.toLowerCase()
    : null;
}

export interface PublicHero {
  headline: string;
  tagline: string;
}

/** Defensive render-side parse: unknown hero_config jsonb → strings
 *  ('' = use the default). Never throws. */
export function parseHeroConfig(config: unknown): PublicHero {
  const record =
    config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
  return {
    headline: typeof record.headline === 'string' ? record.headline.slice(0, 80) : '',
    tagline: typeof record.tagline === 'string' ? record.tagline.slice(0, 140) : '',
  };
}

export interface PublicSponsor {
  name: string;
  url?: string;
}

/** Defensive render-side parse: unknown module config → clamped sponsor
 *  list (names as plain strings, urls re-checked https). Never throws. */
export function parseSponsors(config: unknown): PublicSponsor[] {
  if (!config || typeof config !== 'object') return [];
  const raw = (config as Record<string, unknown>).sponsors;
  if (!Array.isArray(raw)) return [];
  const out: PublicSponsor[] = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const name = (item as Record<string, unknown>).name;
    if (typeof name !== 'string' || !name.trim()) continue;
    const url = (item as Record<string, unknown>).url;
    const safeUrl =
      typeof url === 'string' && httpsUrl.safeParse(url).success ? url : undefined;
    out.push(safeUrl ? { name: name.slice(0, 80), url: safeUrl } : { name: name.slice(0, 80) });
  }
  return out;
}

const boundedTrimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform(v => (v ? v : undefined));

export const SitePatchSchema = z.union([
  z.object({ action: z.enum(['publish', 'unpublish']) }),
  z.object({
    action: z.literal('set_module'),
    moduleKey: z.enum(TOGGLEABLE_MODULE_KEYS),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal('set_hero'),
    headline: optionalTrimmed(80),
    tagline: optionalTrimmed(140),
  }),
  z.object({
    action: z.literal('set_theme'),
    accent: z
      .string()
      .regex(HEX_COLOR_RE, 'Must be a #rrggbb color')
      .refine(v => hexLuminance(v) <= ACCENT_MAX_LUMINANCE, 'Choose a darker color')
      .nullable(),
  }),
  z.object({
    action: z.literal('set_sponsors'),
    sponsors: z
      .array(z.object({ name: boundedTrimmed(80), url: httpsUrl.optional() }))
      .max(20),
  }),
]);
export type SitePatchInput = z.infer<typeof SitePatchSchema>;

/** Public section titles, shared by the site home, the layout nav, and
 *  the module subpages (hero deliberately absent — it has no heading). */
export const MODULE_TITLES: Record<string, string> = {
  standings: 'Standings',
  schedule: 'Schedule',
  teams: 'Teams',
  staff: 'Staff',
  venues: 'Venues',
  affiliations: 'Affiliations',
  sponsors: 'Sponsors',
  contact: 'Contact',
};

/** The module keys that have their own subpage under /org/{slug}/. */
export const MODULE_SUBPAGE_KEYS = ['standings', 'schedule', 'teams'] as const;

// ── Custom pages (phase 3 R3) ───────────────────────────────────────────────
// org_site_pages.body is an ORDERED BLOCK ARRAY (the masterplan's own
// recommendation). Slugs ride the same DNS-ish regex as subdomains but
// with no length floor (the DB CHECK), PLUS an app-side denylist so
// /org/{slug}/{page} can never shadow a module route or a future static
// surface — this enforces the R1 comment above MODULE_KEYS.

export const RESERVED_PAGE_SLUGS: ReadonlySet<string> = new Set([
  ...MODULE_KEYS,
  'assets',
  'site',
  'admin',
  'api',
  'p',
  'pages',
  'home',
  'index',
  // R4: Next metadata-route convention names — a page slug must never
  // shadow (or be shadowed by) the generated og/icon/robots routes.
  'opengraph-image',
  'twitter-image',
  'icon',
  'apple-icon',
  'robots',
  'sitemap',
]);
export const PAGE_SLUG_MAX = 80;
export const PAGES_PER_SITE_MAX = 20;

export function isValidPageSlug(slug: string): boolean {
  return (
    slug.length >= 1 &&
    slug.length <= PAGE_SLUG_MAX &&
    SUBDOMAIN_RE.test(slug) &&
    !RESERVED_PAGE_SLUGS.has(slug)
  );
}

/** Title → slug candidate: the slugifyOrgName pipeline without the
 *  3-char floor (a 1-char page slug is legal at the DB level). */
export function slugifyPageTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PAGE_SLUG_MAX)
    .replace(/-+$/g, '');
}

export const PAGE_BODY_MAX_BLOCKS = 40;
/** One filename segment of an org-media asset — the streamer's gate. */
export const ORG_MEDIA_FILE_RE = /^[a-z0-9-]{1,80}\.(jpg|jpeg|png|webp|gif)$/;
/** A full stored asset path: org-media/{siteId uuid}/{file}. */
export const ORG_MEDIA_PATH_RE =
  /^org-media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9-]{1,80}\.(jpg|jpeg|png|webp|gif)$/;

export const PageBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: boundedTrimmed(120) }),
  z.object({ type: z.literal('paragraph'), text: boundedTrimmed(2000) }),
  z.object({
    type: z.literal('image'),
    path: z.string().regex(ORG_MEDIA_PATH_RE, 'Not a site asset path'),
    alt: boundedTrimmed(200),
    // Intrinsic dimensions, measured client-side at upload (kills the
    // CLS placeholder tradeoff). Optional — pre-existing blocks lack them.
    width: z.number().int().positive().max(10000).optional(),
    height: z.number().int().positive().max(10000).optional(),
  }),
  z.object({
    type: z.literal('link-list'),
    links: z.array(z.object({ label: boundedTrimmed(80), url: httpsUrl })).min(1).max(20),
  }),
]);
export type PageBlock = z.infer<typeof PageBlockSchema>;
export const PageBodySchema = z.array(PageBlockSchema).max(PAGE_BODY_MAX_BLOCKS);

export const PageCreateSchema = z.object({
  title: boundedTrimmed(120),
  // Regex + denylist are enforced server-side via isValidPageSlug (the
  // schema alone can't express the denylist message usefully).
  slug: z.string().trim().toLowerCase().max(PAGE_SLUG_MAX).optional(),
});
export type PageCreateInput = z.infer<typeof PageCreateSchema>;

export const PagePatchSchema = z
  .object({
    title: boundedTrimmed(120).optional(),
    body: PageBodySchema.optional(),
    visibility: z.enum(['public', 'draft']).optional(),
  })
  .refine(
    o => o.title !== undefined || o.body !== undefined || o.visibility !== undefined,
    'Nothing to update'
  );
export type PagePatchInput = z.infer<typeof PagePatchSchema>;

/** Defensive render-side parse: unknown body jsonb → valid blocks only
 *  (drops anything malformed; never throws — the public-render rule). */
export function parsePageBody(body: unknown): PageBlock[] {
  if (!Array.isArray(body)) return [];
  const out: PageBlock[] = [];
  for (const block of body.slice(0, PAGE_BODY_MAX_BLOCKS)) {
    const parsed = PageBlockSchema.safeParse(block);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// ── Schedule query clamps (phase 3 R2) ──────────────────────────────────────
// The public schedule reads take caller-supplied limit/range params; both
// are clamped here (pure, node-testable) so no caller can turn the
// viewer-independent read into an unbounded scan.

export const SCHEDULE_LIMIT_DEFAULT = 10;
export const SCHEDULE_LIMIT_MAX = 50;
export const SCHEDULE_RANGE_MAX_DAYS = 365;

export interface ScheduleQuery {
  limit: number;
  rangeDays?: number;
}

function toInt(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? Math.floor(n) : null;
}

export function clampScheduleQuery(
  input: { limit?: unknown; rangeDays?: unknown } = {}
): ScheduleQuery {
  const limitRaw = toInt(input.limit);
  const limit =
    limitRaw === null
      ? SCHEDULE_LIMIT_DEFAULT
      : Math.min(Math.max(limitRaw, 1), SCHEDULE_LIMIT_MAX);
  const rangeRaw = toInt(input.rangeDays);
  if (rangeRaw === null) return { limit };
  return { limit, rangeDays: Math.min(Math.max(rangeRaw, 1), SCHEDULE_RANGE_MAX_DAYS) };
}
