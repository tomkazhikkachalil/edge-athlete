import Image from 'next/image';
import Link from 'next/link';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import type { OrgEvent } from '@/lib/calendar/org-events-server';
import type { PublicStandingsPayload } from '@/lib/competitions/public-standings';
import type { PublicSite } from '@/lib/org-sites/server';
import type { PublicOpenWindow } from '@/lib/org-sites/public-data';
import type {
  PublicAffiliation,
  PublicClubGolfBoard,
  PublicCourse,
  PublicDivision,
  PublicLeaderBoard,
  PublicStaffRow,
  PublicTeam,
  PublicVenue,
} from '@/lib/org-sites/public-data';
import {
  GOLF_TAGLINE,
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
import PublicStandingsTable from '@/components/standings/PublicStandingsTable';
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
import { appBaseUrl, siteBasePath } from '@/lib/org-sites/urls';
import { FULL_WIDTH_MODULES, templateSpec } from '@/lib/org-sites/templates';
import type { CourseStats } from '@/lib/golf/course-stats';
import type { PublicGolfRound } from '@/lib/org-sites/public-data';
import GolfRoundsSchedule from './GolfRoundsSchedule';
import { courseRecordLine } from './CourseStatsCard';

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
  /** Phase 6c G3 — a CLUB page's golf boards (own + affiliated leagues'). */
  clubGolfBoards?: PublicClubGolfBoard[];
  /** Phase 6e S3 — the club's courses fill themselves from members' public rounds. */
  courseStrip?: CourseStats | null;
  /** Phase 6e S4 — a golf league's play windows on the schedule. */
  golfRounds?: PublicGolfRound[];
}

