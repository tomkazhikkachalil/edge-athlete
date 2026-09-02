import Link from 'next/link';
import type { OrgEvent } from '@/lib/calendar/org-events-server';
import type { PublicStandingsPayload } from '@/lib/competitions/public-standings';
import type { PublicSite } from '@/lib/org-sites/server';
import type { PublicOpenWindow } from '@/lib/org-sites/public-data';
import type {
  PublicAffiliation,
  PublicCourse,
  PublicDivision,
  PublicLeaderBoard,
  PublicStaffRow,
  PublicTeam,
  PublicVenue,
} from '@/lib/org-sites/public-data';
import {
  moduleLabel,
  parseContact,
  parseDocuments,
  parseHeroConfig,
  parseNavConfig,
  parseSponsors,
  parseThemeTokens,
} from '@/lib/org-sites/validate';
import AffiliationsList from './AffiliationsList';
import ContactCard from './ContactCard';
import CoursesList from './CoursesList';
import DivisionsList from './DivisionsList';
import DocumentsList from './DocumentsList';
import LeadersTable from './LeadersTable';
import RegisterCard from './RegisterCard';
import ScheduleList from './ScheduleList';
import SponsorsList from './SponsorsList';
import StaffList from './StaffList';
import StandingsPreview from './StandingsPreview';
import TeamsList from './TeamsList';
import VenuesList from './VenuesList';
import { orgSitePath } from '@/lib/org-sites/urls';
import { FULL_WIDTH_MODULES, templateSpec } from '@/lib/org-sites/templates';

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
  /** Phase 6b A2 — the golf club's linked catalog courses. */
  courses: PublicCourse[];
  /** Phase 6b B3 — divisions + stat leaders (documents ride module config). */
  divisions: PublicDivision[];
  leaders: PublicLeaderBoard[];
}

export default function SiteHomeBody({
  site,
  data,
}: {
  site: PublicSite;
  data: SiteHomeData;
}) {
  const { standings, events, teams, staff, venues, affiliations, openWindows, courses, divisions, leaders } = data;
  const enabled = site.modules.filter(m => m.enabled);
  const has = (key: string) => enabled.some(m => m.module_key === key);
  const hero = parseHeroConfig(site.hero_config);
  // B1: label overrides + wordmark (the header/hero name, never <title>).
  const nav = parseNavConfig(site.nav_config);
  const brandName = parseThemeTokens(site.theme_token_set).wordmark ?? site.orgName;
  // B2: the template's render decisions (classic = the shipped markup).
  const spec = templateSpec(site.template_id);
  const compact = spec.density === 'compact';
  const sectionClass = `bg-surface rounded-lg shadow-sm border border-border ${
    compact ? 'p-3 sm:p-4' : 'p-4 sm:p-6'
  }`;
  const headingClass = compact
    ? 'text-sm font-semibold uppercase tracking-wide text-secondary'
    : 'text-lg font-semibold text-primary';

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
              href={`${orgSitePath(site.subdomain)}/schedule`}
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
            <TeamsList teams={teams.slice(0, 12)} slug={site.subdomain} variant={spec.teams} />
            <Link
              href={`${orgSitePath(site.subdomain)}/teams`}
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
      case 'courses':
        return courses.length > 0 ? (
          <CoursesList courses={courses} detailed={false} basePath={orgSitePath(site.subdomain)} />
        ) : (
          empty('No courses listed yet.')
        );
      case 'divisions':
        return divisions.length > 0 ? (
          <DivisionsList divisions={divisions} basePath={orgSitePath(site.subdomain)} detailed={false} />
        ) : (
          empty('No divisions this season.')
        );
      case 'leaders':
        return leaders.length > 0 ? (
          <LeadersTable boards={leaders} basePath={orgSitePath(site.subdomain)} detailed={false} />
        ) : (
          empty('No stats recorded yet.')
        );
      case 'documents': {
        const documents = parseDocuments(
          site.modules.find(m => m.module_key === 'documents')?.config
        );
        return documents.length > 0 ? (
          <DocumentsList
            documents={documents}
            siteId={site.id}
            basePath={orgSitePath(site.subdomain)}
            detailed={false}
          />
        ) : (
          empty('No documents yet.')
        );
      }
      case 'gallery':
        // The gallery is a subpage module — the home section is a teaser
        // (it used to fall to the default "Coming soon.").
        return (
          <Link
            href={`${orgSitePath(site.subdomain)}/gallery`}
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
          className={
            spec.hero === 'bleed'
              ? '-mx-4 px-6 py-14 sm:py-20 text-white'
              : 'rounded-xl px-6 py-10 text-white'
          }
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--org-accent), var(--org-accent-strong))',
          }}
        >
          <h1
            className={
              spec.hero === 'bleed'
                ? 'text-3xl sm:text-5xl font-extrabold uppercase tracking-tight'
                : 'text-2xl sm:text-3xl font-bold'
            }
          >
            {hero.headline || brandName}
          </h1>
          <p className={spec.hero === 'bleed' ? 'mt-2 text-base opacity-90' : 'mt-1 text-sm opacity-90'}>
            {hero.tagline || 'Schedules, standings, and teams — live.'}
          </p>
        </section>
      )}
      <div className={spec.sections === 'grid' ? 'grid gap-6 sm:grid-cols-2' : 'space-y-6'}>
        {enabled
          .filter(m => m.module_key !== 'hero')
          .map(m => (
            <section
              key={m.module_key}
              aria-label={moduleLabel(m.module_key, nav)}
              className={`${sectionClass} ${
                spec.sections === 'grid' && FULL_WIDTH_MODULES.has(m.module_key) ? 'sm:col-span-2' : ''
              }`}
            >
              <h2 className={headingClass}>{moduleLabel(m.module_key, nav)}</h2>
              {moduleBody(m.module_key)}
            </section>
          ))}
      </div>
    </div>
  );
}
