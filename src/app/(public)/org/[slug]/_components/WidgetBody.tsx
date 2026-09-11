import Image from 'next/image';
import Link from 'next/link';
import type { PublicSite } from '@/lib/org-sites/server';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { WIDGETS, isWebWidgetKey, type SiteWidgetKey } from '@/lib/site-builder/catalog';
import type { WidgetInstance } from '@/lib/site-builder/layout';
import { moduleLabel, parseContact, parseDocuments, parseNavConfig, parsePageBody, parseSponsors, parseThemeTokens } from '@/lib/org-sites/validate';
import type { TemplateSpec } from '@/lib/org-sites/templates';
import { effectiveConfig, instanceTitle } from '@/lib/site-builder/config';
import { embedSrc, embedTitle, parseEmbed } from '@/lib/site-builder/embeds';
import { memberLimit, selectForInstance } from '@/lib/site-builder/select';
import { orgMediaUrl } from '@/lib/media/org-site-media';
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
import SiteFormWidget from './SiteFormWidget';
import PageBlocks from './PageBlocks';
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
  /** H1: the caller decides (`effectiveAudience`) — a private club's
   *  members-only module renders the panel; the body never reads the
   *  instance's stored visibility itself. */
  membersOnly?: boolean;
}

/** The section title for a widget — the INSTANCE's title (phase 5), else
 *  the nav label override, else the sport/side-aware module title; a
 *  content widget (phase 6) has no module, so its catalog name. */
export function widgetTitle(site: PublicSite, w: WidgetInstance): string {
  const own = instanceTitle(w);
  if (own) return own;
  if (isWebWidgetKey(w.key)) return moduleLabel(w.key, parseNavConfig(site.nav_config), site.side, site.sportKey);
  return WIDGETS[w.key].defaultTitle ?? w.key;
}

/** The heading the public frame renders — null for a content widget whose
 *  instance set no title (a paragraph or a photo needs none; the
 *  aria-label still carries `widgetTitle`). */
export function widgetHeading(site: PublicSite, w: WidgetInstance): string | null {
  if (WIDGETS[w.key].headingOptional) return instanceTitle(w);
  return widgetTitle(site, w);
}

export default function WidgetBody({ site, w, data: raw, spec, membersOnly = false }: WidgetBodyProps) {
  // Phase 9: the instance's QUERY narrows the bag first (which competition,
  // which venue, how many) — the same pick the empty rule makes.
  const data = selectForInstance(w, raw);
  // Phase 5: content from the org objects over the instance's options.
  const config = effectiveConfig(site, w);
  const { standings, events, teams, staff, venues, affiliations, openWindows, courses, divisions, leaders } = data;
  const clubGolfBoards = data.clubGolfBoards ?? [];
  const brandName = parseThemeTokens(site.theme_token_set).wordmark ?? site.orgName;
  const empty = (text: string) => <p className="mt-1 text-sm text-tertiary">{text}</p>;
  const key = w.key as Exclude<SiteWidgetKey, 'hero'>;
  // Phase 9 V4: a private club's members-only modules become the panel —
  // decided by the caller from the org's CURRENT privacy (H1).
  if (membersOnly) return <MembersOnlyPanel site={site} />;
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
          {hasEvents && <ScheduleList events={events!} basePath={siteBasePath(site)} />}
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
          <TeamsList teams={teams} basePath={siteBasePath(site)} variant={spec.teams} />
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
        <MembersTable stats={data.memberStats} basePath={siteBasePath(site)} detailed={false} limit={memberLimit(w)} />
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
      // N1: the newest posts with their covers (three unless the instance
      // asks for more — the selector already sliced).
      const latest = data.news ?? [];
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
    // ── Content widgets (phase 6): the instance IS the content ──────────────
    case 'text': {
      const blocks = parsePageBody(config.blocks);
      return blocks.length > 0 ? <PageBlocks blocks={blocks} siteId={site.id} headingLevel="h3" /> : empty('Nothing written yet.');
    }
    case 'image': {
      const path = typeof config.path === 'string' ? config.path : '';
      const src = path ? orgMediaUrl(site.id, path) : null;
      if (!src) return empty('No photo yet.');
      const alt = typeof config.alt === 'string' ? config.alt : '';
      const caption = typeof config.caption === 'string' && config.caption.trim() ? config.caption.trim() : null;
      const href = typeof config.href === 'string' && /^https:\/\//.test(config.href) ? config.href : null;
      const img = (
        <Image
          src={src}
          alt={alt}
          width={typeof config.width === 'number' ? config.width : 1200}
          height={typeof config.height === 'number' ? config.height : 675}
          unoptimized
          className="h-auto w-full rounded-lg"
        />
      );
      return (
        <figure>
          {href ? (
            <a href={href} target="_blank" rel="noopener nofollow">
              {img}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            img
          )}
          {caption && <figcaption className="mt-2 text-xs text-tertiary">{caption}</figcaption>}
        </figure>
      );
    }
    // Program 2, D: the two fixed forms — never empty, script-free.
    case 'contact_form':
    case 'interest_form':
      return <SiteFormWidget site={site} w={w} />;
    case 'embed': {
      // Never a stored URL: the frame src is rebuilt from the parsed
      // structure against the three providers the CSP frame-src allows.
      const e = parseEmbed(config.embed);
      if (!e) return empty('No video or map yet.');
      return (
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-surface-sunken" data-embed={e.provider}>
          <iframe
            src={embedSrc(e)}
            title={embedTitle(e)}
            loading="lazy"
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="h-full w-full border-0"
          />
        </div>
      );
    }
    default:
      // Every site widget key is handled above; an unknown module key never
      // reaches here (deriveLegacyLayout drops it).
      return ((k: never) => k)(key);
  }
}
