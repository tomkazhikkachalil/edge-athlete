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
import { TEMPLATE_IDS } from './templates';

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
  'news', // phase 3.5 (mig 156 widens the DB CHECK; pre-156 code degrades)
  'gallery', // phase 4 R5 (mig 160; consent-gated contest media)
  'register', // phase 5 R5 (mig 164; the registration CTA card)
  'courses', // phase 6b A2 (mig 169; the golf club's linked catalog courses)
  'divisions', // phase 6b B3 (mig 169 admitted it; teams grouped by division)
  'leaders', // phase 6b B3 (stat leaders from contest_stat_lines)
  'documents', // phase 6b B3 (PDFs in org-media + external links)
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** Keys newer than the 155 base CHECK, NEWEST LAST — siteCreatePOST's
 *  pre-migration 23514 retry strips them from the end until the insert
 *  fits the database it's talking to. */
export const POST_155_MODULE_KEYS = ['news', 'gallery', 'register', 'courses', 'divisions', 'leaders', 'documents'] as const;

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
  'news',
  'gallery',
  'register',
  'courses',
  'divisions',
  'leaders',
  'documents',
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

// ── Brand tokens (phase 6b B1) ──────────────────────────────────────────────
// The masterplan's token set, bounded for a LIGHT-ONLY site that loads no
// per-site fonts: accent (+ an explicit strong companion), a surface tint,
// a typeface pair of CSS STACKS, and a wordmark. `text`/`primary`/
// `secondary` are deliberately absent — a user-set text colour on white
// is a contrast liability, and the primaries collapse into the accents.

export const THEME_TYPEFACES = ['sans', 'serif'] as const;
export type ThemeTypeface = (typeof THEME_TYPEFACES)[number];
export const THEME_SURFACES = ['plain', 'tinted'] as const;
export type ThemeSurface = (typeof THEME_SURFACES)[number];
export const WORDMARK_MAX = 40;

export interface ThemeTokens {
  accent: string | null;
  /** The gradient end / link colour; null = deriveStrongAccent(accent). */
  accentStrong: string | null;
  surface: ThemeSurface;
  typeface: ThemeTypeface;
  /** Replaces the org name in the header + hero h1 only (never <title>). */
  wordmark: string | null;
}

/** Defensive render-side parse of the whole token set — every key is
 *  re-validated independently (the strict hex check is the inline-style
 *  injection defense; enums fall back to their defaults). Never throws. */
export function parseThemeTokens(themeTokenSet: unknown): ThemeTokens {
  const raw =
    themeTokenSet && typeof themeTokenSet === 'object'
      ? (themeTokenSet as Record<string, unknown>)
      : {};
  const hex = (v: unknown): string | null =>
    typeof v === 'string' && HEX_COLOR_RE.test(v) ? v.toLowerCase() : null;
  const wordmark =
    typeof raw.wordmark === 'string' && raw.wordmark.trim()
      ? raw.wordmark.trim().slice(0, WORDMARK_MAX)
      : null;
  return {
    accent: hex(raw.accent),
    accentStrong: hex(raw.accentStrong),
    surface: (THEME_SURFACES as readonly string[]).includes(raw.surface as string)
      ? (raw.surface as ThemeSurface)
      : 'plain',
    typeface: (THEME_TYPEFACES as readonly string[]).includes(raw.typeface as string)
      ? (raw.typeface as ThemeTypeface)
      : 'sans',
    wordmark,
  };
}

/** The strong accent a site actually renders with (explicit token, else
 *  the derived companion of the accent, else the violet default). */
export function resolveAccentPair(tokens: ThemeTokens): { accent: string; strong: string } {
  const accent = tokens.accent ?? '#8b5cf6';
  const strong = tokens.accentStrong ?? (tokens.accent ? deriveStrongAccent(tokens.accent) : '#7c3aed');
  return { accent, strong };
}

// ── Nav config (phase 6b B1 — nav_config comes alive) ───────────────────────
// `[{ key, label? }]` in DISPLAY ORDER over the toggleable modules. The
// server mirrors the order into org_site_modules.sort_order (per-row
// UPDATE, never upsert), so the home sections and the nav strip follow
// the same order; labels override MODULE_TITLES on the nav and the
// section headings. Unknown keys are dropped at render.

export const NAV_LABEL_MAX = 24;