export default function SiteHomeBody({
  site,
  data,
}: {
  site: PublicSite;
  data: SiteHomeData;
}) {
  const { standings, events, teams, staff, venues, affiliations, openWindows, courses, divisions, leaders } = data;
  const clubGolfBoards = data.clubGolfBoards ?? [];
  const enabled = site.modules.filter(m => m.enabled);
  const has = (key: string) => enabled.some(m => m.module_key === key);
  const hero = parseHeroConfig(site.hero_config);
  const heroImage = orgMediaUrl(site.id, hero.imagePath);
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
        return <StandingsPreview standings={standings} basePath={siteBasePath(site)} />;
      case 'schedule': {
        const golfRounds = data.golfRounds ?? [];
        const hasEvents = !!events && events.length > 0;
        if (!hasEvents && golfRounds.length === 0) return empty('No upcoming events.');
        return (
          <>
            {/* S4: a golf league's season leads — the rounds, then the events. */}
            {golfRounds.length > 0 && <GolfRoundsSchedule rounds={golfRounds} compact />}
            {hasEvents && <ScheduleList events={events!.slice(0, 5)} />}
            <Link
              href={`${siteBasePath(site)}/schedule`}
              className="mt-3 inline-block text-sm text-brand-fg font-medium"
            >
              Full schedule →
            </Link>
          </>
        );
      }
      case 'teams':
        return teams.length > 0 ? (
          <>
            <TeamsList teams={teams.slice(0, 12)} basePath={siteBasePath(site)} variant={spec.teams} />
            <Link
              href={`${siteBasePath(site)}/teams`}
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
        return (
          <>
            {courses.length > 0 ? (
              <CoursesList courses={courses} detailed={false} basePath={siteBasePath(site)} />
            ) : (
              empty('No courses listed yet.')
            )}
            {/* S3: the page fills itself — members' public rounds at the club's
                courses (record + count); the detail lives on each course page. */}
            {data.courseStrip && data.courseStrip.roundsPosted > 0 && (
              <p className="mt-3 text-sm text-secondary" aria-label="Rounds at the club">
                <span className="font-medium text-primary">
                  {`${data.courseStrip.roundsPosted} ${data.courseStrip.roundsPosted === 1 ? 'round' : 'rounds'} posted this year`}
                </span>
                {courseRecordLine(data.courseStrip) ? (
                  <span className="text-muted">{` · ${courseRecordLine(data.courseStrip)}`}</span>
                ) : null}
              </p>
            )}
            {/* G3: "this week at the club" — the leagues playing here. */}
            {clubGolfBoards.length > 0 && (
              <div className="mt-5 space-y-4">
                <h3 className="text-sm font-semibold text-primary">This week at {brandName}</h3>
                {clubGolfBoards.map(b => (
                  <div key={b.competition.id}>
                    {b.orgName !== site.orgName && (
                      <p className="mb-1 text-xs text-tertiary">{b.orgName}</p>
                    )}
                    <PublicStandingsTable competition={b.competition} />
                  </div>
                ))}
              </div>
            )}
          </>
        );
      case 'divisions':
        return divisions.length > 0 ? (
          <DivisionsList divisions={divisions} basePath={siteBasePath(site)} detailed={false} />
        ) : (
          empty('No divisions this season.')
        );
      case 'leaders':
        return leaders.length > 0 ? (
          <LeadersTable boards={leaders} basePath={siteBasePath(site)} detailed={false} />
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
            basePath={siteBasePath(site)}
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
            href={`${siteBasePath(site)}/gallery`}
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
          className={`relative overflow-hidden ${
            spec.hero === 'bleed'
              ? '-mx-4 px-6 py-14 sm:py-20 text-white'
              : 'rounded-xl px-6 py-10 text-white'
          }${heroImage ? ' min-h-[240px] sm:min-h-[320px] flex flex-col justify-end' : ''}`}
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--org-accent), var(--org-accent-strong))',
          }}
        >
          {/* S1: the club's photo (a site asset through the tokenless
              streamer — /api/media/* is never optimizer-eligible, so
              unoptimized is mandatory) under a translucent accent wash
              that keeps the white text legible on any photo. */}
          {heroImage && (
            <>
              <Image
                src={heroImage}
                alt={hero.imageAlt ?? ''}
                fill
                unoptimized
                sizes="100vw"
                className="object-cover"
                priority
              />
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    'linear-gradient(to top, var(--org-accent-strong) 0%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.15) 100%)',
                }}
              />
            </>
          )}
          <div className="relative">
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
              {hero.tagline || (site.sportKey === 'golf' ? GOLF_TAGLINE : 'Schedules, standings, and teams — live.')}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {hero.ctaLabel && hero.ctaUrl && (
                <a
                  href={hero.ctaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-md bg-white/95 px-4 py-2 text-sm font-semibold shadow-sm"
                  style={{ color: 'var(--org-accent-strong)' }}
                >
                  {hero.ctaLabel}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              )}
              {/* Phase 9 V3: the join door — the app's account-first join page
                  (an absolute app URL: a custom domain must not swallow it). */}
              {site.side === 'club' && (
                <a
                  href={`${appBaseUrl()}/join/club/${site.orgId}`}
                  className="inline-block rounded-md border border-white/80 px-4 py-2 text-sm font-semibold text-white"
                  data-join-door="1"
                >
                  {`Join ${brandName}`}
                </a>
              )}
            </div>
          </div>
        </section>
      )}
      <div className={spec.sections === 'grid' ? 'grid gap-6 sm:grid-cols-2' : 'space-y-6'}>
        {enabled
          .filter(m => m.module_key !== 'hero')
          .map(m => (
            <section
              key={m.module_key}
              aria-label={moduleLabel(m.module_key, nav, site.side, site.sportKey)}
              className={`${sectionClass} ${
                spec.sections === 'grid' && FULL_WIDTH_MODULES.has(m.module_key) ? 'sm:col-span-2' : ''
              }`}
            >
              <h2 className={headingClass}>{moduleLabel(m.module_key, nav, site.side, site.sportKey)}</h2>
              {moduleBody(m.module_key)}
            </section>
          ))}
      </div>
    </div>
  );
}
