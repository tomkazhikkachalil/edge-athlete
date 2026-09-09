import Link from 'next/link';
import type { PublicSite } from '@/lib/org-sites/server';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import type { WebWidgetKey } from '@/lib/site-builder/catalog';
import type { WidgetInstance } from '@/lib/site-builder/layout';
import { moduleLabel, parseContact, parseDocuments, parseNavConfig, parseSponsors, parseThemeTokens } from '@/lib/org-sites/validate';
import type { TemplateSpec } from '@/lib/org-sites/templates';
import { effectiveConfig, instanceTitle } from '@/lib/site-builder/config';
import { siteBasePath } from '@/lib/org-sites/urls';
import PublicStandingsTable from '@/components/standings/PublicStandingsTable';
import AffiliationsList from './AffiliationsList';
import ContactCard from './ContactCard';
import CoursesList from './CoursesList';
import DivisionsList from './DivisionsList';
import DocumentsList from './DocumentsList';
import GolfRoundsSchedule from './GolfRoundsSchedule';
import LeadersTable from './LeadersTable';
import MembersOnlyPanel from './MembersOnlyPanel';
import MembersTable from './MembersTable';
import NewsItems from './NewsItems';
import RegisterCard from './RegisterCard';
import ScheduleList from './ScheduleList';
import SponsorsList from './SponsorsList';
import StaffList from './StaffList';
import StandingsPreview from './StandingsPreview';
import TeamsList from './TeamsList';
import VenuesList from './VenuesList';
import { courseRecordLine } from './CourseStatsCard';

// One widget's body — Site Builder P3-B (Sep 9 2026). Extracted verbatim
// from SiteHomeBody's moduleBody switch so the PUBLISHED home, the draft
// PREVIEW and the editor CANVAS render a widget from the same code. Props-
// only and server-safe (guardrail §4b): the data arrives resolved; the
// heading is the frame's (SiteHomeBody / the canvas), not this component's.

export interface WidgetBodyProps {
  site: PublicSite;
  w: WidgetInstance;
  data: SiteHomeData;
  spec: TemplateSpec;
}

/** The section title for a widget — the INSTANCE's title (phase 5), else
 *  the nav label override, else the sport/side-aware module title. */
export function widgetTitle(site: PublicSite, w: WidgetInstance): string {
  return instanceTitle(w) ?? moduleLabel(w.key, parseNavConfig(site.nav_config), site.side, site.sportKey);
}

export default function WidgetBody({ site, w, data, spec }: WidgetBodyProps) {
  // Phase 5: content from the org objects over the instance's options.
  const config = effectiveConfig(site, w);
  const { standings, events, teams, staff, venues, affiliations, openWindows, courses, divisions, leaders } = data;
  const clubGolfBoards = data.clubGolfBoards ?? [];
  const brandName = parseThemeTokens(site.theme_token_set).wordmark ?? site.orgName;
  const empty = (text: string) => <p className="mt-1 text-sm text-tertiary">{text}</p>;
  const key = w.key as Exclude<WebWidgetKey, 'hero'>;
  // Phase 9 V4: a private club's members-only modules become the panel
  // (the instance's visibility carries isMembersOnly — deriveLegacyLayout).
  if (w.visibility === 'members') return <MembersOnlyPanel site={site} />;
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
      const sponsors = parseSponsors(config);
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
        empty("No stats recorded yet — members' posted rounds appear here.")
      );
    case 'members':
      return data.memberStats ? (
        <MembersTable stats={data.memberStats} basePath={siteBasePath(site)} detailed={false} />
      ) : (
        empty('No members yet.')
      );
    case 'documents': {
      const documents = parseDocuments(config);
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
    case 'news': {
      // N1: the three newest posts with their covers (it used to fall
      // to the default "Coming soon.").
      const latest = (data.news ?? []).slice(0, 3);
      return latest.length === 0 ? (
        empty('No news yet.')
      ) : (
        <div data-home-news={latest.length}>
          <NewsItems posts={latest} siteId={site.id} basePath={siteBasePath(site)} />
          <Link href={`${siteBasePath(site)}/news`} className="mt-2 inline-block text-sm text-brand-fg font-medium">
            All news →
          </Link>
        </div>
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
      const contact = parseContact(config);
      return Object.keys(contact).length > 0 ? (
        <ContactCard contact={contact} />
      ) : (
        empty('No contact details yet.')
      );
    }
    default:
      // Every web widget key is handled above; an unknown module key never
      // reaches here (deriveLegacyLayout drops it).
      return ((k: never) => k)(key);
  }
}