export interface NavConfig {
  /** Module keys in display order (valid, deduped). */
  order: string[];
  labels: Record<string, string>;
}

export function parseNavConfig(navConfig: unknown): NavConfig {
  const order: string[] = [];
  const labels: Record<string, string> = {};
  if (!Array.isArray(navConfig)) return { order, labels };
  for (const item of navConfig) {
    if (!item || typeof item !== 'object') continue;
    const key = (item as Record<string, unknown>).key;
    if (typeof key !== 'string' || !(MODULE_KEYS as readonly string[]).includes(key)) continue;
    if (order.includes(key)) continue;
    order.push(key);
    const label = (item as Record<string, unknown>).label;
    if (typeof label === 'string' && label.trim()) labels[key] = label.trim().slice(0, NAV_LABEL_MAX);
  }
  return { order, labels };
}

/** Phase 6c G3 — Tom's principle 1: a CLUB page and a LEAGUE page answer
 *  different questions on different clocks, so their default module ORDER
 *  differs. A club leads with where you play (courses) and who runs
 *  leagues there; a league leads with the table and the schedule. Every
 *  MODULE_KEY appears exactly once per side (a test pins it). Managers
 *  still reorder freely (set_nav) and can come back here (reset_order). */
export const DEFAULT_MODULE_ORDER: Record<'league' | 'club', readonly ModuleKey[]> = {
  club: [
    'hero', 'courses', 'affiliations', 'schedule', 'standings', 'news', 'register',
    'teams', 'divisions', 'leaders', 'gallery', 'venues', 'staff', 'documents',
    'sponsors', 'contact',
  ],
  league: [
    'hero', 'standings', 'schedule', 'teams', 'divisions', 'affiliations', 'news',
    'register', 'leaders', 'gallery', 'venues', 'courses', 'staff', 'documents',
    'sponsors', 'contact',
  ],
};

/** Phase 7 C3 — the PGA shape (Tom): a GOLF org's page reads like a tour
 *  site — season standings, leaders, the week's play, news and media
 *  first; where you play, registration and the org's structure after.
 *  Keyed off the org's sport (clubs.primary_sport / leagues.sport_key —
 *  a golf club is NOT course-specific, so `courses` is a supporting
 *  section, not the lead). Chosen at site creation and by reset_order;
 *  managers still reorder freely. Every MODULE_KEY exactly once (pinned). */
export const GOLF_MODULE_ORDER: Record<'league' | 'club', readonly ModuleKey[]> = {
  club: [
    'hero', 'standings', 'leaders', 'schedule', 'news', 'gallery', 'courses',
    'register', 'affiliations', 'venues', 'teams', 'divisions', 'staff',
    'sponsors', 'documents', 'contact',
  ],
  league: [
    'hero', 'standings', 'leaders', 'schedule', 'news', 'gallery', 'register',
    'courses', 'affiliations', 'venues', 'teams', 'divisions', 'staff',
    'sponsors', 'documents', 'contact',
  ],
};

/** The recommended order for an org: its sport's shape when it has one. */
export function defaultModuleOrder(
  side: 'league' | 'club',
  sportKey?: string | null
): readonly ModuleKey[] {
  return sportKey === 'golf' ? GOLF_MODULE_ORDER[side] : DEFAULT_MODULE_ORDER[side];
}

/** The golf site's stock tagline — seeded into hero_config at creation
 *  (editable via set_hero) and the render fallback for golf sites made
 *  before C3. */
export const GOLF_TAGLINE = "Standings, leaderboards and the week's play — live.";

/** Side-aware default titles: the affiliations module reads "Leagues" on a
 *  club site and "Clubs" on a league site (the relationship seen from
 *  that page). Nav labels still override. */
const SIDE_TITLES: Record<'league' | 'club', Partial<Record<string, string>>> = {
  club: { affiliations: 'Leagues' },
  league: { affiliations: 'Clubs' },
};

/** Sport-aware default titles (C3): golf speaks tour — a season table, a
 *  leaders board, rounds rather than games. Above the side titles, below
 *  the nav labels. */
const SPORT_TITLES: Record<string, Partial<Record<string, string>>> = {
  golf: { standings: 'Season standings', leaders: 'Leaders', schedule: 'Rounds & events' },
};

