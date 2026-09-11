/**
 * The public head — program 2, C (Sep 11 2026). ONE builder for the home,
 * the module subpages that want it, and the custom pages, across both route
 * trees: the manager's SEO config (title, description, social image) with
 * the platform's defaults as fallbacks, and the site icon (the chosen icon
 * token, else the uploaded logo, else the generated favicon). Pure and
 * node-tested; the routes only spread the result into Next's Metadata.
 */
import { orgLogoUrl, orgMediaUrl } from '@/lib/media/org-site-media';
import { parseSeoConfig, parseThemeTokens } from './validate';
import { siteAbsoluteUrl, siteBasePath } from './urls';

export interface MetadataSite {
  id: string;
  orgName: string;
  subdomain: string;
  custom_domain?: string | null;
  domain_active_at?: string | null;
  logo_path?: string | null;
  theme_token_set: unknown;
  seo_config?: unknown;
}

export interface SiteHead {
  title: string;
  description: string;
  canonical: string;
  /** The social image (absolute for card.png, the streamer path for an upload — metadataBase resolves it). */
  image: string;
  /** The icon href (the streamer path or the generated favicon). */
  icon: string;
}

export function siteHead(site: MetadataSite, page?: { title: string; slug: string; description?: string | null }): SiteHead {
  const seo = parseSeoConfig(site.seo_config);
  const tokens = parseThemeTokens(site.theme_token_set);
  const siteTitle = seo.title ?? site.orgName;
  const base = siteAbsoluteUrl(site);
  const title = page ? `${page.title} — ${siteTitle}` : siteTitle;
  const description = page
    ? (page.description ?? `${page.title} — ${site.orgName} on Edge Athlete.`)
    : (seo.description ?? `${site.orgName} on Edge Athlete — schedule, standings, and teams.`);
  const canonical = page ? `${base}/${page.slug}` : base;
  const image = orgMediaUrl(site.id, seo.imagePath) ?? `${base}/card.png`;
  const icon = orgMediaUrl(site.id, tokens.iconPath) ?? orgLogoUrl(site.id, site.logo_path) ?? `${siteBasePath(site)}/favicon.svg`;
  return { title, description, canonical, image, icon };
}
