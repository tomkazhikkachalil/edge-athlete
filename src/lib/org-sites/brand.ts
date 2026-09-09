import { parseHeroConfig, parseThemeTokens, resolveAccentPair } from './validate';
import { orgLogoUrl, orgMediaUrl } from '@/lib/media/org-site-media';
import { APP_SURFACE_DARK, APP_SURFACE_LIGHT, readableOn } from './accent-contrast';
import type { OrgBrand } from './brand-types';

export type { OrgBrand } from './brand-types';

/** The six org_sites columns the brand needs (readSiteBrandRow selects them). */
export interface SiteBrandRow {
  id: string;
  subdomain: string;
  logo_path: string | null;
  hero_config: unknown;
  theme_token_set: unknown;
  published_at: string | null;
}

/**
 * Pure: a site row → the in-app brand payload. Every path goes through the
 * same re-asserting URL helpers the public site uses (a hero path outside
 * org-media/{siteId}/ reads as no image); every hex through parseThemeTokens
 * (the inline-style injection defense). `accent` is null when the site sets
 * no accent tokens — the same test the public layout applies — so a
 * default-themed org keeps the app palette rather than a violet copy of it.
 */
export function buildOrgBrand(row: SiteBrandRow | null): OrgBrand | null {
  if (!row) return null;
  const hero = parseHeroConfig(row.hero_config);
  const tokens = parseThemeTokens(row.theme_token_set);
  const hasAccent = !!(tokens.accent || tokens.accentStrong);
  const pair = resolveAccentPair(tokens);
  return {
    siteId: row.id,
    subdomain: row.subdomain,
    published: !!row.published_at,
    logoUrl: orgLogoUrl(row.id, row.logo_path),
    hero: {
      imageUrl: orgMediaUrl(row.id, hero.imagePath),
      imageAlt: hero.imageAlt ?? '',
      headline: hero.headline,
      tagline: hero.tagline,
    },
    accent: hasAccent
      ? {
          fill: pair.accent,
          fillStrong: pair.strong,
          fgLight: readableOn(pair.strong, APP_SURFACE_LIGHT) ?? pair.strong,
          fgDark: readableOn(pair.accent, APP_SURFACE_DARK) ?? pair.accent,
        }
      : null,
  };
}