/** The visible name of a module on the public site. */
export function moduleLabel(
  key: string,
  nav: NavConfig,
  side?: 'league' | 'club',
  sportKey?: string | null
): string {
  return (
    nav.labels[key] ??
    (sportKey ? SPORT_TITLES[sportKey]?.[key] : undefined) ??
    (side ? SIDE_TITLES[side][key] : undefined) ??
    MODULE_TITLES[key] ??
    key
  );
}

export interface PublicHero {
  headline: string;
  tagline: string;
  /** Phase 6e S1 — a golf club's front door: a photo (a site asset), one
   *  loud button ("Book a tee time"), and a notice ("Cart path only")
   *  that every page carries until a date. */
  imagePath?: string;
  imageAlt?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  notice?: string;
  noticeUntil?: string;
}

export const HERO_CTA_LABEL_MAX = 24;
export const HERO_NOTICE_MAX = 200;
export const HERO_IMAGE_ALT_MAX = 200;
/** YYYY-MM-DD (a DATE, compared as a string — no timezone). */
export const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Defensive render-side parse: unknown hero_config jsonb → strings
 *  ('' = use the default). Every S1 key is re-validated at render (the
 *  inline-attribute defense — never interpolate the raw jsonb); the CTA
 *  needs BOTH a label and an https URL or neither shows. Never throws. */
export function parseHeroConfig(config: unknown): PublicHero {
  const record =
    config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
  const out: PublicHero = {
    headline: typeof record.headline === 'string' ? record.headline.slice(0, 80) : '',
    tagline: typeof record.tagline === 'string' ? record.tagline.slice(0, 140) : '',
  };
  if (typeof record.imagePath === 'string' && ORG_IMAGE_PATH_RE.test(record.imagePath)) {
    out.imagePath = record.imagePath;
    if (typeof record.imageAlt === 'string' && record.imageAlt.trim()) {
      out.imageAlt = record.imageAlt.trim().slice(0, HERO_IMAGE_ALT_MAX);
    }
  }
  const ctaLabel =
    typeof record.ctaLabel === 'string' ? record.ctaLabel.trim().slice(0, HERO_CTA_LABEL_MAX) : '';
  const ctaUrl = typeof record.ctaUrl === 'string' ? record.ctaUrl : '';
  if (ctaLabel && httpsUrl.safeParse(ctaUrl).success) {
    out.ctaLabel = ctaLabel;
    out.ctaUrl = ctaUrl;
  }
  const notice = typeof record.notice === 'string' ? record.notice.trim().slice(0, HERO_NOTICE_MAX) : '';
  if (notice) {
    out.notice = notice;
    if (typeof record.noticeUntil === 'string' && ISO_DAY_RE.test(record.noticeUntil)) {
      out.noticeUntil = record.noticeUntil;
    }
  }
  return out;
}

/** Is the notice showing today? A notice with no end date shows until a
 *  manager clears it; with one, through that day inclusive. Pure, so the
 *  boundary is testable without a clock. */
export function noticeActive(hero: Pick<PublicHero, 'notice' | 'noticeUntil'>, today: string): boolean {
  if (!hero.notice) return false;
  if (!hero.noticeUntil) return true;
  return today <= hero.noticeUntil;
}

export interface PublicSponsor {
  name: string;
  url?: string;
  logoPath?: string;
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
    const logoPath = (item as Record<string, unknown>).logoPath;
    const safeLogo =
      typeof logoPath === 'string' && ORG_MEDIA_PATH_RE.test(logoPath) ? logoPath : undefined;
    out.push({
      name: name.slice(0, 80),
      ...(safeUrl ? { url: safeUrl } : {}),
      ...(safeLogo ? { logoPath: safeLogo } : {}),
    });
  }
  return out;
}

// ── Documents module (phase 6b B3) ──────────────────────────────────────────
export interface PublicDocument {
  title: string;
  /** A stored PDF under org-media/{siteId}/ — streamed by the org-media route. */
  path?: string;
  /** Or an external https link (policies hosted elsewhere). */
  url?: string;
}

