import { describe, expect, it } from 'vitest';
import {
  buildEventsJsonLd,
  buildOrgJsonLd,
  buildTeamJsonLd,
  JSONLD_EVENTS_MAX,
  safeJsonLd,
} from '../jsonld';
import type { PublicSite } from '../server';
import type { OrgEvent } from '@/lib/calendar/org-events-server';

const baseSite = {
  id: '01234567-89ab-4cde-8f01-23456789abcd',
  league_id: 'l',
  club_id: null,
  subdomain: 'kanata-blazers',
  template_id: 'classic',
  theme_token_set: {},
  nav_config: [],
  logo_path: null,
  hero_config: {},
  contact_config: {},
  published_at: '2026-09-01T00:00:00Z',
  orgName: 'Kanata Blazers',
  side: 'league',
  orgId: 'l',
  orgCity: 'Ottawa',
  orgRegion: 'ON',
  orgCountry: 'CA',
  orgSportKey: 'ice_hockey',
  modules: [],
} as unknown as PublicSite;

describe('safeJsonLd', () => {
  it('escapes < so user text can never break out of the script block', () => {
    const out = safeJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</');
    expect(out).toContain('\\u003c/script');
  });
});

describe('buildOrgJsonLd', () => {
  it('builds a SportsOrganization with address and sport', () => {
    const ld = buildOrgJsonLd(baseSite);
    expect(ld['@type']).toBe('SportsOrganization');
    expect(ld.name).toBe('Kanata Blazers');
    expect(String(ld.url)).toMatch(/\/org\/kanata-blazers$/);
    expect(ld.sport).toBe('ice_hockey');
    expect(ld.address).toEqual({
      '@type': 'PostalAddress',
      addressLocality: 'Ottawa',
      addressRegion: 'ON',
      addressCountry: 'CA',
    });
    expect(ld.logo).toBeUndefined();
  });

  it('omits the whole address when geography is empty, and sport for clubs', () => {
    const ld = buildOrgJsonLd({
      ...baseSite,
      orgCity: null,
      orgRegion: null,
      orgCountry: null,
      orgSportKey: null,
    } as PublicSite);
    expect(ld.address).toBeUndefined();
    expect(ld.sport).toBeUndefined();
  });

  it('includes an absolute logo url when logo_path is set', () => {
    const ld = buildOrgJsonLd({
      ...baseSite,
      logo_path: `org-logos/${baseSite.id}/123.png`,
    } as PublicSite);
    expect(String(ld.logo)).toMatch(/^https?:\/\/.+\/api\/media\/org-logo\//);
  });
});

describe('buildTeamJsonLd', () => {
  it('builds a SportsTeam linked to its organization', () => {
    const ld = buildTeamJsonLd(baseSite, { id: 't1', name: 'Blazers U13' });
    expect(ld['@type']).toBe('SportsTeam');
    expect(String(ld.url)).toMatch(/\/org\/kanata-blazers\/teams\/t1$/);
    const memberOf = ld.memberOf as Record<string, unknown>;
    expect(memberOf['@type']).toBe('SportsOrganization');
    expect(memberOf.name).toBe('Kanata Blazers');
  });
});

describe('buildEventsJsonLd', () => {
  const event = (i: number): OrgEvent =>
    ({
      id: `e${i}`,
      title: `Game ${i}`,
      description: null,
      location: i % 2 ? 'Rink 1' : null,
      starts_at: '2026-09-12T22:30:00Z',
      ends_at: i % 2 ? '2026-09-12T23:30:00Z' : null,
      all_day: false,
      timezone: 'America/Toronto',
      category: 'game',
      venue_id: null,
      facility_id: null,
    }) as OrgEvent;

  it('maps events with location fallback to the org name, capped', () => {
    const ld = buildEventsJsonLd(
      baseSite,
      Array.from({ length: JSONLD_EVENTS_MAX + 5 }, (_, i) => event(i))
    );
    expect(ld).toHaveLength(JSONLD_EVENTS_MAX);
    expect(ld[1].location).toEqual({ '@type': 'Place', name: 'Rink 1' });
    expect(ld[0].location).toEqual({ '@type': 'Place', name: 'Kanata Blazers' });
    expect(ld[1].endDate).toBe('2026-09-12T23:30:00Z');
    expect(ld[0].endDate).toBeUndefined();
  });

  it('never emits people', () => {
    const out = JSON.stringify(buildEventsJsonLd(baseSite, [event(1)]));
    expect(out).not.toContain('Person');
    expect(out).not.toContain('athlete');
  });
});
