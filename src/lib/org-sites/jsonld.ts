// ── JSON-LD builders for the public org site (phase 3 R4) ───────────────────
// schema.org structured data, built as plain objects (no schema-dts dep).
// THE PEOPLE RULE: no Person, no roster, no staff — minors are never
// indexed (masterplan §SEO), so people stay out of structured data
// entirely this phase. Pure and node-testable.

import { orgLogoUrl } from '@/lib/media/org-site-media';
import type { OrgEvent } from '@/lib/calendar/org-events-server';
import type { PublicSite } from './server';
import { appBaseUrl } from './urls';

export const JSONLD_EVENTS_MAX = 10;

/** Serialize for a <script type="application/ld+json"> block. The `<`
 *  escape is the script-breakout defense — org names, event titles, and
 *  page text are USER TEXT and could contain `</script>`. */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function postalAddress(site: PublicSite): Record<string, unknown> | undefined {
  const address = {
    ...(site.orgCity ? { addressLocality: site.orgCity } : {}),
    ...(site.orgRegion ? { addressRegion: site.orgRegion } : {}),
    ...(site.orgCountry ? { addressCountry: site.orgCountry } : {}),
  };
  if (Object.keys(address).length === 0) return undefined;
  return { '@type': 'PostalAddress', ...address };
}

export function buildOrgJsonLd(site: PublicSite): Record<string, unknown> {
  const url = `${appBaseUrl()}/org/${site.subdomain}`;
  const logo = orgLogoUrl(site.id, site.logo_path);
  const address = postalAddress(site);
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsOrganization',
    name: site.orgName,
    url,
    ...(logo ? { logo: `${appBaseUrl()}${logo}` } : {}),
    ...(address ? { address } : {}),
    ...(site.orgSportKey ? { sport: site.orgSportKey } : {}),
  };
}

export function buildTeamJsonLd(
  site: PublicSite,
  team: { id: string; name: string }
): Record<string, unknown> {
  const orgUrl = `${appBaseUrl()}/org/${site.subdomain}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name: team.name,
    url: `${orgUrl}/teams/${team.id}`,
    ...(site.orgSportKey ? { sport: site.orgSportKey } : {}),
    memberOf: {
      '@type': 'SportsOrganization',
      name: site.orgName,
      url: orgUrl,
    },
  };
}

export function buildEventsJsonLd(
  site: PublicSite,
  events: OrgEvent[]
): Record<string, unknown>[] {
  return events.slice(0, JSONLD_EVENTS_MAX).map(e => ({
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: e.title,
    startDate: e.starts_at,
    ...(e.ends_at ? { endDate: e.ends_at } : {}),
    location: {
      '@type': 'Place',
      name: e.location || site.orgName,
    },
  }));
}