/** Defensive render-side parse of the documents module config. */
export function parseDocuments(config: unknown): PublicDocument[] {
  if (!config || typeof config !== 'object') return [];
  const raw = (config as Record<string, unknown>).documents;
  if (!Array.isArray(raw)) return [];
  const out: PublicDocument[] = [];
  for (const item of raw.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const title = (item as Record<string, unknown>).title;
    if (typeof title !== 'string' || !title.trim()) continue;
    const path = (item as Record<string, unknown>).path;
    const url = (item as Record<string, unknown>).url;
    const safePath = typeof path === 'string' && ORG_DOCUMENT_PATH_RE.test(path) ? path : undefined;
    const safeUrl =
      !safePath && typeof url === 'string' && httpsUrl.safeParse(url).success ? url : undefined;
    if (!safePath && !safeUrl) continue;
    out.push({
      title: title.trim().slice(0, 80),
      ...(safePath ? { path: safePath } : {}),
      ...(safeUrl ? { url: safeUrl } : {}),
    });
  }
  return out;
}

export interface PublicContact {
  email?: string;
  phone?: string;
  website?: string;
  /** Phase 6e S1 — what a golf club's contact card actually needs. */
  address?: string[];
  hours?: string;
  directionsUrl?: string;
  social?: Partial<Record<SocialNetwork, string>>;
}

export const SOCIAL_NETWORKS = ['instagram', 'facebook', 'x', 'youtube'] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  youtube: 'YouTube',
};
/** A social link must point at THAT network's host (so JSON-LD `sameAs`
 *  stays honest and a manager can't turn "Instagram" into any link). */
export const SOCIAL_HOSTS: Record<SocialNetwork, string[]> = {
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  x: ['x.com', 'twitter.com'],
  youtube: ['youtube.com', 'youtu.be'],
};
export const CONTACT_ADDRESS_LINES = 3;
export const CONTACT_ADDRESS_LINE_MAX = 80;
export const CONTACT_HOURS_MAX = 200;

export function socialHostOk(network: SocialNetwork, url: string): boolean {
  if (!httpsUrl.safeParse(url).success) return false;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  return SOCIAL_HOSTS[network].some(h => host === h || host.endsWith(`.${h}`));
}

/** Where "Directions →" goes: an explicit link wins; else a maps search
 *  on the typed address; else nothing. Pure. */
export function directionsHref(contact: Pick<PublicContact, 'address' | 'directionsUrl'>): string | null {
  if (contact.directionsUrl) return contact.directionsUrl;
  const address = (contact.address ?? []).filter(Boolean).join(', ');
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Defensive render-side parse: unknown contact_config → the three
 *  optional fields, each re-validated. The email/phone here are
 *  DELIBERATELY public — manager-entered org contact info. Never throws. */
export function parseContact(config: unknown): PublicContact {
  if (!config || typeof config !== 'object') return {};
  const record = config as Record<string, unknown>;
  const out: PublicContact = {};
  if (typeof record.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(record.email)) {
    out.email = record.email.slice(0, 200);
  }
  if (typeof record.phone === 'string' && record.phone.trim().length >= 3) {
    out.phone = record.phone.trim().slice(0, 40);
  }
  if (typeof record.website === 'string' && httpsUrl.safeParse(record.website).success) {
    out.website = record.website;
  }
  // S1: address lines, hours, directions, socials — each re-validated.
  if (Array.isArray(record.address)) {
    const lines = record.address
      .filter((l): l is string => typeof l === 'string')
      .map(l => l.trim().slice(0, CONTACT_ADDRESS_LINE_MAX))
      .filter(Boolean)
      .slice(0, CONTACT_ADDRESS_LINES);
    if (lines.length) out.address = lines;
  }
  if (typeof record.hours === 'string' && record.hours.trim()) {
    out.hours = record.hours.trim().slice(0, CONTACT_HOURS_MAX);
  }
  if (typeof record.directionsUrl === 'string' && httpsUrl.safeParse(record.directionsUrl).success) {
    out.directionsUrl = record.directionsUrl;
  }
  if (record.social && typeof record.social === 'object') {
    const raw = record.social as Record<string, unknown>;
    const social: Partial<Record<SocialNetwork, string>> = {};
    for (const network of SOCIAL_NETWORKS) {
      const url = raw[network];
      if (typeof url === 'string' && socialHostOk(network, url)) social[network] = url;
    }
    if (Object.keys(social).length) out.social = social;
  }
  return out;
}

/** One filename segment of an org-media asset — the streamer's gate.
 *  (Declared here, above SitePatchSchema, which references the path RE
 *  at module-eval time — TDZ ordering matters.) */
export const ORG_MEDIA_FILE_RE = /^[a-z0-9-]{1,80}\.(jpg|jpeg|png|webp|gif|pdf)$/;
/** A full stored asset path: org-media/{siteId uuid}/{file}. */
export const ORG_MEDIA_PATH_RE =
  /^org-media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9-]{1,80}\.(jpg|jpeg|png|webp|gif|pdf)$/;
