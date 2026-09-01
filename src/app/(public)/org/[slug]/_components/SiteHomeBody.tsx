import Link from 'next/link';
import type { OrgEvent } from '@/lib/calendar/org-events-server';
import type { PublicStandingsPayload } from '@/lib/competitions/public-standings';
import type { PublicSite } from '@/lib/org-sites/server';
import type { PublicOpenWindow } from '@/lib/org-sites/public-data';
import type {
  PublicAffiliation,
  PublicStaffRow,
  PublicTeam,
  PublicVenue,
} from '@/lib/org-sites/public-data';
import {
  MODULE_TITLES,
  parseContact,
  parseHeroConfig,
  parseSponsors,
} from '@/lib/org-sites/validate';
import AffiliationsList from './AffiliationsList';
import ContactCard from './ContactCard';
import RegisterCard from './RegisterCard';
import ScheduleList from './ScheduleList';
import SponsorsList from './SponsorsList';
import StaffList from './StaffList';
import StandingsPreview from './StandingsPreview';
import TeamsList from './TeamsList';
import VenuesList from './VenuesList';

// The site home's module rendering, extracted (cleanup round) so the
// PUBLISHED home page and the token-gated draft PREVIEW render the exact
// same markup from different data paths (cached vs raw). Props-only,
// server-safe — the public-segment component contract.
export interface SiteHomeData {
  standings: PublicStandingsPayload | null;
  events: OrgEvent[] | null;
  teams: PublicTeam[];
  staff: PublicStaffRow[];
  venues: PublicVenue[];
  affiliations: PublicAffiliation[];
  /** Phase 5 R5 — open registration windows (empty = card says closed). */
  openWindows: PublicOpenWindow[];
}

export default function SiteHomeBody({
  site,
  data,
}: {
  site: PublicSite;
  data: SiteHomeData;
}) {
  const { standings, events, teams, staff, venues, affiliations, openWindows } = data;
  const enabled = site.modules.filter(m => m.enabled);
  const has = (key: string) => enabled.some(m => m.module_key === key);
  const hero = parseHeroConfig(site.hero_config);

  const empty = (text: string) => <p className="mt-1 text-sm text-tertiary">{text}</p>;

  const moduleBody = (key: string) => {
    switch (key) {
      case 'standings':
        return <StandingsPreview standings={standings} slug={site.subdomain} />;
      case 'schedule':
        return events && events.length > 0 ? (
          <>
            <ScheduleList events={events.slice(0, 5)} />
            <Link
              href={`/org/${site.subdomain}/schedule`}
              className="mt-3 inline-block text-sm text-brand-fg font-medium"
            >
              Full schedule →
            </Link>
          </>
        ) : (
          empty('No upcoming events.')
        );
      case 'teams':
        return teams.length > 0 ? (
          <>
            <TeamsList teams={teams.slice(0, 12)} slug={site.subdomain} />
            <Link
              href={`/org/${site.subdomain}/teams`}
              className="mt-3 inline-block text-sm text-brand-fg font-medium"
            >
              All teams →
            </Link>
          </>
        ) : (
          empty('No teams yet.')
        );
      case 'staff':
        return staff.length > 0 ? <StaffList staff={staff} /> : empty('No staff listed yet.');
      case 'venues':
        return venues.length > 0 ? <VenuesList venues={venues} /> : empty('No venues listed yet.');
      case 'affiliations':
        return affiliations.length > 0 ? (
          <AffiliationsList affiliations={affiliations} />
        ) : (
          empty('No affiliations yet.')
        );
      case 'sponsors': {
        const sponsors = parseSponsors(
          site.modules.find(m => m.module_key === 'sponsors')?.config
        );
        return sponsors.length > 0 ? (
          <SponsorsList sponsors={sponsors} siteId={site.id} />
        ) : (
          empty('No sponsors yet.')
        );
      }
      case 'register':
        return openWindows.length > 0 ? (
          <RegisterCard windows={openWindows} side={site.side} orgId={site.orgId} />
        ) : (
          empty('Registration is currently closed.')
        );
      case 'gallery':
        // The gallery is a subpage module — the home section is a teaser
        // (it used to fall to the default "Coming soon.").
        return (
          <Link
            href={`/org/${site.subdomain}/gallery`}
            className="mt-2 inline-block text-sm text-brand-fg font-medium"
          >
            View the gallery →
          </Link>
        );
      case 'contact': {
        const contact = parseContact(site.contact_config);
        return Object.keys(contact).length > 0 ? (
          <ContactCard contact={contact} />
        ) : (
          empty('No contact details yet.')
        );
      }
      default:
        return empty('Coming soon.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* R5 a11y: the visible h1 lives in the hero — a hero-disabled site
          (DB-level state; the console can't toggle hero) must still open
          its outline at level 1. */}
      {!has('hero') && <h1 className="sr-only">{site.orgName}</h1>}
      {has('hero') && (
        // The gradient rides the .org-scope accent vars (violet defaults; a
        // site's theme_token_set overrides via the layout's inline style).
        <section
          aria-label="Welcome"
          className="rounded-xl px-6 py-10 text-white"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--org-accent), var(--org-accent-strong))',
          }}
        >
          <h1 className="text-2xl sm:text-3xl font-bold">{hero.headline || site.orgName}</h1>
          <p className="mt-1 text-sm opacity-90">
            {hero.tagline || 'Schedules, standings, and teams — live.'}
          </p>
        </section>
      )}
      {enabled
        .filter(m => m.module_key !== 'hero')
        .map(m => (
          <section
            key={m.module_key}
            aria-label={MODULE_TITLES[m.module_key] ?? m.module_key}
            className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
          >
            <h2 className="text-lg font-semibold text-primary">
              {MODULE_TITLES[m.module_key] ?? m.module_key}
            </h2>
            {moduleBody(m.module_key)}
          </section>
        ))}
    </div>
  );
}