/** A stored PDF under the site's asset prefix (B3 documents). */
export const ORG_DOCUMENT_PATH_RE =
  /^org-media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9-]{1,80}\.pdf$/;
/** A stored IMAGE under the site's asset prefix (S1 hero photo, S2
 *  course photos) — ORG_MEDIA_PATH_RE admits pdf; a photo slot must not. */
export const ORG_IMAGE_PATH_RE =
  /^org-media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9-]{1,80}\.(jpg|jpeg|png|webp|gif)$/;

/** Phase 6e S2 — per-course photos ride the `courses` module's config:
 *  `{ photos: { [courseId]: { path, alt? } } }` (≤40 courses). */
export const COURSE_PHOTOS_MAX = 40;
const COURSE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface PublicCoursePhoto {
  path: string;
  alt?: string;
}
export function parseCoursePhotos(config: unknown): Record<string, PublicCoursePhoto> {
  const out: Record<string, PublicCoursePhoto> = {};
  const photos = (config as { photos?: unknown } | null)?.photos;
  if (!photos || typeof photos !== 'object') return out;
  for (const [courseId, raw] of Object.entries(photos as Record<string, unknown>)) {
    if (Object.keys(out).length >= COURSE_PHOTOS_MAX) break;
    if (!COURSE_ID_RE.test(courseId) || !raw || typeof raw !== 'object') continue;
    const { path, alt } = raw as { path?: unknown; alt?: unknown };
    if (typeof path !== 'string' || !ORG_IMAGE_PATH_RE.test(path)) continue;
    out[courseId] = {
      path,
      ...(typeof alt === 'string' && alt.trim() ? { alt: alt.trim().slice(0, HERO_IMAGE_ALT_MAX) } : {}),
    };
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
  z
    .object({
      action: z.literal('set_hero'),
      headline: optionalTrimmed(80),
      tagline: optionalTrimmed(140),
      // S1: a site IMAGE asset (server re-asserts THIS site's prefix), the
      // one CTA (label + https URL together or neither), the notice.
      imagePath: z.string().regex(ORG_IMAGE_PATH_RE, 'Not a site image').optional(),
      imageAlt: optionalTrimmed(HERO_IMAGE_ALT_MAX),
      ctaLabel: optionalTrimmed(HERO_CTA_LABEL_MAX),
      ctaUrl: httpsUrl.optional(),
      notice: optionalTrimmed(HERO_NOTICE_MAX),
      noticeUntil: z.string().regex(ISO_DAY_RE, 'YYYY-MM-DD').optional(),
    })
    .superRefine((val, ctx) => {
      if (!!val.ctaLabel !== !!val.ctaUrl) {
        ctx.addIssue({ code: 'custom', path: ['ctaUrl'], message: 'A button needs both a label and a link' });
      }
    }),
  z.object({
    action: z.literal('set_theme'),
    accent: z
      .string()
      .regex(HEX_COLOR_RE, 'Must be a #rrggbb color')
      .refine(v => hexLuminance(v) <= ACCENT_MAX_LUMINANCE, 'Choose a darker color')
      .nullable(),
    // Phase 6b B1 — the rest of the token set. Every key optional so the
    // R3 accent-only shape keeps working; the server replaces the whole
    // object from what the console sends (seeded from GET).
    accentStrong: z
      .string()
      .regex(HEX_COLOR_RE, 'Must be a #rrggbb color')
      .refine(v => hexLuminance(v) <= ACCENT_MAX_LUMINANCE, 'Choose a darker color')
      .nullable()
      .optional(),
    surface: z.enum(THEME_SURFACES).optional(),
    typeface: z.enum(THEME_TYPEFACES).optional(),
    wordmark: optionalTrimmed(WORDMARK_MAX),
  }),
  z.object({
    action: z.literal('set_template'),
    templateId: z.enum(TEMPLATE_IDS),
  }),
  z.object({ action: z.literal('reset_order') }),
  z.object({
    action: z.literal('set_nav'),
    items: z
      .array(
        z.object({
          key: z.enum(TOGGLEABLE_MODULE_KEYS),
          label: optionalTrimmed(NAV_LABEL_MAX),
        })
      )
      .max(20),
  }),
  z.object({
    action: z.literal('set_sponsors'),
    sponsors: z
      .array(
        z.object({
          name: boundedTrimmed(80),
          url: httpsUrl.optional(),
          // A site asset path; the server re-asserts THIS site's prefix
          // (the schema can't know the site id — the cross-site guard).
          logoPath: z.string().regex(ORG_MEDIA_PATH_RE, 'Not a site asset path').optional(),
        })
      )
      .max(20),
  }),
  z.object({
    action: z.literal('set_documents'),
    documents: z
      .array(
        z
          .object({
            title: boundedTrimmed(80),
            // A stored PDF (server re-asserts THIS site's prefix) OR an https link.
            path: z.string().regex(ORG_DOCUMENT_PATH_RE, 'Not a site document').optional(),
            url: httpsUrl.optional(),
          })
          .refine(d => !!d.path !== !!d.url, 'Provide a file or a link, not both')
      )
      .max(20),
  }),
  z.object({
    // S2: one course's photo on the `courses` module config (absent path
    // = remove). The server re-asserts THIS site's asset prefix.
    action: z.literal('set_course_photo'),
    courseId: z.string().regex(COURSE_ID_RE, 'Not a course id'),
    path: z.string().regex(ORG_IMAGE_PATH_RE, 'Not a site image').optional(),
    alt: optionalTrimmed(HERO_IMAGE_ALT_MAX),
  }),
  z.object({
    action: z.literal('set_contact'),
    email: z.string().trim().toLowerCase().max(200).pipe(z.email()).optional(),
    phone: z.string().trim().min(3).max(40).optional(),
    website: httpsUrl.optional(),
    // S1: the golf club's contact card.
    address: z.array(boundedTrimmed(CONTACT_ADDRESS_LINE_MAX)).max(CONTACT_ADDRESS_LINES).optional(),
    hours: optionalTrimmed(CONTACT_HOURS_MAX),
    directionsUrl: httpsUrl.optional(),
    social: z
      .object({
        instagram: httpsUrl.refine(v => socialHostOk('instagram', v), 'Not an Instagram link').optional(),
        facebook: httpsUrl.refine(v => socialHostOk('facebook', v), 'Not a Facebook link').optional(),
        x: httpsUrl.refine(v => socialHostOk('x', v), 'Not an X link').optional(),
        youtube: httpsUrl.refine(v => socialHostOk('youtube', v), 'Not a YouTube link').optional(),
      })
      .optional(),
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
  news: 'News',
  gallery: 'Gallery',
  register: 'Register',
  courses: 'Courses',
  divisions: 'Divisions',
  leaders: 'Stat leaders',
  documents: 'Documents',
};

/** The module keys that have their own subpage under /org/{slug}/.
 *  An entry must land WITH its route (a nav link must never precede its
 *  destination). */
export const MODULE_SUBPAGE_KEYS = [
  'news',
  'standings',
  'schedule',
  'teams',
  'gallery',
  'courses',
  'divisions',
  'leaders',
  'documents',
] as const;

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
  // Cleanup round: the draft-preview route family.
  'preview',
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

// ── News posts (phase 3.5, mig 156) ─────────────────────────────────────────
// Same block body as pages; published_at IS the draft/live state and the
// feed order. Slugs share the page regex + the reserved denylist.

export const NEWS_PER_SITE_MAX = 200;

export const NewsCreateSchema = z.object({
  title: boundedTrimmed(120),
  slug: z.string().trim().toLowerCase().max(PAGE_SLUG_MAX).optional(),
});
export type NewsCreateInput = z.infer<typeof NewsCreateSchema>;

export const NewsPatchSchema = z
  .object({
    title: boundedTrimmed(120).optional(),
    body: PageBodySchema.optional(),
    publish: z.boolean().optional(),
  })
  .refine(
    o => o.title !== undefined || o.body !== undefined || o.publish !== undefined,
    'Nothing to update'
  );
export type NewsPatchInput = z.infer<typeof NewsPatchSchema>;

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

// ── Custom domains (phase 6b C1) ────────────────────────────────────────────
// Normalization + reserve checks live in domains.ts (pure); the schema
// only bounds the raw text a manager pastes.
export const DomainClaimSchema = z.object({
  domain: z.string().trim().min(3).max(300),
});
export const AdminDomainActionSchema = z.object({
  siteId: z.uuid(),
  action: z.enum(['retry-attach', 'probe']),
});
