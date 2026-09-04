'use client';

import { useEffect, useState, Fragment, type ReactNode } from 'react';
// Org staff program (178): the console's section vocabulary IS authz's
// ORG_SECTIONS (a type-only import — this is a client component).
import type { OrgSection } from '@/lib/orgs/authz';
import { previewPoints } from '@/lib/competitions/golf-points';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';
import OrgSetupChecklist from '@/components/orgs/OrgSetupChecklist';
import { useToast } from '@/components/Toast';
import Image from 'next/image';
import { FEATURE_FLAGS } from '@/lib/features';
import { orgLogoUrl, orgMediaUrl } from '@/lib/media/org-site-media';
import {
  MODULE_TITLES,
  NAV_LABEL_MAX,
  TOGGLEABLE_MODULE_KEYS,
  WORDMARK_MAX,
  parseNavConfig,
  parseThemeTokens,
} from '@/lib/org-sites/validate';
import { orgSitePath } from '@/lib/org-sites/urls';
import { TEMPLATE_IDS, templateSpec } from '@/lib/org-sites/templates';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import OrgLogoUploader from '@/components/org/OrgLogoUploader';
import PlacePicker, { type PlaceValue } from '@/components/PlacePicker';
import { courseDisplayName } from '@/lib/golf/tees';
import type { GolfCourse } from '@/types/golf';
import AnnouncementHistory from '@/components/orgs/AnnouncementHistory';
import MemberPhotoPicker from '@/components/orgs/MemberPhotoPicker';
import HierarchySection from '@/components/orgs/console/HierarchySection';

// ── The org-manager console (phase 1, round 1) ──────────────────────────────
// The guardian-console shape (AppHeader — a recurring signed-in
// destination), forked from the admin structure console minus the org
// selector: the org comes from the URL, the gate from the server
// (requireOrgManager behind /api/{side}s/[id]/structure*). A non-manager
// gets an in-page notice, never a dead end. Admin console sibling:
// src/app/dashboard/structure/page.tsx.

interface EntryRow {
  id: string;
  team_id: string;
}

interface DivisionRow {
  id: string;
  season_id: string;
  sport_key: string;
  name: string;
  age_band: string | null;
  gender_stream: string | null;
  tier: string | null;
  entries: EntryRow[];
}

interface SeasonRow {
  id: string;
  label: string;
  starts_on: string | null;
  ends_on: string | null;
  sport_key: string | null;
  /** Phase 5.5 (mig 165) — pre-165 targets report false. */
  archived?: boolean;
  divisions: DivisionRow[];
}

interface TeamRow {
  id: string;
  name: string;
  display_name: string | null;
  status: 'active' | 'archived';
}

interface CompetitionEntryRow {
  id: string;
  team_id: string | null;
  profile_id: string | null;
  status: string;
  entrant_name: string;
}

/** Phase 7 C5: the console's sections, in the order the org's sport wants
 *  them. Classic = the phase-1 order (roster first); golf leads with the
 *  site, the courses and the leagues (a golf club's console is a site
 *  builder first). Every key appears exactly once per variant (pinned). */
/** 'hierarchy' (org staff program, round 5) is a console VIEW, not a grant
 *  section — every console entrant sees it; it never appears in a grant. */
export type ConsoleSectionKey = OrgSection | 'hierarchy';
export const CONSOLE_SECTION_ORDER: Record<'default' | 'golf', readonly ConsoleSectionKey[]> = {
  default: ['roster', 'hierarchy', 'membership', 'seasons', 'teams', 'competitions', 'registrations', 'external', 'venues', 'website'],
  golf: ['website', 'venues', 'competitions', 'hierarchy', 'roster', 'membership', 'seasons', 'teams', 'registrations', 'external'],
};

interface CompetitionRow {
  id: string;
  season_id: string;
  division_id: string | null;
  sport_key: string;
  name: string;
  format: string;
  entrant_type: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  visibility: 'public' | 'private';
  season_label: string | null;
  entries: CompetitionEntryRow[];
}

interface RegistrarRow {
  id: string;
  profileId: string;
  athlete: { displayName: string; birthday: string | null; supervised: boolean };
  seasonId: string;
  divisionName: string | null;
  programName: string | null;
  status: string;
  answers: {
    emergencyContact?: { name?: string; phone?: string };
    medicalNotes?: string;
  } | null;
  eligibility: { warnings?: { kind: string; message: string }[] } | null;
  createdAt: string;
  releasedReason: string | null;
}

interface RegistrarWindow {
  id: string;
  season_id: string;
  division_id: string | null;
  program_id: string | null;
  opens_at: string;
  closes_at: string | null;
  capacity: number | null;
}

const REG_STATUS_LABELS: Record<string, string> = {
  registered: 'Registered',
  evaluating: 'Evaluating',
  placed: 'Placed',
  released: 'Released',
  withdrawn: 'Withdrawn',
};

export default function OrgConsolePage() {
  const params = useParams();
  const side = params.side as string;
  const orgId = params.id as string;
  const validSide = side === 'league' || side === 'club';
  const plural = side === 'league' ? 'leagues' : 'clubs';

  const { user, initialAuthCheckComplete } = useAuth();
  const { showSuccess, showError } = useToast();

  const [orgName, setOrgName] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  // Org staff program (178): the sections THIS viewer may see — everything
  // for owners/managers/admins, the union of their grants for section
  // managers. null until /capabilities answers (pre-178 it answers the
  // ladder alone, which is the old behaviour exactly).
  const [visibleKeys, setVisibleKeys] = useState<readonly ConsoleSectionKey[] | null>(null);
  // Owners invite / revoke staff from the Hierarchy section (change_roles).
  const [viewerIsOwner, setViewerIsOwner] = useState(false);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [counts, setCounts] = useState<{ managers: number; rosterAthletes: number }>({
    managers: 0,
    rosterAthletes: 0,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmTarget, setConfirmTarget] = useState<
    | { kind: 'season'; id: string; label: string }
    | { kind: 'division'; id: string; label: string }
    | { kind: 'page'; id: string; label: string }
    | { kind: 'news'; id: string; label: string }
    | { kind: 'venue'; id: string; label: string }
    | { kind: 'domain'; id: string; label: string }
    | { kind: 'layout'; id: string; label: string }
    | null
  >(null);

  // Create forms
  const [seasonLabel, setSeasonLabel] = useState('');
  const [seasonStarts, setSeasonStarts] = useState('');
  const [seasonEnds, setSeasonEnds] = useState('');
  const [seasonSport, setSeasonSport] = useState('');
  const [divisionSeasonId, setDivisionSeasonId] = useState<string | null>(null);
  // Phase 5.5: the roll-forward expander (one open at a time) + its form.
  const [rolloverSeasonId, setRolloverSeasonId] = useState<string | null>(null);
  // Phase 6 R5: the structure-import expander (dry-run-first).
  const [importSeasonId, setImportSeasonId] = useState<string | null>(null);
  const [importCsvText, setImportCsvText] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importCsvReport, setImportCsvReport] = useState<{
    dryRun: boolean;
    summary: { rows: number; errors: number; divisionsCreated: number; teamsCreated: number; entriesCreated: number };
    report: { row: number; division: string; team: string; divisionAction: string; teamAction: string; entryAction: string; error?: string }[];
  } | null>(null);
  const [rolloverLabel, setRolloverLabel] = useState('');
  const [rolloverStarts, setRolloverStarts] = useState('');
  const [rolloverEnds, setRolloverEnds] = useState('');
  const [divisionName, setDivisionName] = useState('');
  const [divisionSport, setDivisionSport] = useState('golf');
  const [divisionAge, setDivisionAge] = useState('');
  const [divisionGender, setDivisionGender] = useState('');
  const [divisionTier, setDivisionTier] = useState('');
  const [teamName, setTeamName] = useState('');
  // Roster import (R3): per-team inline expander, the divisionSeasonId
  // toggle precedent (never a modal — 375px).
  const [importTeamId, setImportTeamId] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<
    { name: string; claimUrl: string | null; emailSent: boolean; error?: string }[] | null
  >(null);
  // Competitions (phase 2). Fixture (team) and leaderboard (athlete)
  // formats — the entrant type is derived server-side from the format.
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [affiliatedTeams, setAffiliatedTeams] = useState<
    { id: string; name: string; club_name: string }[]
  >([]);
  const [rosterAthletes, setRosterAthletes] = useState<{ id: string; name: string }[]>([]);
  const [compFormat, setCompFormat] = useState<'fixture' | 'leaderboard'>('fixture');
  const [compName, setCompName] = useState('');
  const [compSeasonId, setCompSeasonId] = useState('');
  const [compDivisionId, setCompDivisionId] = useState('');
  const [compSport, setCompSport] = useState('ice_hockey');
  // G1: golf leaderboards pick their scoring rule + counting round.
  const [compScoringRule, setCompScoringRule] = useState<'golf_gross' | 'golf_net' | 'stroke_total' | 'golf_points'>('golf_net');
  const [compGolfPick, setCompGolfPick] = useState<'first' | 'best'>('first');
  // Phase 7 C6: FedEx-style season points — the table and the base strokes.
  const [compPointsPreset, setCompPointsPreset] = useState<'pga' | 'linear'>('pga');
  const [compPointsScore, setCompPointsScore] = useState<'gross' | 'net'>('net');
  const [compPublic, setCompPublic] = useState(false);
  const [entriesCompetitionId, setEntriesCompetitionId] = useState<string | null>(null);
  // Phase 4 R1 (club side only): competitions this club's teams are
  // entered in but the club doesn't own — the player-stats doorway.
  const [externalComps, setExternalComps] = useState<
    { id: string; name: string; sportKey: string; status: string; owner: { name: string } }[]
  >([]);
  // Phase 5 R4: the registrar screen — one season's registrations + the
  // windows. 403/flag-off/pre-162 hide the section (regAvailable).
  const [regSeasonId, setRegSeasonId] = useState('');
  const [registrations, setRegistrations] = useState<RegistrarRow[]>([]);
  const [regWindows, setRegWindows] = useState<RegistrarWindow[]>([]);
  const [regAvailable, setRegAvailable] = useState(false);
  const [regDetailId, setRegDetailId] = useState<string | null>(null);
  // PR #492: per-offering window controls — the inline-expander precedent.
  const [winFormOpen, setWinFormOpen] = useState(false);
  const [winOfferingKey, setWinOfferingKey] = useState('season');
  const [winClosesOn, setWinClosesOn] = useState('');
  const [winCapacity, setWinCapacity] = useState('');
  const [regPrograms, setRegPrograms] = useState<
    Record<string, { id: string; name: string }[]>
  >({});
  // Website (phase 3 R1): the org's public site row (null until created).
  const [site, setSite] = useState<{
    id: string;
    subdomain: string;
    published_at: string | null;
    logo_path?: string | null;
    /** B2: the render template ('classic' | 'bold'); unknown → classic. */
    template_id?: string | null;
  } | null>(null);
  // R2: the site's module rows — the Sections toggles (+R3: config).
  const [siteModules, setSiteModules] = useState<
    { module_key: string; enabled: boolean; config?: unknown }[]
  >([]);
  // C1: the custom-domain lifecycle (published sites only).
  const [domainStatus, setDomainStatus] = useState<{
    state: string;
    domain: string | null;
    instructions: { type: string; name: string; value: string; purpose: string }[];
    platformVerification: { type: string; domain: string; value: string }[];
    failure: string | null;
    awaitingPlatform: boolean;
    migrationPending?: boolean;
  } | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [domainBusy, setDomainBusy] = useState(false);
  // B3: documents & policies drafts (stored PDF path OR https link).
  const [documentDrafts, setDocumentDrafts] = useState<
    { title: string; path: string; url: string }[]
  >([]);
  // B1: brand tokens beyond the accent, and the per-section labels.
  const [themeStrong, setThemeStrong] = useState('');
  const [themeSurface, setThemeSurface] = useState<'plain' | 'tinted'>('plain');
  const [themeTypeface, setThemeTypeface] = useState<'sans' | 'serif'>('sans');
  const [themeWordmark, setThemeWordmark] = useState('');
  const [navLabels, setNavLabels] = useState<Record<string, string>>({});
  // Local display order for the Sections list (seeded from the rows' order;
  // ▲/▼ reorder here, Save layout mirrors it into sort_order).
  const [navOrder, setNavOrder] = useState<string[] | null>(null);
  // R3 branding editors — seeded from the site GET on every refresh.
  const [heroHeadline, setHeroHeadline] = useState('');
  const [heroTagline, setHeroTagline] = useState('');
  const [themeAccent, setThemeAccent] = useState(''); // '' = default violet
  const [sponsorDrafts, setSponsorDrafts] = useState<
    { name: string; url: string; logoPath: string }[]
  >([]);
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactWebsite, setContactWebsite] = useState('');
  // Phase 6e S1: the golf club's front door + contact card. Every field
  // rides the whole-object save (replace semantics), seeded from GET.
  const [heroImagePath, setHeroImagePath] = useState('');
  const [heroImageAlt, setHeroImageAlt] = useState('');
  const [heroCtaLabel, setHeroCtaLabel] = useState('');
  const [heroCtaUrl, setHeroCtaUrl] = useState('');
  const [heroNotice, setHeroNotice] = useState('');
  const [heroNoticeUntil, setHeroNoticeUntil] = useState('');
  // Phase 6e S2: per-course photos (the `courses` module config).
  const [coursePhotos, setCoursePhotos] = useState<Record<string, string>>({});
  /** N6: courseId → hole number → photo path (the same config entry). */
  const [courseHolePhotos, setCourseHolePhotos] = useState<Record<string, Record<string, string>>>({});
  const [holePick, setHolePick] = useState<Record<string, number>>({});
  // Phase 6e S6: announce to members (a megaphone — bells every member,
  // optionally mirrored to the site's notice band).
  const [announceTitle, setAnnounceTitle] = useState('');
  const [announceMessage, setAnnounceMessage] = useState('');
  const [announceOnSite, setAnnounceOnSite] = useState(false);
  const [announceUntil, setAnnounceUntil] = useState('');
  const [announceBusy, setAnnounceBusy] = useState(false);
  /** N3: bumps after a send so the history below the form re-reads. */
  const [announceSentAt, setAnnounceSentAt] = useState(0);
  const [contactAddress, setContactAddress] = useState<string[]>(['', '', '']);
  const [contactHours, setContactHours] = useState('');
  const [contactDirections, setContactDirections] = useState('');
  const [contactSocial, setContactSocial] = useState<Record<'instagram' | 'facebook' | 'x' | 'youtube', string>>({
    instagram: '',
    facebook: '',
    x: '',
    youtube: '',
  });
  // Phase 6 R1 — the slug picker (create flow): identity-composed
  // suggestions + a custom candidate with live availability/policy check.
  const [slugPickerOpen, setSlugPickerOpen] = useState(false);
  const [slugSuggestions, setSlugSuggestions] = useState<{ slug: string; available: boolean }[]>([]);
  const [chosenSlug, setChosenSlug] = useState('');
  const [slugCheck, setSlugCheck] = useState<{
    slug: string;
    availability: string;
    verdict: string;
    reason?: string;
  } | null>(null);
  // R3 pages — the list in the Website card; the block editor is a subpage.
  const [sitePages, setSitePages] = useState<
    { id: string; slug: string; title: string; visibility: 'public' | 'draft' }[]
  >([]);
  const [pageTitle, setPageTitle] = useState('');
  // Phase 3.5: news posts (published_at is the state).
  const [siteNews, setSiteNews] = useState<
    { id: string; slug: string; title: string; published_at: string | null; audience?: 'public' | 'members' }[]
  >([]);
  const [newsTitle, setNewsTitle] = useState('');
  // Phase 6b A1: venues & courses — the org's PROPERTY (141); a golf link
  // is a catalog course pick, split server-side into club/course.
  const [venues, setVenues] = useState<
    {
      id: string;
      name: string;
      city: string | null;
      region: string | null;
      facilities: { id: string; name: string; kind: string | null }[];
      courses: GolfCourse[];
    }[]
  >([]);
  const [venueName, setVenueName] = useState('');
  const [venuePlace, setVenuePlace] = useState<PlaceValue | null>(null);
  const [venuePlaceText, setVenuePlaceText] = useState('');
  const [linkingVenueId, setLinkingVenueId] = useState<string | null>(null);
  const [courseQuery, setCourseQuery] = useState('');
  const [courseResults, setCourseResults] = useState<GolfCourse[]>([]);
  // Phase 7 C4: awaiting approval — the console works, publishing waits.
  const [pending, setPending] = useState(false);
  // Phase 7 C5: the org's sport shapes the console (golf-first).
  const [orgSport, setOrgSport] = useState<string | null>(null);
  // Phase 9 V1: the org's membership settings (176 clubs; 177 leagues —
  // program 11 made the section side-generic).
  const [orgVisibility, setOrgVisibility] = useState<'public' | 'private'>('public');
  const [orgJoinPolicy, setOrgJoinPolicy] = useState<'open' | 'approval'>('open');
  const [membershipSaving, setMembershipSaving] = useState(false);
  // Phase 9 V2: the approval queue (managers; both sides).
  const [joinRequests, setJoinRequests] = useState<{ id: string; name: string; handle: string | null; createdAt: string }[]>([]);
  const [joinBusy, setJoinBusy] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState(0);

  useEffect(() => {
    if (!validSide || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [orgRes, capsRes, structureRes, competitionsRes, siteRes, pagesRes, newsRes] =
          await Promise.all([
            fetch(`/api/${plural}/${orgId}`),
            fetch(`/api/${plural}/${orgId}/capabilities`),
            fetch(`/api/${plural}/${orgId}/structure`),
            fetch(`/api/${plural}/${orgId}/competitions`),
            fetch(`/api/${plural}/${orgId}/site`),
            fetch(`/api/${plural}/${orgId}/site/pages`),
            fetch(`/api/${plural}/${orgId}/site/news`),
          ]);
        if (cancelled) return;
        if (orgRes.ok) {
          const data = await orgRes.json();
          if (!cancelled) setOrgName((data.league ?? data.club)?.name ?? null);
          if (!cancelled) setPending(data.pending === true);
          if (!cancelled) {
            setOrgVisibility(data.visibility === 'private' ? 'private' : 'public');
            setOrgJoinPolicy(data.joinPolicy === 'approval' ? 'approval' : 'open');
            try {
              const jr = await fetch(`/api/${plural}/${orgId}/join-requests`);
              if (jr.ok && !cancelled) setJoinRequests(((await jr.json()) as { requests?: typeof joinRequests }).requests ?? []);
            } catch {
              /* the queue simply stays empty */
            }
          }
          // C5: leagues carry sport_key; clubs answer primarySport (174).
          const sport = (data.league?.sport_key ?? data.primarySport ?? null) as string | null;
          if (!cancelled) {
            setOrgSport(sport);
            setMemberCount(typeof data.memberCount === 'number' ? data.memberCount : 0);
            // A golf org's first competition is a golf leaderboard — set in
            // the fetch callback, never an effect (the set-state-in-effect rule).
            if (sport === 'golf') {
              setCompSport('golf');
              setCompFormat('leaderboard');
            }
          }
        }
        // The capabilities answer decides entry (178); the structure GET's
        // status is the fallback for a database/deploy without the route.
        let capsDecided = false;
        if (capsRes.ok) {
          const caps = (await capsRes.json()) as { canEnterConsole?: boolean; visibleSections?: ConsoleSectionKey[]; isOwner?: boolean };
          if (cancelled) return;
          capsDecided = true;
          setVisibleKeys(caps.visibleSections ?? []);
          setViewerIsOwner(caps.isOwner === true);
          setAuthorized(caps.canEnterConsole === true);
          if (caps.canEnterConsole !== true) return;
        }
        if (structureRes.status === 403 || structureRes.status === 401) {
          if (!capsDecided) setAuthorized(false);
          return;
        }
        if (!structureRes.ok) {
          if (!capsDecided) setAuthorized(false);
          return;
        }
        const structure = await structureRes.json();
        if (cancelled) return;
        setAuthorized(true);
        setSeasons(structure.seasons ?? []);
        setTeams(structure.teams ?? []);
        setCounts(structure.counts ?? { managers: 0, rosterAthletes: 0 });
        // Phase 6b A1: venues (best-effort; pre-141 reads as an empty list).
        try {
          const venuesRes = await fetch(`/api/${plural}/${orgId}/venues`);
          if (venuesRes.ok) {
            const venuesBody = await venuesRes.json();
            if (!cancelled) setVenues(venuesBody.venues ?? []);
          }
        } catch {
          /* the section renders empty */
        }
        // Pre-151 the route degrades to an empty list; any other failure
        // renders the section empty rather than blocking the console.
        if (competitionsRes.ok) {
          const compBody = await competitionsRes.json();
          if (!cancelled) {
            setCompetitions(compBody.competitions ?? []);
            setAffiliatedTeams(compBody.affiliatedTeams ?? []);
            setRosterAthletes(compBody.rosterAthletes ?? []);
          }
        }
        // Best-effort, club side only: external competitions (phase 4 R1).
        if (side === 'club') {
          try {
            const extRes = await fetch(`/api/${plural}/${orgId}/competitions/external`);
            if (!cancelled && extRes.ok) {
              const extBody = await extRes.json();
              if (!cancelled) setExternalComps(extBody.competitions ?? []);
            }
          } catch {
            // the section simply stays hidden
          }
        }
        if (siteRes.ok) {
          const siteBody = await siteRes.json();
          if (!cancelled) {
            setSite(siteBody.site ?? null);
            setSiteModules(siteBody.modules ?? []);
            // R3: seed the branding editors from the stored config so a
            // Save always sends the complete object (replace semantics).
            const heroConfig = (siteBody.site?.hero_config ?? {}) as {
              headline?: string;
              tagline?: string;
              imagePath?: string;
              imageAlt?: string;
              ctaLabel?: string;
              ctaUrl?: string;
              notice?: string;
              noticeUntil?: string;
            };
            const str = (v: unknown) => (typeof v === 'string' ? v : '');
            setHeroHeadline(str(heroConfig.headline));
            setHeroTagline(str(heroConfig.tagline));
            setHeroImagePath(str(heroConfig.imagePath));
            setHeroImageAlt(str(heroConfig.imageAlt));
            setHeroCtaLabel(str(heroConfig.ctaLabel));
            setHeroCtaUrl(str(heroConfig.ctaUrl));
            setHeroNotice(str(heroConfig.notice));
            setHeroNoticeUntil(str(heroConfig.noticeUntil));
            const contactExtra = (siteBody.site?.contact_config ?? {}) as {
              address?: unknown;
              hours?: unknown;
              directionsUrl?: unknown;
              social?: Record<string, unknown>;
            };
            const addr = Array.isArray(contactExtra.address)
              ? contactExtra.address.filter((l): l is string => typeof l === 'string')
              : [];
            setContactAddress([addr[0] ?? '', addr[1] ?? '', addr[2] ?? '']);
            setContactHours(str(contactExtra.hours));
            setContactDirections(str(contactExtra.directionsUrl));
            setContactSocial({
              instagram: str(contactExtra.social?.instagram),
              facebook: str(contactExtra.social?.facebook),
              x: str(contactExtra.social?.x),
              youtube: str(contactExtra.social?.youtube),
            });
            const themeSet = (siteBody.site?.theme_token_set ?? {}) as { accent?: string };
            setThemeAccent(typeof themeSet.accent === 'string' ? themeSet.accent : '');
            // B1: the rest of the token set + nav labels, seeded the same way.
            const tokens = parseThemeTokens(siteBody.site?.theme_token_set);
            setThemeStrong(tokens.accentStrong ?? '');
            setThemeSurface(tokens.surface);
            setThemeTypeface(tokens.typeface);
            setThemeWordmark(tokens.wordmark ?? '');
            setNavLabels(parseNavConfig(siteBody.site?.nav_config).labels);
            // C1: the domain status rides its own GET (best-effort; a
            // pre-171 database answers migrationPending).
            if (siteBody.site?.published_at) {
              try {
                const domainRes = await fetch(`/api/${plural}/${orgId}/site/domain`);
                if (domainRes.ok) {
                  const domainBody = await domainRes.json();
                  if (!cancelled) setDomainStatus(domainBody.domain ?? null);
                }
              } catch {
                /* the block renders its empty state */
              }
            } else if (!cancelled) {
              setDomainStatus(null);
            }
            const documentsConfig = (siteBody.modules ?? []).find(
              (m: { module_key: string }) => m.module_key === 'documents'
            )?.config as { documents?: { title?: string; path?: string; url?: string }[] } | undefined;
            setDocumentDrafts(
              (documentsConfig?.documents ?? []).map(d => ({
                title: d.title ?? '',
                path: d.path ?? '',
                url: d.url ?? '',
              }))
            );
            // N6: per-hole photos ride the same entries.
            const holeCfg = (siteBody.modules ?? []).find(
              (m: { module_key: string }) => m.module_key === 'courses'
            )?.config as { photos?: Record<string, { holes?: Record<string, { path?: string }> }> } | undefined;
            setCourseHolePhotos(
              Object.fromEntries(
                Object.entries(holeCfg?.photos ?? {})
                  .map(([id, v]) => [
                    id,
                    Object.fromEntries(
                      Object.entries(v?.holes ?? {})
                        .filter(([, h]) => typeof h?.path === 'string')
                        .map(([n, h]) => [n, h.path as string])
                    ),
                  ] as [string, Record<string, string>])
                  .filter(([, m]) => Object.keys(m).length > 0)
              )
            );
            // S2: per-course photos ride the courses module config.
            const coursesConfig = (siteBody.modules ?? []).find(
              (m: { module_key: string }) => m.module_key === 'courses'
            )?.config as { photos?: Record<string, { path?: string }> } | undefined;
            setCoursePhotos(
              Object.fromEntries(
                Object.entries(coursesConfig?.photos ?? {})
                  .filter(([, v]) => typeof v?.path === 'string')
                  .map(([k, v]) => [k, v.path as string])
              )
            );
            const sponsorsConfig = (siteBody.modules ?? []).find(
              (m: { module_key: string }) => m.module_key === 'sponsors'
            )?.config as { sponsors?: { name?: string; url?: string }[] } | undefined;
            setSponsorDrafts(
              (
                (sponsorsConfig?.sponsors ?? []) as {
                  name?: string;
                  url?: string;
                  logoPath?: string;
                }[]
              ).map(s => ({
                name: s.name ?? '',
                url: s.url ?? '',
                logoPath: s.logoPath ?? '',
              }))
            );
            const contactConfig = (siteBody.site?.contact_config ?? {}) as {
              email?: string;
              phone?: string;
              website?: string;
            };
            setContactEmail(typeof contactConfig.email === 'string' ? contactConfig.email : '');
            setContactPhone(typeof contactConfig.phone === 'string' ? contactConfig.phone : '');
            setContactWebsite(
              typeof contactConfig.website === 'string' ? contactConfig.website : ''
            );
          }
        }
        // Pages list (R3) — tolerate failure: an empty list, never a block.
        if (pagesRes.ok) {
          const pagesBody = await pagesRes.json();
          if (!cancelled) setSitePages(pagesBody.pages ?? []);
        }
        if (newsRes.ok) {
          const newsBody = await newsRes.json();
          if (!cancelled) setSiteNews(newsBody.posts ?? []);
        }
      } catch {
        if (!cancelled) setAuthorized(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [validSide, side, plural, orgId, user?.id, reloadKey]);

  // Phase 6b A1: the catalog search behind "Link golf course" — debounced,
  // never per keystroke (the course-search bucket is IP-keyed). Short
  // queries clear results in the onChange handler, not here.
  useEffect(() => {
    const q = courseQuery.trim();
    if (!linkingVenueId || q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/golf/courses?q=${encodeURIComponent(q)}&limit=8`);
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (!cancelled) setCourseResults(body.courses ?? []);
      } catch {
        /* results keep their last value */
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [linkingVenueId, courseQuery]);

  const refresh = () => setReloadKey(k => k + 1);

  // Phase 5 R4: registrar data (flag-gated surface; the API re-gates).
  const effectiveRegSeason = regSeasonId || (seasons[0]?.id ?? '');
  useEffect(() => {
    if (!FEATURE_FLAGS.FEATURE_ORG_REGISTRATION || !validSide || !user?.id || authorized !== true) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [regRes, winRes, offRes] = await Promise.all([
          fetch(
            `/api/${plural}/${orgId}/registrations${effectiveRegSeason ? `?seasonId=${effectiveRegSeason}` : ''}`
          ),
          fetch(`/api/${plural}/${orgId}/registration-windows`),
          // Programs for the offering picker (divisions already ride the
          // seasons payload); the offerings projection lists live seasons.
          fetch(`/api/${plural}/${orgId}/offerings`),
        ]);
        if (cancelled) return;
        if (regRes.ok) {
          const body = await regRes.json();
          if (!cancelled) {
            setRegistrations((body.registrations ?? []) as RegistrarRow[]);
            setRegAvailable(body.available !== false);
          }
        } else {
          setRegAvailable(false);
        }
        if (winRes.ok) {
          const body = await winRes.json();
          if (!cancelled) setRegWindows((body.windows ?? []) as RegistrarWindow[]);
        }
        if (offRes.ok) {
          const body = (await offRes.json()) as {
            seasons?: { id: string; programs?: { id: string; name: string }[] }[];
          };
          if (!cancelled) {
            setRegPrograms(
              Object.fromEntries(
                (body.seasons ?? []).map(s => [s.id, s.programs ?? []])
              )
            );
          }
        }
      } catch {
        if (!cancelled) setRegAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [validSide, plural, orgId, user?.id, authorized, reloadKey, effectiveRegSeason]);

  const act = async (
    path: string,
    init: RequestInit,
    successMessage: string,
    failMessage: string,
    title = 'Structure'
  ) => {
    try {
      const response = await fetch(path, init);
      const body = await response.json();
      if (!response.ok) {
        showError(title, body.error || failMessage);
        return false;
      }
      showSuccess(title, successMessage);
      refresh();
      return true;
    } catch (e) {
      console.error('Structure action failed:', e);
      showError(title, failMessage);
      return false;
    }
  };

  // Phase 6 R5: the structure-import runner — Preview (dryRun, default)
  // then Import (explicit dryRun:false); commit refreshes the console.
  const runStructureImport = async (seasonId: string, dryRun: boolean) => {
    if (importBusy) return;
    setImportBusy(true);
    try {
      const response = await fetch(`/api/${plural}/${orgId}/structure-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seasonId, csv: importCsvText, dryRun }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showError('Structure import', body.error || 'Import failed');
        return;
      }
      setImportCsvReport(body);
      if (!dryRun) {
        showSuccess('Structure import', 'Imported — the season structure is updated');
        refresh();
      }
    } catch {
      showError('Structure import', 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  // R3: the Website card's PATCH helper — same act(), Website-titled toasts.
  const siteAct = (bodyJson: Record<string, unknown>, successMessage: string, failMessage: string) =>
    act(
      `/api/${plural}/${orgId}/site`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyJson),
      },
      successMessage,
      failMessage,
      'Website'
    );

  const base = `/api/${plural}/${orgId}/structure`;

  const createSeason = async () => {
    if (!seasonLabel.trim()) {
      showError('Structure', 'A season label is required');
      return;
    }
    const ok = await act(
      `${base}/seasons`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side,
          orgId,
          label: seasonLabel.trim(),
          ...(seasonStarts ? { startsOn: seasonStarts } : {}),
          ...(seasonEnds ? { endsOn: seasonEnds } : {}),
          ...(seasonSport ? { sportKey: seasonSport } : {}),
        }),
      },
      'Season created',
      'Failed to create season'
    );
    if (ok) {
      setSeasonLabel('');
      setSeasonStarts('');
      setSeasonEnds('');
      setSeasonSport('');
    }
  };

  const createDivision = async (seasonId: string) => {
    if (!divisionName.trim()) {
      showError('Structure', 'A division name is required');
      return;
    }
    const ok = await act(
      `${base}/divisions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seasonId,
          sportKey: divisionSport,
          name: divisionName.trim(),
          ...(divisionAge.trim() ? { ageBand: divisionAge.trim() } : {}),
          ...(divisionGender.trim() ? { genderStream: divisionGender.trim() } : {}),
          ...(divisionTier.trim() ? { tier: divisionTier.trim() } : {}),
        }),
      },
      'Division created',
      'Failed to create division'
    );
    if (ok) {
      setDivisionName('');
      setDivisionAge('');
      setDivisionGender('');
      setDivisionTier('');
    }
  };

  const createTeam = async () => {
    if (!teamName.trim()) {
      showError('Structure', 'A team name is required');
      return;
    }
    const ok = await act(
      `${base}/teams`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side, orgId, name: teamName.trim() }),
      },
      'Team created',
      'Failed to create team'
    );
    if (ok) setTeamName('');
  };

  const runImport = async (teamId: string) => {
    if (!importText.trim() || importing) return;
    setImporting(true);
    setImportReport(null);
    try {
      const response = await fetch(`/api/${plural}/${orgId}/roster-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, text: importText }),
      });
      const body = await response.json();
      if (!response.ok) {
        showError('Roster import', body.error || 'Import failed');
        return;
      }
      setImportReport(body.report ?? []);
      setImportText('');
      showSuccess('Roster import', `${(body.report ?? []).filter((r: { error?: string }) => !r.error).length} athletes imported`);
      refresh();
    } catch (e) {
      console.error('Roster import failed:', e);
      showError('Roster import', 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const createCompetition = async () => {
    if (!compName.trim() || !compSeasonId) {
      showError('Competitions', 'A name and season are required');
      return;
    }
    const ok = await act(
      `/api/${plural}/${orgId}/competitions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side,
          orgId,
          seasonId: compSeasonId,
          ...(compDivisionId ? { divisionId: compDivisionId } : {}),
          sportKey: compSport,
          name: compName.trim(),
          format: compFormat,
          visibility: compPublic ? 'public' : 'private',
          ...(compFormat === 'leaderboard' && compSport === 'golf'
            ? {
                scoringRule: compScoringRule,
                config: {
                  golf: {
                    pick: compGolfPick,
                    ...(compScoringRule === 'golf_points'
                      ? { points: compPointsPreset, score: compPointsScore }
                      : {}),
                  },
                },
              }
            : {}),
        }),
      },
      'Competition created',
      'Failed to create competition'
    );
    if (ok) {
      setCompName('');
      setCompDivisionId('');
      setCompPublic(false);
    }
  };

  const patchCompetition = (competitionId: string, patch: { status?: string; visibility?: string }) =>
    act(
      `/api/${plural}/${orgId}/competitions`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: competitionId, ...patch }),
      },
      'Competition updated',
      'Failed to update competition'
    );

  const remove = (target: NonNullable<typeof confirmTarget>) => {
    if (target.kind === 'layout') {
      void (async () => {
        const ok = await siteAct({ action: 'reset_order' }, 'Layout reset to the recommended order', 'Failed to reset the layout');
        if (ok) setNavOrder(null);
      })();
      return;
    }
    if (target.kind === 'domain') {
      void act(
        `/api/${plural}/${orgId}/site/domain`,
        { method: 'DELETE' },
        'Domain removed',
        'Could not remove the domain',
        'Website'
      );
      return;
    }
    if (target.kind === 'venue') {
      void act(
        `/api/${plural}/${orgId}/venues/${target.id}`,
        { method: 'DELETE' },
        'Venue removed',
        'Delete failed',
        'Venues'
      );
      return;
    }
    if (target.kind === 'page' || target.kind === 'news') {
      void act(
        `/api/${plural}/${orgId}/site/${target.kind === 'page' ? 'pages' : 'news'}/${target.id}`,
        { method: 'DELETE' },
        target.kind === 'page' ? 'Page deleted' : 'Post deleted',
        'Delete failed',
        'Website'
      );
      return;
    }
    const paths = { season: `${base}/seasons`, division: `${base}/divisions` } as const;
    void act(
      `${paths[target.kind]}?id=${encodeURIComponent(target.id)}`,
      { method: 'DELETE' },
      `${target.kind === 'season' ? 'Season' : 'Division'} deleted`,
      'Delete failed'
    );
  };

  // Phase 6b A1: venue actions. act() refreshes, which re-reads the list.
  const venuesBase = `/api/${plural}/${orgId}/venues`;
  const createVenue = async () => {
    if (!venueName.trim()) {
      showError('Venues', 'A venue name is required');
      return;
    }
    const ok = await act(
      venuesBase,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: venueName.trim(), place: venuePlace }),
      },
      'Venue added',
      'Could not add the venue',
      'Venues'
    );
    if (ok) {
      setVenueName('');
      setVenuePlace(null);
      setVenuePlaceText('');
    }
  };
  const linkCourse = async (venueId: string, courseId: string | null) => {
    const ok = await act(
      `${venuesBase}/${venueId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ golfCourseId: courseId }),
      },
      courseId ? 'Course linked' : 'Course unlinked',
      'Could not update the venue',
      'Venues'
    );
    if (ok) {
      setLinkingVenueId(null);
      setCourseQuery('');
      setCourseResults([]);
    }
  };

  // C1: domain actions — each answers the fresh status; a 409 carries a
  // human reason (DNS not visible yet, domain not reaching us yet).
  const domainAction = async (path: string, init: RequestInit, successMessage: string) => {
    setDomainBusy(true);
    try {
      const res = await fetch(path, init);
      const body = await res.json();
      if (body.domain) setDomainStatus(body.domain);
      if (!res.ok) {
        showError('Website', body.error || 'Domain step failed');
        return false;
      }
      showSuccess('Website', successMessage);
      return true;
    } catch {
      showError('Website', 'Domain step failed — please try again');
      return false;
    } finally {
      setDomainBusy(false);
    }
  };

  const teamById = new Map(teams.map(t => [t.id, t]));
  const activeTeams = teams.filter(t => t.status === 'active');
  const hasSeasonWithDates = seasons.some(s => s.starts_on && s.ends_on);
  const hasDivisions = seasons.some(s => s.divisions.length > 0);

  if (!validSide) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-tertiary">Not found.</p>
        </div>
      </div>
    );
  }

  if (!initialAuthCheckComplete || (user && authorized === null)) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
        </div>
      </div>
    );
  }

  if (!user || authorized === false) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-lock text-2xl text-faint" aria-hidden="true"></i>
            </div>
            <h1 className="text-2xl font-bold text-primary mb-2">Managers only</h1>
            <p className="text-sm text-tertiary mb-4">
              This console is for the organization&apos;s owners, admins and invited section managers.
            </p>
            <Link
              href={`/${side}/${orgId}`}
              className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium"
            >
              View the public page →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const golfFirst = orgSport === 'golf';

  // Phase 9 V2: decide a join request.
  const decideJoin = async (requestId: string, decision: 'approve' | 'decline') => {
    setJoinBusy(requestId);
    try {
      const res = await fetch(`/api/${plural}/${orgId}/join-requests`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, decision }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok && res.status !== 409) {
        showError('Membership', body.error || 'Could not decide the request');
        return;
      }
      setJoinRequests(list => list.filter(r => r.id !== requestId));
      showSuccess('Membership', res.status === 409 ? 'Already decided' : decision === 'approve' ? 'Member approved' : 'Request declined');
      if (decision === 'approve') refresh();
    } catch {
      showError('Membership', 'Could not decide the request');
    } finally {
      setJoinBusy(null);
    }
  };

  // Phase 9 V1: save a membership setting (the org PATCH revalidates the site).
  const saveMembership = async (patch: { visibility?: 'public' | 'private'; joinPolicy?: 'open' | 'approval' }) => {
    setMembershipSaving(true);
    try {
      const res = await fetch(`/api/${plural}/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showError('Membership', body.error || 'Could not save the setting');
        return;
      }
      if (patch.visibility) setOrgVisibility(patch.visibility);
      if (patch.joinPolicy) setOrgJoinPolicy(patch.joinPolicy);
      showSuccess('Membership', patch.visibility ? (patch.visibility === 'private' ? `Your ${side} is now private` : `Your ${side} is now public`) : patch.joinPolicy === 'approval' ? 'New members now need your approval' : 'Anyone can join with one tap');
    } catch {
      showError('Membership', 'Could not save the setting');
    } finally {
      setMembershipSaving(false);
    }
  };

  // The console's sections, keyed so the ORDER can follow the org's sport
  // (phase 7 C5: golf-first — Website and Venues on top). A pure hoist of
  // the JSX that used to sit inline in <main>; every closure is unchanged.
  const sectionNodes: Record<ConsoleSectionKey, ReactNode> = {
    hierarchy: (
      <HierarchySection
        side={side as 'league' | 'club'}
        orgId={orgId}
        seasons={seasons}
        teams={teams}
        isOwner={viewerIsOwner}
        onError={message => showError('Hierarchy', message)}
      />
    ),
    membership: (
        <section
          id="membership"
          aria-label="Membership"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary mb-1">Membership</h2>
          <p className="text-sm text-tertiary mb-4">
            {`Who can see your ${side}, and how people join it.`}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="org-visibility" className="block text-sm font-medium text-secondary mb-1">
                Visibility
              </label>
              <select
                id="org-visibility"
                value={orgVisibility}
                disabled={membershipSaving}
                onChange={e => void saveMembership({ visibility: e.target.value as 'public' | 'private' })}
                className="w-full max-w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              >
                <option value="public">Public — everything on your site is open</option>
                <option value="private">Private — members-only content</option>
              </select>
              <p className="mt-1 text-xs text-muted">
                {orgVisibility === 'private'
                  ? `Standings, results, players, teams and the roster are members-only on your site; your name, contact${side === 'club' ? ', courses' : ''}, schedule, registration and public news stay visible.`
                  : 'Anyone can read your standings, results and players.'}
              </p>
            </div>
            <div>
              <label htmlFor="org-join-policy" className="block text-sm font-medium text-secondary mb-1">
                Joining
              </label>
              <select
                id="org-join-policy"
                value={orgJoinPolicy}
                disabled={membershipSaving}
                onChange={e => void saveMembership({ joinPolicy: e.target.value as 'open' | 'approval' })}
                className="w-full max-w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              >
                <option value="open">Open — anyone can join with one tap</option>
                <option value="approval">Approval — you approve each request</option>
              </select>
              <p className="mt-1 text-xs text-muted">
                {orgJoinPolicy === 'approval'
                  ? 'Requests queue here and bell your managers.'
                  : 'New members appear on the roster immediately.'}
              </p>
            </div>
          </div>
        </section>
      ),
    roster: (
      <>
        {/* Roster (R3) — counts + the door; per-team import lives on the
            team rows below. */}
        <section
        id="roster"
          aria-label="Roster"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary mb-1">Roster</h2>
          <p className="text-sm text-tertiary">
            {counts.rosterAthletes} rostered athlete{counts.rosterAthletes === 1 ? '' : 's'}.
            Import athletes per team below — each import creates claimable profiles and
            claim links to hand out.
          </p>
          <Link
            href={`/${side}/${orgId}#members`}
            className="mt-2 inline-block text-sm text-brand-fg hover:text-brand-fg-strong"
          >
            View members &amp; roster →
          </Link>
          {/* Phase 9 V2: the approval queue (a manager surface — real names). */}
          {(orgJoinPolicy === 'approval' || joinRequests.length > 0) && (
            <div className="mt-4" data-join-requests={joinRequests.length}>
              <h3 className="text-sm font-semibold text-primary">
                Membership requests{joinRequests.length > 0 ? ` (${joinRequests.length})` : ''}
              </h3>
              {joinRequests.length === 0 ? (
                <p className="text-xs text-muted">No one is waiting.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border-subtle">
                  {joinRequests.map(r => (
                    <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-primary min-w-0">
                        {r.name}
                        {r.handle ? <span className="text-muted"> · @{r.handle}</span> : null}
                        <span className="block text-xs text-muted">{new Date(r.createdAt).toLocaleDateString()}</span>
                      </span>
                      <span className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={joinBusy === r.id}
                          onClick={() => void decideJoin(r.id, 'approve')}
                          className="px-2 py-1 text-xs rounded-md bg-brand text-white font-medium hover:bg-brand-hover disabled:opacity-60"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={joinBusy === r.id}
                          onClick={() => void decideJoin(r.id, 'decline')}
                          className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken disabled:opacity-60"
                        >
                          Decline
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </>
    ),
    seasons: (
      <>
        {/* Seasons & divisions — forked from the admin console; the org is
            the URL's, every write scope-pinned server-side. */}
        <section
        id="seasons"
          aria-label="Seasons and divisions"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary mb-4">Seasons</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              type="text"
              value={seasonLabel}
              maxLength={60}
              onChange={e => setSeasonLabel(e.target.value)}
              placeholder="Label (e.g., 2026-27)"
              aria-label="Season label"
              className="grow basis-40 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            />
            <input
              type="date"
              value={seasonStarts}
              onChange={e => setSeasonStarts(e.target.value)}
              aria-label="Season starts"
              className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            />
            <input
              type="date"
              value={seasonEnds}
              onChange={e => setSeasonEnds(e.target.value)}
              aria-label="Season ends"
              className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            />
            <select
              value={seasonSport}
              onChange={e => setSeasonSport(e.target.value)}
              aria-label="Season sport"
              className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            >
              <option value="">All sports</option>
              {FEATURE_FLAGS.FEATURE_SPORTS.map(key => (
                <option key={key} value={key}>
                  {SPORT_REGISTRY[key]?.display_name ?? key}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void createSeason()}
              className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
            >
              Add season
            </button>
          </div>

          {seasons.length === 0 ? (
            <p className="text-sm text-tertiary">No seasons yet.</p>
          ) : (
            <ul className="space-y-3">
              {seasons.map(season => (
                <li key={season.id} className="border border-border rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-primary">
                        {season.label}
                        {season.archived && (
                          <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-surface-sunken text-muted">
                            Archived
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {[season.starts_on, season.ends_on].filter(Boolean).join(' → ') || 'No dates'}
                        {season.sport_key
                          ? ` · ${SPORT_REGISTRY[season.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? season.sport_key}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setDivisionSeasonId(divisionSeasonId === season.id ? null : season.id)}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                      >
                        {divisionSeasonId === season.id ? 'Close divisions' : 'Divisions'}
                      </button>
                      {!season.archived && (
                        <button
                          type="button"
                          onClick={() => {
                            setRolloverSeasonId(prev => (prev === season.id ? null : season.id));
                            setRolloverLabel('');
                            setRolloverStarts('');
                            setRolloverEnds('');
                          }}
                          className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                        >
                          {rolloverSeasonId === season.id ? 'Close roll forward' : 'Roll forward'}
                        </button>
                      )}
                      {!season.archived && (
                        <button
                          type="button"
                          onClick={() => {
                            setImportSeasonId(prev => (prev === season.id ? null : season.id));
                            setImportCsvText('');
                            setImportCsvReport(null);
                          }}
                          className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                        >
                          {importSeasonId === season.id ? 'Close import' : 'Import CSV'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirmTarget({ kind: 'season', id: season.id, label: season.label })}
                        aria-label={`Delete ${season.label}`}
                        className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-red-600"
                      >
                        <i className="fas fa-trash" aria-hidden="true"></i>
                      </button>
                    </div>
                  </div>

                  {/* Phase 6 R5: structure import — paste CSV, preview
                      (dry-run default), then import. Inline expander,
                      never a modal; report wraps at 375px. */}
                  {importSeasonId === season.id && (
                    <div className="mt-3 border-t border-border-subtle pt-3">
                      <p className="text-xs text-muted mb-2">
                        Paste CSV with columns <code>division, team_name</code> (optional:
                        age_band, gender_stream, tier, sport). Preview shows what would
                        happen; importing twice is safe — existing rows are reused.
                      </p>
                      <textarea
                        value={importCsvText}
                        onChange={e => {
                          setImportCsvText(e.target.value);
                          setImportCsvReport(null);
                        }}
                        rows={5}
                        placeholder={'division,team_name\nU13 A,Blazers\nU13 A,Comets'}
                        aria-label="Structure CSV"
                        className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm font-mono"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={importBusy || importCsvText.trim() === ''}
                          onClick={() => void runStructureImport(season.id, true)}
                          className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50"
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          disabled={importBusy || importCsvReport === null || importCsvReport.dryRun !== true}
                          onClick={() => void runStructureImport(season.id, false)}
                          title={importCsvReport?.dryRun !== true ? 'Preview first' : undefined}
                          className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                        >
                          Import
                        </button>
                      </div>
                      {importCsvReport && (
                        <div className="mt-2 text-xs text-secondary">
                          <p className="font-medium text-primary mb-1">
                            {importCsvReport.dryRun ? 'Preview' : 'Imported'}:{' '}
                            {importCsvReport.summary.rows} rows ·{' '}
                            {importCsvReport.summary.divisionsCreated} divisions,{' '}
                            {importCsvReport.summary.teamsCreated} teams,{' '}
                            {importCsvReport.summary.entriesCreated} entries
                            {importCsvReport.summary.errors > 0 && (
                              <span className="text-red-600"> · {importCsvReport.summary.errors} errors</span>
                            )}
                          </p>
                          <div className="overflow-x-auto">
                            <ul className="space-y-0.5">
                              {importCsvReport.report.map(r => (
                                <li key={r.row} className={r.error ? 'text-red-600' : ''}>
                                  #{r.row} {r.division} / {r.team} — {r.divisionAction},{' '}
                                  {r.teamAction}, {r.entryAction}
                                  {r.error ? ` — ${r.error}` : ''}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {rolloverSeasonId === season.id && (
                    <div className="mt-3 border-t border-border-subtle pt-3">
                      <p className="text-xs text-muted mb-2">
                        Clones this season&apos;s divisions and programs, re-enters the same
                        teams, and archives this season. Rosters start empty; registration
                        opens when you say so.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          value={rolloverLabel}
                          maxLength={60}
                          onChange={e => setRolloverLabel(e.target.value)}
                          placeholder="New season label (e.g., 2027-28)"
                          aria-label="New season label"
                          className="grow basis-48 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        />
                        <input
                          type="date"
                          value={rolloverStarts}
                          onChange={e => setRolloverStarts(e.target.value)}
                          aria-label="New season start"
                          className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        />
                        <input
                          type="date"
                          value={rolloverEnds}
                          onChange={e => setRolloverEnds(e.target.value)}
                          aria-label="New season end"
                          className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        />
                        <button
                          type="button"
                          disabled={!rolloverLabel.trim()}
                          onClick={() => {
                            const label = rolloverLabel.trim();
                            setRolloverSeasonId(null);
                            void act(
                              `/api/${plural}/${orgId}/structure/rollover`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  seasonId: season.id,
                                  label,
                                  ...(rolloverStarts ? { startsOn: rolloverStarts } : {}),
                                  ...(rolloverEnds ? { endsOn: rolloverEnds } : {}),
                                }),
                              },
                              `Rolled forward to ${label}`,
                              'Failed to roll the season forward'
                            );
                          }}
                          className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                        >
                          Roll forward
                        </button>
                      </div>
                    </div>
                  )}

                  {divisionSeasonId === season.id && (
                    <div className="mt-3 border-t border-border-subtle pt-3">
                      <div className="flex flex-wrap gap-2 mb-3">
                        <input
                          type="text"
                          value={divisionName}
                          maxLength={80}
                          onChange={e => setDivisionName(e.target.value)}
                          placeholder="Division name (e.g., U13 Boys A)"
                          aria-label="Division name"
                          className="grow basis-48 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        />
                        <select
                          value={divisionSport}
                          onChange={e => setDivisionSport(e.target.value)}
                          aria-label="Division sport"
                          className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        >
                          {FEATURE_FLAGS.FEATURE_SPORTS.map(key => (
                            <option key={key} value={key}>
                              {SPORT_REGISTRY[key]?.display_name ?? key}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={divisionAge}
                          maxLength={30}
                          onChange={e => setDivisionAge(e.target.value)}
                          placeholder="Age band"
                          aria-label="Age band"
                          className="w-28 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        />
                        <input
                          type="text"
                          value={divisionGender}
                          maxLength={30}
                          onChange={e => setDivisionGender(e.target.value)}
                          placeholder="Stream"
                          aria-label="Gender stream"
                          className="w-28 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        />
                        <input
                          type="text"
                          value={divisionTier}
                          maxLength={30}
                          onChange={e => setDivisionTier(e.target.value)}
                          placeholder="Tier"
                          aria-label="Tier"
                          className="w-24 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void createDivision(season.id)}
                          className="px-3 py-2 text-sm min-h-[40px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                        >
                          Add division
                        </button>
                      </div>

                      {season.divisions.length === 0 ? (
                        <p className="text-xs text-muted">No divisions in this season.</p>
                      ) : (
                        <ul className="space-y-2">
                          {season.divisions.map(division => (
                            <li key={division.id} className="rounded-md bg-surface-muted p-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-primary">{division.name}</p>
                                  <p className="text-xs text-muted">
                                    {[
                                      SPORT_REGISTRY[division.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? division.sport_key,
                                      division.age_band,
                                      division.gender_stream,
                                      division.tier,
                                    ].filter(Boolean).join(' · ')}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setConfirmTarget({ kind: 'division', id: division.id, label: division.name })}
                                  aria-label={`Delete ${division.name}`}
                                  className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-red-600"
                                >
                                  <i className="fas fa-trash" aria-hidden="true"></i>
                                </button>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {division.entries.map(entry => (
                                  <span
                                    key={entry.id}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-surface-sunken text-secondary"
                                  >
                                    {teamById.get(entry.team_id)?.name ?? 'Unknown team'}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void act(
                                          `${base}/entries?id=${encodeURIComponent(entry.id)}`,
                                          { method: 'DELETE' },
                                          'Entry removed',
                                          'Failed to remove the entry'
                                        )
                                      }
                                      aria-label="Remove entry"
                                      className="text-muted hover:text-red-600"
                                    >
                                      <i className="fas fa-times" aria-hidden="true"></i>
                                    </button>
                                  </span>
                                ))}
                                {activeTeams.length > 0 && (
                                  <select
                                    value=""
                                    onChange={e => {
                                      if (!e.target.value) return;
                                      void act(
                                        `${base}/entries`,
                                        {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ teamId: e.target.value, divisionId: division.id }),
                                        },
                                        'Team entered',
                                        'Failed to enter the team'
                                      );
                                    }}
                                    aria-label={`Enter a team in ${division.name}`}
                                    className="px-2 py-1 text-xs border border-border-strong rounded-md outline-none"
                                  >
                                    <option value="">+ Enter team…</option>
                                    {activeTeams.map(t => (
                                      <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    ),
    teams: (
      <>
        {/* Teams — archive/restore only; teams persist (no manager delete). */}
        <section
        id="teams"
          aria-label="Teams"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary mb-4">Teams</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              type="text"
              value={teamName}
              maxLength={80}
              onChange={e => setTeamName(e.target.value)}
              placeholder="Team name (e.g., Blazers U13 A)"
              aria-label="Team name"
              className="grow basis-48 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            />
            <button
              type="button"
              onClick={() => void createTeam()}
              className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
            >
              Add team
            </button>
          </div>
          {teams.length === 0 ? (
            <p className="text-sm text-tertiary">No teams yet.</p>
          ) : (
            <ul className="space-y-2">
              {teams.map(team => (
                <li key={team.id} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg hover:bg-surface-muted">
                  <div className="min-w-0 grow basis-40">
                    <p className="font-medium text-primary">{team.name}</p>
                    {team.status === 'archived' && <p className="text-xs text-muted">Archived</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {team.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => {
                          setImportTeamId(importTeamId === team.id ? null : team.id);
                          setImportReport(null);
                        }}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                      >
                        {importTeamId === team.id ? 'Close import' : 'Import roster'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void act(
                          `${base}/teams`,
                          {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              id: team.id,
                              status: team.status === 'active' ? 'archived' : 'active',
                            }),
                          },
                          team.status === 'active' ? 'Team archived' : 'Team restored',
                          'Failed to update team'
                        )
                      }
                      className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                    >
                      {team.status === 'active' ? 'Archive' : 'Restore'}
                    </button>
                  </div>
                  {importTeamId === team.id && (
                    <div className="w-full mt-2 border-t border-border-subtle pt-3 space-y-2">
                      <textarea
                        value={importText}
                        onChange={e => setImportText(e.target.value)}
                        rows={4}
                        aria-label="Roster import lines"
                        placeholder={'One athlete per line:\nFirst Last, email@example.com (email optional)'}
                        className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                      />
                      <button
                        type="button"
                        disabled={importing || !importText.trim()}
                        onClick={() => void runImport(team.id)}
                        className="px-4 py-2 text-sm min-h-[44px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                      >
                        {importing ? 'Importing…' : 'Import'}
                      </button>
                      {importReport && (
                        <ul className="space-y-1.5">
                          {importReport.map((r, i) => (
                            <li key={`${r.name}-${i}`} className="text-xs">
                              <span className="font-medium text-primary">{r.name}</span>{' '}
                              {r.error ? (
                                <span className="text-red-600">failed ({r.error})</span>
                              ) : (
                                <>
                                  {r.emailSent ? (
                                    <span className="text-emerald-600">emailed</span>
                                  ) : (
                                    <span className="text-muted">link only</span>
                                  )}
                                  {r.claimUrl && (
                                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                      <input
                                        readOnly
                                        value={r.claimUrl}
                                        aria-label={`Claim link for ${r.name}`}
                                        className="grow basis-48 min-w-0 px-2 py-1 border border-border rounded-md text-[11px] text-muted"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => void navigator.clipboard.writeText(r.claimUrl!)}
                                        className="px-2 py-1 min-h-[32px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken"
                                      >
                                        Copy
                                      </button>
                                    </span>
                                  )}
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    ),
    competitions: (
      <>
        {/* Competitions (phase 2 R1) — create + entries; contests and
            standings arrive with rounds 2–3's detail subpage. */}
        <section
        id="competitions"
          aria-label="Competitions"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary mb-1">{golfFirst ? 'Leagues & events' : 'Competitions'}</h2>
          <p className="text-sm text-tertiary mb-4">
            A competition holds a schedule and standings. Create one per season — pin it
            to a division for house play.
          </p>
          {seasons.length === 0 ? (
            <p className="text-sm text-tertiary">Create a season first.</p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-4">
              <input
                type="text"
                value={compName}
                maxLength={80}
                onChange={e => setCompName(e.target.value)}
                placeholder="Name (e.g., House League)"
                aria-label="Competition name"
                className="grow basis-44 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              />
              <select
                value={compSeasonId}
                onChange={e => {
                  setCompSeasonId(e.target.value);
                  setCompDivisionId('');
                }}
                aria-label="Competition season"
                className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              >
                <option value="">Season…</option>
                {seasons.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <select
                value={compDivisionId}
                onChange={e => setCompDivisionId(e.target.value)}
                aria-label="Competition division"
                className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              >
                <option value="">Whole org</option>
                {(seasons.find(s => s.id === compSeasonId)?.divisions ?? []).map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select
                value={compSport}
                onChange={e => setCompSport(e.target.value)}
                aria-label="Competition sport"
                className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              >
                {FEATURE_FLAGS.FEATURE_SPORTS.map(key => (
                  <option key={key} value={key}>
                    {SPORT_REGISTRY[key]?.display_name ?? key}
                  </option>
                ))}
              </select>
              <select
                value={compFormat}
                onChange={e => setCompFormat(e.target.value as 'fixture' | 'leaderboard')}
                aria-label="Competition format"
                className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              >
                <option value="fixture">Fixture (teams)</option>
                <option value="leaderboard">Leaderboard (athletes)</option>
              </select>
              {compFormat === 'leaderboard' && compSport === 'golf' && (
                <>
                  <select
                    value={compScoringRule}
                    onChange={e => setCompScoringRule(e.target.value as 'golf_gross' | 'golf_net' | 'stroke_total' | 'golf_points')}
                    aria-label="Scoring rule"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                  >
                    <option value="golf_net">Net strokes (handicap)</option>
                    <option value="golf_gross">Gross strokes</option>
                    <option value="stroke_total">Strokes (plain total)</option>
                    <option value="golf_points">Season points (FedEx-style)</option>
                  </select>
                  {compScoringRule === 'golf_points' && (
                    <>
                      <select
                        value={compPointsPreset}
                        onChange={e => setCompPointsPreset(e.target.value as 'pga' | 'linear')}
                        aria-label="Points table"
                        className="max-w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                      >
                        <option value="pga">PGA table (100, 75, 60 …)</option>
                        <option value="linear">Linear (last place 1, +1 per place)</option>
                      </select>
                      <select
                        value={compPointsScore}
                        onChange={e => setCompPointsScore(e.target.value as 'gross' | 'net')}
                        aria-label="Points base score"
                        className="max-w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                      >
                        <option value="net">Rank on net strokes</option>
                        <option value="gross">Rank on gross strokes</option>
                      </select>
                      <div className="basis-full min-w-0 break-words text-xs text-muted" aria-label="Points preview">
                        {previewPoints(compPointsPreset, 10)
                          .map(p => `${p.position}${p.position === 1 ? 'st' : p.position === 2 ? 'nd' : p.position === 3 ? 'rd' : 'th'} ${p.points}`)
                          .join(' · ')}
                        {compPointsPreset === 'linear' ? ' (for a field of 20)' : ' · ties share'}
                      </div>
                    </>
                  )}
                  <select
                    value={compGolfPick}
                    onChange={e => setCompGolfPick(e.target.value as 'first' | 'best')}
                    aria-label="Counting round"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                  >
                    <option value="first">Counting round: first posted</option>
                    <option value="best">Counting round: best score</option>
                  </select>
                </>
              )}
              <label className="flex items-center gap-1.5 text-sm text-secondary">
                <input
                  type="checkbox"
                  checked={compPublic}
                  onChange={e => setCompPublic(e.target.checked)}
                  aria-label="Public competition"
                />
                Public
              </label>
              <button
                type="button"
                onClick={() => void createCompetition()}
                className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
              >
                Add competition
              </button>
            </div>
          )}

          {competitions.length === 0 ? (
            seasons.length > 0 && <p className="text-sm text-tertiary">No competitions yet.</p>
          ) : (
            <ul className="space-y-3">
              {competitions.map(comp => (
                <li key={comp.id} className="border border-border rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/app/org/${side}/${orgId}/competitions/${comp.id}`}
                        className="font-medium text-primary hover:text-brand-fg"
                      >
                        {comp.name}
                      </Link>
                      <p className="text-xs text-muted">
                        {[
                          comp.season_label,
                          SPORT_REGISTRY[comp.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? comp.sport_key,
                          comp.format,
                          comp.status,
                          comp.visibility === 'public' ? 'public' : 'private',
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {/* min-w-0, NOT shrink-0: four buttons' max-content basis
                        (~341px) can't fit 375px minus padding; the container
                        must be allowed to shrink so its own wrap engages. */}
                    <div className="flex flex-wrap gap-2 min-w-0">
                      {(comp.entrant_type === 'team' || comp.entrant_type === 'athlete') && (
                        <button
                          type="button"
                          onClick={() =>
                            setEntriesCompetitionId(entriesCompetitionId === comp.id ? null : comp.id)
                          }
                          className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                        >
                          {entriesCompetitionId === comp.id
                            ? 'Close entries'
                            : `Entries (${comp.entries.length})`}
                        </button>
                      )}
                      {comp.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() => void patchCompetition(comp.id, { status: 'active' })}
                          className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                        >
                          Activate
                        </button>
                      )}
                      {comp.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => void patchCompetition(comp.id, { status: 'completed' })}
                          className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                        >
                          Complete
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void patchCompetition(comp.id, {
                            visibility: comp.visibility === 'public' ? 'private' : 'public',
                          })
                        }
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                      >
                        {comp.visibility === 'public' ? 'Make private' : 'Make public'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void patchCompetition(comp.id, {
                            status: comp.status === 'archived' ? 'draft' : 'archived',
                          })
                        }
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                      >
                        {comp.status === 'archived' ? 'Restore' : 'Archive'}
                      </button>
                    </div>
                  </div>

                  {entriesCompetitionId === comp.id && (
                    <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border-subtle pt-2">
                      {comp.entries.map(entry => (
                        <span
                          key={entry.id}
                          className="inline-flex max-w-full items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-surface-sunken text-secondary"
                        >
                          {/* min-w-0 + truncate: a long name must shrink or the
                              un-wrappable pill overflows 375px (R4's catch). */}
                          <span className="min-w-0 truncate">{entry.entrant_name}</span>
                          {entry.status === 'pending' && (
                            <>
                              <span className="text-amber-600">pending</span>
                              <button
                                type="button"
                                onClick={() =>
                                  void act(
                                    `/api/${plural}/${orgId}/competitions/entries`,
                                    {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ entryId: entry.id, decision: 'approved' }),
                                    },
                                    'Entry approved',
                                    'Failed to approve'
                                  )
                                }
                                aria-label={`Approve ${entry.entrant_name}`}
                                className="text-emerald-600 hover:text-emerald-700"
                              >
                                <i className="fas fa-check" aria-hidden="true"></i>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void act(
                                    `/api/${plural}/${orgId}/competitions/entries`,
                                    {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ entryId: entry.id, decision: 'rejected' }),
                                    },
                                    'Entry declined',
                                    'Failed to decline'
                                  )
                                }
                                aria-label={`Decline ${entry.entrant_name}`}
                                className="text-muted hover:text-red-600"
                              >
                                <i className="fas fa-ban" aria-hidden="true"></i>
                              </button>
                            </>
                          )}
                          {entry.status === 'rejected' && <span className="text-muted">declined</span>}
                          <button
                            type="button"
                            onClick={() =>
                              void act(
                                `/api/${plural}/${orgId}/competitions/entries?id=${encodeURIComponent(entry.id)}`,
                                { method: 'DELETE' },
                                'Entry removed',
                                'Failed to remove the entry'
                              )
                            }
                            aria-label={`Remove ${entry.entrant_name}`}
                            className="text-muted hover:text-red-600"
                          >
                            <i className="fas fa-times" aria-hidden="true"></i>
                          </button>
                        </span>
                      ))}
                      {comp.entrant_type === 'athlete' && rosterAthletes.length > 0 && (
                        <select
                          value=""
                          onChange={e => {
                            if (!e.target.value) return;
                            void act(
                              `/api/${plural}/${orgId}/competitions/entries`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ competitionId: comp.id, profileId: e.target.value }),
                              },
                              'Athlete entered',
                              'Failed to enter the athlete'
                            );
                          }}
                          aria-label={`Enter an athlete in ${comp.name}`}
                          className="max-w-full px-2 py-1 text-xs border border-border-strong rounded-md outline-none"
                        >
                          <option value="">+ Enter athlete…</option>
                          {rosterAthletes.map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      )}
                      {comp.entrant_type === 'athlete' && rosterAthletes.length === 0 && (
                        <span className="text-xs text-muted">
                          Only rostered athletes can be entered — import a roster first.
                        </span>
                      )}
                      {comp.entrant_type === 'team' && (activeTeams.length > 0 || affiliatedTeams.length > 0) && (
                        <select
                          value=""
                          onChange={e => {
                            if (!e.target.value) return;
                            void act(
                              `/api/${plural}/${orgId}/competitions/entries`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ competitionId: comp.id, teamId: e.target.value }),
                              },
                              'Team entered',
                              'Failed to enter the team'
                            );
                          }}
                          aria-label={`Enter a team in ${comp.name}`}
                          className="max-w-full px-2 py-1 text-xs border border-border-strong rounded-md outline-none"
                        >
                          <option value="">+ Enter team…</option>
                          {activeTeams.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                          {affiliatedTeams.length > 0 && (
                            <optgroup label="Affiliated clubs (enter as pending)">
                              {affiliatedTeams.map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.name} — {t.club_name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    ),
    registrations: (
      <>
        {/* Registrations (phase 5 R4) — the registrar screen: the season's
            registrations with lifecycle actions, and the window controls.
            Hidden pre-162 / flag-off / for non-registrars (the API 403s). */}
        {FEATURE_FLAGS.FEATURE_ORG_REGISTRATION && regAvailable && seasons.length > 0 && (
          <section
          id="registrations"
            aria-label="Registrations"
            className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
          >
            <h2 className="text-lg font-semibold text-primary mb-1">Registrations</h2>
            <p className="text-sm text-tertiary mb-3">
              Families register; you evaluate, place onto teams, or release.
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <select
                value={effectiveRegSeason}
                onChange={e => {
                  setRegSeasonId(e.target.value);
                  setWinOfferingKey('season'); // offering ids are season-scoped
                }}
                aria-label="Registration season"
                className="max-w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              >
                {seasons.map(sn => (
                  <option key={sn.id} value={sn.id}>{sn.label}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={!effectiveRegSeason}
                onClick={() => setWinFormOpen(o => !o)}
                className="px-3 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
              >
                {winFormOpen ? 'Cancel' : 'Open registration…'}
              </button>
              {registrations.length > 0 && (
                <a
                  href={`/api/${plural}/${orgId}/registrations/export${effectiveRegSeason ? `?seasonId=${effectiveRegSeason}` : ''}`}
                  download
                  className="px-3 py-2 text-sm min-h-[40px] inline-flex items-center rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                >
                  Download CSV
                </a>
              )}
            </div>

            {/* PR #492: per-offering open form — season-wide by default,
                or one division/program, with optional close date + capacity
                (the schema/API supported all three since 162; this is the
                UI catching up). Inline expander, never a modal (375px). */}
            {winFormOpen && (
              <form
                className="flex flex-wrap items-end gap-2 mb-4 border border-border rounded-lg p-3"
                onSubmit={e => {
                  e.preventDefault();
                  const payload: Record<string, unknown> = {
                    seasonId: effectiveRegSeason,
                    opensAt: new Date().toISOString(),
                  };
                  if (winOfferingKey.startsWith('d:')) payload.divisionId = winOfferingKey.slice(2);
                  if (winOfferingKey.startsWith('p:')) payload.programId = winOfferingKey.slice(2);
                  if (winClosesOn) {
                    payload.closesAt = new Date(`${winClosesOn}T23:59:59`).toISOString();
                  }
                  const cap = parseInt(winCapacity, 10);
                  if (Number.isFinite(cap) && cap > 0) payload.capacity = cap;
                  void act(
                    `/api/${plural}/${orgId}/registration-windows`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(payload),
                    },
                    'Registration is open',
                    'Failed to open registration',
                    'Registrations'
                  ).then(ok => {
                    if (!ok) return; // keep the entered values on failure
                    setWinFormOpen(false);
                    setWinOfferingKey('season');
                    setWinClosesOn('');
                    setWinCapacity('');
                  });
                }}
              >
                <label className="text-sm text-secondary">
                  <span className="block text-xs text-muted mb-1">Offering</span>
                  <select
                    value={winOfferingKey}
                    onChange={e => setWinOfferingKey(e.target.value)}
                    className="max-w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                  >
                    <option value="season">Season-wide</option>
                    {(seasons.find(s => s.id === effectiveRegSeason)?.divisions ?? []).map(d => (
                      <option key={d.id} value={`d:${d.id}`}>Division · {d.name}</option>
                    ))}
                    {(regPrograms[effectiveRegSeason] ?? []).map(p => (
                      <option key={p.id} value={`p:${p.id}`}>Program · {p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-secondary">
                  <span className="block text-xs text-muted mb-1">Closes on (optional)</span>
                  <input
                    type="date"
                    value={winClosesOn}
                    onChange={e => setWinClosesOn(e.target.value)}
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                  />
                </label>
                <label className="text-sm text-secondary">
                  <span className="block text-xs text-muted mb-1">Capacity (optional)</span>
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={winCapacity}
                    onChange={e => setWinCapacity(e.target.value)}
                    placeholder="No cap"
                    className="w-28 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                  />
                </label>
                <button
                  type="submit"
                  className="px-3 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
                >
                  Open
                </button>
              </form>
            )}

            {(() => {
              const seasonWindows = regWindows.filter(w => w.season_id === effectiveRegSeason);
              if (seasonWindows.length === 0) return null;
              const divName = new Map(
                (seasons.find(s => s.id === effectiveRegSeason)?.divisions ?? []).map(d => [d.id, d.name])
              );
              const progName = new Map(
                (regPrograms[effectiveRegSeason] ?? []).map(p => [p.id, p.name])
              );
              return (
                <ul className="space-y-2 mb-4" aria-label="Registration windows">
                  {seasonWindows.map(w => (
                    <li
                      key={w.id}
                      className="flex flex-wrap items-center justify-between gap-2 border border-border rounded-lg px-3 py-2"
                    >
                      <span className="text-sm text-secondary min-w-0">
                        <span className="font-medium text-primary">
                          {w.division_id
                            ? (divName.get(w.division_id) ?? 'Division')
                            : w.program_id
                              ? (progName.get(w.program_id) ?? 'Program')
                              : 'Season-wide'}
                        </span>
                        {' · '}
                        {w.closes_at
                          ? new Date(w.closes_at) <= new Date()
                            ? `closed ${new Date(w.closes_at).toLocaleDateString()}`
                            : `closes ${new Date(w.closes_at).toLocaleDateString()}`
                          : 'open-ended'}
                        {w.capacity != null && ` · cap ${w.capacity}`}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void act(
                            `/api/${plural}/${orgId}/registration-windows?windowId=${w.id}`,
                            { method: 'DELETE' },
                            'Registration closed',
                            'Failed to close registration',
                            'Registrations'
                          )
                        }
                        className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                      >
                        Close
                      </button>
                    </li>
                  ))}
                </ul>
              );
            })()}

            {registrations.length === 0 ? (
              <p className="text-sm text-tertiary">No registrations for this season yet.</p>
            ) : (
              <ul className="space-y-3">
                {registrations.map(reg => (
                  <li key={reg.id} className="border border-border rounded-lg p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-primary truncate">
                          {reg.athlete.displayName}
                          {reg.athlete.supervised && (
                            <span className="ml-1.5 text-xs text-muted">(supervised)</span>
                          )}
                        </p>
                        <p className="text-xs text-muted">
                          {[
                            reg.divisionName ?? reg.programName ?? 'No offering',
                            REG_STATUS_LABELS[reg.status] ?? reg.status,
                            reg.athlete.birthday ? null : 'DOB unknown',
                          ].filter(Boolean).join(' · ')}
                        </p>
                        {(reg.eligibility?.warnings ?? []).map((w, i) => (
                          <p key={i} className="text-xs text-amber-700 dark:text-amber-300">
                            <i className="fas fa-circle-info mr-1" aria-hidden="true"></i>
                            {w.message}
                          </p>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => setRegDetailId(prev => (prev === reg.id ? null : reg.id))}
                          className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                        >
                          {regDetailId === reg.id ? 'Hide details' : 'Details'}
                        </button>
                        {reg.status === 'registered' && (
                          <button
                            type="button"
                            onClick={() =>
                              void act(
                                `/api/${plural}/${orgId}/registrations/${reg.id}`,
                                {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ action: 'evaluate' }),
                                },
                                'Marked as evaluating',
                                'Failed to update',
                                'Registrations'
                              )
                            }
                            className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                          >
                            Evaluate
                          </button>
                        )}
                        {(reg.status === 'registered' || reg.status === 'evaluating') && (
                          <select
                            value=""
                            onChange={e => {
                              const teamId = e.target.value;
                              if (!teamId) return;
                              void act(
                                `/api/${plural}/${orgId}/registrations/${reg.id}`,
                                {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ action: 'place', teamId }),
                                },
                                'Placed on the team',
                                'Failed to place',
                                'Registrations'
                              );
                            }}
                            aria-label={`Place ${reg.athlete.displayName} on a team`}
                            className="max-w-full px-2 py-1 text-xs border border-border-strong rounded-md outline-none"
                          >
                            <option value="">Place on…</option>
                            {activeTeams.map(t => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        )}
                        {(reg.status === 'registered' ||
                          reg.status === 'evaluating' ||
                          reg.status === 'placed') && (
                          <button
                            type="button"
                            onClick={() =>
                              void act(
                                `/api/${plural}/${orgId}/registrations/${reg.id}`,
                                {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ action: 'release' }),
                                },
                                'Released',
                                'Failed to release',
                                'Registrations'
                              )
                            }
                            className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                          >
                            Release
                          </button>
                        )}
                      </div>
                    </div>
                    {regDetailId === reg.id && (
                      <dl className="mt-2 border-t border-border-subtle pt-2 text-sm space-y-1">
                        <div className="flex gap-2">
                          <dt className="text-muted w-36 shrink-0">Emergency contact</dt>
                          <dd className="text-secondary min-w-0">
                            {reg.answers?.emergencyContact
                              ? `${reg.answers.emergencyContact.name ?? ''} ${reg.answers.emergencyContact.phone ?? ''}`.trim() || '—'
                              : '—'}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-muted w-36 shrink-0">Medical notes</dt>
                          <dd className="text-secondary min-w-0 whitespace-pre-wrap">
                            {reg.answers?.medicalNotes || '—'}
                          </dd>
                        </div>
                        {reg.releasedReason && (
                          <div className="flex gap-2">
                            <dt className="text-muted w-36 shrink-0">Release reason</dt>
                            <dd className="text-secondary min-w-0">{reg.releasedReason}</dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </>
    ),
    external: (
      <>
        {/* External competitions (phase 4 R1, club side) — the doorway to
            player-stats entry for competitions the club's teams are
            entered in but doesn't own. Hidden when there are none. */}
        {side === 'club' && externalComps.length > 0 && (
          <section
          id="external"
            aria-label="External competitions"
            className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
          >
            <h2 className="text-lg font-semibold text-primary mb-1">External competitions</h2>
            <p className="text-sm text-tertiary mb-3">
              Your teams are entered here — record player stats for your own athletes.
            </p>
            <ul className="space-y-2">
              {externalComps.map(comp => (
                <li key={comp.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/app/org/club/${orgId}/competitions/${comp.id}`}
                      className="block truncate text-sm font-medium text-brand-fg hover:text-brand-fg-strong"
                    >
                      {comp.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {[
                        SPORT_REGISTRY[comp.sportKey as keyof typeof SPORT_REGISTRY]?.display_name ??
                          comp.sportKey,
                        comp.owner.name,
                        comp.status,
                      ].join(' · ')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    ),
    venues: (
      <>
        {/* Venues & courses (phase 6b A1) — the org's PROPERTY (141). A golf
            club recognizes its catalog course here; that is what puts tees,
            scorecards and the map on the club page and the public site. */}
        <section
        id="venues"
          aria-label="Venues and courses"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary mb-1">Venues &amp; courses</h2>
          <p className="text-sm text-tertiary mb-3">
            Where you play. Link a golf course from the catalog to show its tees, scorecard
            and map on your pages.
          </p>
          {venues.length > 0 && (
            <ul className="space-y-3 mb-4">
              {venues.map(venue => {
                const linking = linkingVenueId === venue.id;
                return (
                  <li key={venue.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-primary truncate">{venue.name}</p>
                        <p className="text-xs text-muted">
                          {[venue.city, venue.region].filter(Boolean).join(', ') || 'No location'}
                          {venue.facilities.length > 0 &&
                            ` · ${venue.facilities.length} ${venue.facilities.length === 1 ? 'facility' : 'facilities'}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {venue.courses.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => linkCourse(venue.id, null)}
                            className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                          >
                            Unlink course
                          </button>
                        ) : (
                          <button
                            type="button"
                            aria-expanded={linking}
                            onClick={() => {
                              setLinkingVenueId(linking ? null : venue.id);
                              setCourseQuery('');
                              setCourseResults([]);
                            }}
                            className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                          >
                            {linking ? 'Cancel' : 'Link golf course'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmTarget({ kind: 'venue', id: venue.id, label: venue.name })
                          }
                          className="px-3 py-1.5 text-sm rounded-md text-tertiary hover:text-red-600 hover:bg-surface-sunken transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {venue.courses.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {venue.courses.map(c => (
                          <li key={c.id} className="text-sm text-secondary">
                            {courseDisplayName(c.clubName, c.name)}
                            {c.holesCount ? ` · ${c.holesCount} holes` : ''}
                            {c.totalPar ? ` · par ${c.totalPar}` : ''}
                            {/* S2: the course page's photo (a site image asset;
                                needs a site — the assets route 404s without one). */}
                            {site && (
                              <span className="mt-1 flex flex-wrap items-center gap-2">
                                {coursePhotos[c.id] && (
                                  <Image
                                    src={orgMediaUrl(site.id, coursePhotos[c.id]) ?? ''}
                                    alt=""
                                    width={64}
                                    height={36}
                                    unoptimized
                                    className="h-9 w-16 rounded object-cover border border-border"
                                  />
                                )}
                                <label className="text-xs text-tertiary">
                                  {coursePhotos[c.id] ? 'Replace course photo' : 'Course photo'}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    aria-label={`Course photo for ${c.name}`}
                                    className="block w-44 text-xs"
                                    onChange={async e => {
                                      const file = e.target.files?.[0];
                                      e.target.value = '';
                                      if (!file) return;
                                      const formData = new FormData();
                                      formData.append('image', file);
                                      try {
                                        const res = await fetch(`/api/${plural}/${orgId}/site/assets`, {
                                          method: 'POST',
                                          body: formData,
                                        });
                                        const body = await res.json();
                                        if (!res.ok) {
                                          showError('Website', body.error || 'Failed to upload the photo');
                                          return;
                                        }
                                        const ok = await siteAct(
                                          { action: 'set_course_photo', courseId: c.id, path: body.path },
                                          'Course photo saved',
                                          'Failed to save the course photo'
                                        );
                                        if (ok) setCoursePhotos(p => ({ ...p, [c.id]: body.path }));
                                      } catch {
                                        showError('Website', 'Upload failed — please try again');
                                      }
                                    }}
                                  />
                                </label>
                                {coursePhotos[c.id] && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const ok = await siteAct(
                                        { action: 'set_course_photo', courseId: c.id },
                                        'Course photo removed',
                                        'Failed to remove the course photo'
                                      );
                                      if (ok)
                                        setCoursePhotos(p => {
                                          const next = { ...p };
                                          delete next[c.id];
                                          return next;
                                        });
                                    }}
                                    className="px-2 py-1 text-xs rounded-md text-tertiary hover:bg-surface-sunken transition-colors"
                                  >
                                    Remove photo
                                  </button>
                                )}
                              </span>
                            )}
                            {/* N6: per-hole photos — pick a hole, upload; chips remove. */}
                            {site && (
                              <span className="mt-1 flex flex-wrap items-center gap-2" data-hole-photos={c.id}>
                                <label className="text-xs text-tertiary">
                                  Hole
                                  <select
                                    aria-label={`Hole for a photo, ${c.name}`}
                                    value={holePick[c.id] ?? 1}
                                    onChange={e => setHolePick(p => ({ ...p, [c.id]: Number(e.target.value) }))}
                                    className="ml-1 text-xs border border-border-strong rounded px-1 py-0.5 max-w-full"
                                  >
                                    {Array.from({ length: 18 }, (_, i) => (
                                      <option key={i + 1} value={i + 1}>
                                        {i + 1}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="text-xs text-tertiary">
                                  Hole photo
                                  <input
                                    type="file"
                                    accept="image/*"
                                    aria-label={`Hole photo for ${c.name}`}
                                    className="block w-44 text-xs"
                                    onChange={async e => {
                                      const file = e.target.files?.[0];
                                      e.target.value = '';
                                      if (!file) return;
                                      const hole = holePick[c.id] ?? 1;
                                      const formData = new FormData();
                                      formData.append('image', file);
                                      try {
                                        const res = await fetch(`/api/${plural}/${orgId}/site/assets`, {
                                          method: 'POST',
                                          body: formData,
                                        });
                                        const body = await res.json();
                                        if (!res.ok) {
                                          showError('Website', body.error || 'Failed to upload the photo');
                                          return;
                                        }
                                        const ok = await siteAct(
                                          { action: 'set_course_photo', courseId: c.id, hole, path: body.path },
                                          `Hole ${hole} photo saved`,
                                          'Failed to save the hole photo'
                                        );
                                        if (ok)
                                          setCourseHolePhotos(p => ({ ...p, [c.id]: { ...(p[c.id] ?? {}), [String(hole)]: body.path } }));
                                      } catch {
                                        showError('Website', 'Upload failed — please try again');
                                      }
                                    }}
                                  />
                                </label>
                                {Object.keys(courseHolePhotos[c.id] ?? {})
                                  .sort((a, b) => Number(a) - Number(b))
                                  .map(n => (
                                    <button
                                      key={n}
                                      type="button"
                                      aria-label={`Remove hole ${n} photo`}
                                      onClick={async () => {
                                        const ok = await siteAct(
                                          { action: 'set_course_photo', courseId: c.id, hole: Number(n) },
                                          `Hole ${n} photo removed`,
                                          'Failed to remove the hole photo'
                                        );
                                        if (ok)
                                          setCourseHolePhotos(p => {
                                            const next = { ...(p[c.id] ?? {}) };
                                            delete next[n];
                                            const all = { ...p };
                                            if (Object.keys(next).length > 0) all[c.id] = next;
                                            else delete all[c.id];
                                            return all;
                                          });
                                      }}
                                      className="px-2 py-1 text-xs rounded-md border border-border text-secondary hover:bg-surface-sunken transition-colors"
                                    >
                                      Hole {n} ×
                                    </button>
                                  ))}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {linking && (
                      <div className="mt-3">
                        <label
                          htmlFor={`course-search-${venue.id}`}
                          className="block text-xs font-medium text-secondary mb-1"
                        >
                          Search the course catalog
                        </label>
                        <input
                          id={`course-search-${venue.id}`}
                          value={courseQuery}
                          onChange={e => {
                            const next = e.target.value;
                            setCourseQuery(next);
                            if (next.trim().length < 2) setCourseResults([]);
                          }}
                          placeholder="Course or club name"
                          className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        />
                        {courseResults.length > 0 && (
                          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                            {courseResults.map(c => (
                              <li key={c.id}>
                                <button
                                  type="button"
                                  onClick={() => linkCourse(venue.id, c.id)}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-surface-sunken transition-colors"
                                >
                                  <span className="font-medium text-primary">
                                    {courseDisplayName(c.clubName, c.name)}
                                  </span>
                                  {(c.city || c.state) && (
                                    <span className="text-tertiary">
                                      {' '}· {[c.city, c.state].filter(Boolean).join(', ')}
                                    </span>
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
            <div>
              <label htmlFor="venue-name" className="block text-xs font-medium text-secondary mb-1">
                Venue name
              </label>
              <input
                id="venue-name"
                value={venueName}
                onChange={e => setVenueName(e.target.value)}
                placeholder="e.g. Kanata Golf & Country Club"
                className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              />
            </div>
            <div>
              <label htmlFor="venue-place" className="block text-xs font-medium text-secondary mb-1">
                Location
              </label>
              <PlacePicker
                id="venue-place"
                value={venuePlace}
                text={venuePlaceText}
                allowFreeText={false}
                placeholder="City or town"
                onChange={(nextPlace, text) => {
                  setVenuePlace(nextPlace);
                  setVenuePlaceText(text);
                }}
                className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              />
            </div>
            <button
              type="button"
              onClick={createVenue}
              className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
            >
              Add venue
            </button>
          </div>
        </section>
      </>
    ),
    website: (
      <>
        {/* Website (phase 3 R1) — create → preview → publish. The public
            site lives at /org/{subdomain}; draft = 404 out there. */}
        <section
        id="website"
          aria-label="Website"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary mb-1">Website</h2>
          {site === null ? (
            <>
              <p className="text-sm text-tertiary mb-3">
                A public site for your organization — schedule, standings, and teams,
                always current, no webmaster.
              </p>
              {!slugPickerOpen ? (
                <button
                  type="button"
                  onClick={async () => {
                    setSlugPickerOpen(true);
                    try {
                      const res = await fetch(`/api/${plural}/${orgId}/site/slug-options`);
                      const body = await res.json().catch(() => ({}));
                      const list = (body.suggestions ?? []) as { slug: string; available: boolean }[];
                      setSlugSuggestions(list);
                      const first = list.find(s => s.available);
                      if (first) setChosenSlug(first.slug);
                    } catch {
                      setSlugSuggestions([]);
                    }
                  }}
                  className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
                >
                  Create your site
                </button>
              ) : (
                <div className="space-y-3 border border-border rounded-lg p-3">
                  {/* Phase 6 R1: the address IS a root path (edgeathlete/{slug}),
                      so it must carry the org's own identity — the policy
                      check explains itself via `reason`. */}
                  <p className="text-xs text-muted">
                    Pick your web address. It should include your city or district
                    plus your organization’s name.
                  </p>
                  {slugSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {slugSuggestions.map(s => (
                        <button
                          key={s.slug}
                          type="button"
                          disabled={!s.available}
                          onClick={() => {
                            setChosenSlug(s.slug);
                            setSlugCheck(null);
                          }}
                          className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                            chosenSlug === s.slug
                              ? 'border-brand bg-brand-soft text-brand-fg font-medium'
                              : 'border-border-strong text-secondary hover:bg-surface-sunken'
                          } disabled:opacity-40 disabled:line-through`}
                        >
                          /{s.slug}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={chosenSlug}
                      onChange={e => {
                        const v = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                        setChosenSlug(v);
                        setSlugCheck(null);
                      }}
                      onBlur={async () => {
                        if (!chosenSlug) return;
                        try {
                          const res = await fetch(
                            `/api/${plural}/${orgId}/site/slug-options?candidate=${encodeURIComponent(chosenSlug)}`
                          );
                          const body = await res.json().catch(() => ({}));
                          if (body.candidate) setSlugCheck(body.candidate);
                        } catch {
                          /* check is advisory; create re-validates */
                        }
                      }}
                      aria-label="Site address"
                      placeholder="your-city-your-club"
                      className="flex-1 min-w-40 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                    />
                    <button
                      type="button"
                      disabled={!chosenSlug || slugCheck?.verdict === 'refused' || slugCheck?.availability === 'taken'}
                      onClick={() =>
                        void act(
                          `/api/${plural}/${orgId}/site`,
                          {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ subdomain: chosenSlug }),
                          },
                          'Site created — preview it, then publish',
                          'Failed to create the site'
                        )
                      }
                      className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                    >
                      Create
                    </button>
                  </div>
                  {slugCheck && (slugCheck.verdict !== 'ok' || slugCheck.availability !== 'available') && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {slugCheck.availability === 'taken'
                        ? 'That address is already taken.'
                        : slugCheck.availability === 'reserved'
                          ? 'That address is reserved.'
                          : slugCheck.availability === 'invalid'
                            ? 'Lowercase letters, digits and hyphens only.'
                            : (slugCheck.reason ?? '')}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-secondary min-w-0 break-all">
                Address: <span className="font-medium text-primary">{orgSitePath(site.subdomain)}</span>
                {' · '}
                {site.published_at ? (
                  <span className="text-emerald-600">published</span>
                ) : (
                  <span className="text-amber-600">draft — publish to go live</span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {/* Drafts get a signed short-lived preview link (the public
                    route stays a 404 until publish). */}
                {!site.published_at && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/${plural}/${orgId}/site/preview`, {
                          method: 'POST',
                        });
                        const body = await res.json();
                        if (!res.ok) {
                          showError('Website', body.error || 'Failed to create a preview link');
                          return;
                        }
                        window.open(body.url, '_blank', 'noopener');
                      } catch {
                        showError('Website', 'Failed to create a preview link');
                      }
                    }}
                    className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    Preview draft
                  </button>
                )}
                {site.published_at && (
                  <a
                    href={orgSitePath(site.subdomain)}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    View site
                  </a>
                )}
                <button
                  type="button"
                  onClick={() =>
                    void act(
                      `/api/${plural}/${orgId}/site`,
                      {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: site.published_at ? 'unpublish' : 'publish',
                        }),
                      },
                      site.published_at ? 'Site unpublished' : 'Site is live',
                      'Failed to update the site'
                    )
                  }
                  disabled={!site.published_at && pending}
                  title={!site.published_at && pending ? 'Awaiting approval — publishing unlocks when approved' : undefined}
                  className="px-3 py-1.5 text-sm rounded-md bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {site.published_at ? 'Unpublish' : 'Publish'}
                </button>
              </div>
              {/* C1: the custom domain — published sites only. Each step is
                  a proof: TXT (ownership) → Vercel attach → the domain
                  answers /.well-known/edge-athlete (only then does the
                  Edge Athlete address 301 to it — no dead ends). */}
              {site.published_at && (
                <div className="pt-2 space-y-1.5">
                  <p className="text-sm font-medium text-primary">Custom domain</p>
                  {domainStatus?.migrationPending ? (
                    <p className="text-xs text-tertiary">Custom domains are not available yet.</p>
                  ) : !domainStatus || domainStatus.state === 'none' ? (
                    <>
                      <p className="text-xs text-tertiary">
                        Use your own domain (for example kmha.ca) for this site. You will add two DNS
                        records at your registrar.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="text"
                          value={domainInput}
                          onChange={e => setDomainInput(e.target.value)}
                          placeholder="yourclub.ca"
                          aria-label="Custom domain"
                          className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                        />
                        <button
                          type="button"
                          disabled={domainBusy || !domainInput.trim()}
                          onClick={async () => {
                            const ok = await domainAction(
                              `/api/${plural}/${orgId}/site/domain`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ domain: domainInput.trim() }),
                              },
                              'Domain saved — add the DNS records below'
                            );
                            if (ok) setDomainInput('');
                          }}
                          className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-60"
                        >
                          Save domain
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-secondary break-all">
                        <span className="font-medium text-primary">{domainStatus.domain}</span>
                        {' · '}
                        <span
                          className={
                            domainStatus.state === 'active'
                              ? 'text-emerald-600'
                              : domainStatus.state === 'failed'
                                ? 'text-red-600'
                                : 'text-amber-600'
                          }
                        >
                          {domainStatus.state === 'pending'
                            ? 'waiting for DNS verification'
                            : domainStatus.state === 'verified'
                              ? domainStatus.awaitingPlatform
                                ? 'verified — Edge Athlete will connect it shortly'
                                : 'verified'
                              : domainStatus.state === 'attaching'
                                ? 'connecting'
                                : domainStatus.state === 'attached'
                                  ? 'connected — waiting for the domain to reach us'
                                  : domainStatus.state === 'active'
                                    ? 'live'
                                    : `failed${domainStatus.failure ? ` — ${domainStatus.failure}` : ''}`}
                        </span>
                      </p>
                      {domainStatus.state !== 'active' && domainStatus.instructions.length > 0 && (
                        <div className="overflow-x-auto rounded-lg border border-border">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-muted bg-surface-sunken">
                                <th scope="col" className="px-2 py-1.5 font-medium">Type</th>
                                <th scope="col" className="px-2 py-1.5 font-medium">Name</th>
                                <th scope="col" className="px-2 py-1.5 font-medium">Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                ...domainStatus.instructions,
                                ...domainStatus.platformVerification.map(v => ({
                                  type: v.type,
                                  name: v.domain,
                                  value: v.value,
                                  purpose: 'Requested by the platform',
                                })),
                              ].map((row, i) => (
                                <tr key={i} className="border-t border-border">
                                  <td className="px-2 py-1.5 font-medium text-primary">{row.type}</td>
                                  <td className="px-2 py-1.5 font-mono text-secondary break-all">{row.name}</td>
                                  <td className="px-2 py-1.5 font-mono text-secondary break-all">{row.value}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {domainStatus.state === 'pending' && (
                          <button
                            type="button"
                            disabled={domainBusy}
                            onClick={() =>
                              void domainAction(
                                `/api/${plural}/${orgId}/site/domain/verify`,
                                { method: 'POST' },
                                'Domain verified'
                              )
                            }
                            className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-60"
                          >
                            Verify DNS
                          </button>
                        )}
                        {['verified', 'attaching', 'attached', 'failed'].includes(domainStatus.state) && (
                          <button
                            type="button"
                            disabled={domainBusy}
                            onClick={() =>
                              void domainAction(
                                `/api/${plural}/${orgId}/site/domain/check`,
                                { method: 'POST' },
                                'Your domain is live'
                              )
                            }
                            className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-60"
                          >
                            Check connection
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmTarget({
                              kind: 'domain',
                              id: site.id,
                              label: domainStatus.domain ?? 'domain',
                            })
                          }
                          className="px-3 py-1.5 text-sm rounded-md text-tertiary hover:text-red-600 hover:bg-surface-sunken transition-colors"
                        >
                          Remove domain
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* R2: Sections — one toggle per non-hero module. act()
                  refreshes, so the checkbox state round-trips through
                  the server; revalidateTag flips the public pages. */}
              {siteModules.length > 0 && (
                <div className="pt-2">
                  <p className="text-sm font-medium text-primary">Sections</p>
                  <p className="text-xs text-tertiary mb-2">
                    Toggle, rename and reorder. Changes go live within a few minutes.
                  </p>
                  {(() => {
                    // B1: the rows arrive in sort_order; the local order (▲/▼)
                    // overlays it until Save layout mirrors it to the server.
                    const toggleable = siteModules.filter(m =>
                      (TOGGLEABLE_MODULE_KEYS as readonly string[]).includes(m.module_key)
                    );
                    const rowKeys = toggleable.map(m => m.module_key);
                    const order = navOrder
                      ? [...navOrder.filter(k => rowKeys.includes(k)), ...rowKeys.filter(k => !navOrder.includes(k))]
                      : rowKeys;
                    const byKey = new Map(toggleable.map(m => [m.module_key, m]));
                    const move = (key: string, dir: -1 | 1) => {
                      const i = order.indexOf(key);
                      const j = i + dir;
                      if (i < 0 || j < 0 || j >= order.length) return;
                      const next = [...order];
                      [next[i], next[j]] = [next[j], next[i]];
                      setNavOrder(next);
                    };
                    return (
                      <>
                        <ul className="space-y-1.5">
                          {order.map((key, index) => {
                            const m = byKey.get(key)!;
                            const label = MODULE_TITLES[key] ?? key;
                            return (
                              <li key={key} className="flex flex-wrap items-center gap-2 min-h-[28px]">
                                <label className="flex items-center gap-2 text-sm text-secondary min-w-[9rem]">
                                  <input
                                    type="checkbox"
                                    checked={m.enabled}
                                    aria-label={`Toggle ${label} section`}
                                    onChange={() =>
                                      void act(
                                        `/api/${plural}/${orgId}/site`,
                                        {
                                          method: 'PATCH',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({
                                            action: 'set_module',
                                            moduleKey: key,
                                            enabled: !m.enabled,
                                          }),
                                        },
                                        'Section updated',
                                        'Failed to update the section'
                                      )
                                    }
                                  />
                                  {label}
                                </label>
                                <input
                                  type="text"
                                  value={navLabels[key] ?? ''}
                                  onChange={e =>
                                    setNavLabels(prev => ({ ...prev, [key]: e.target.value }))
                                  }
                                  maxLength={NAV_LABEL_MAX}
                                  placeholder={label}
                                  aria-label={`${label} section label`}
                                  className="px-2 py-1 border border-border-strong rounded-md outline-none text-xs w-36"
                                />
                                <span className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => move(key, -1)}
                                    disabled={index === 0}
                                    aria-label={`Move ${label} up`}
                                    className="ea-icon-btn h-8 w-8 text-tertiary disabled:opacity-40"
                                  >
                                    ▲
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => move(key, 1)}
                                    disabled={index === order.length - 1}
                                    aria-label={`Move ${label} down`}
                                    className="ea-icon-btn h-8 w-8 text-tertiary disabled:opacity-40"
                                  >
                                    ▼
                                  </button>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await siteAct(
                              {
                                action: 'set_nav',
                                items: order.map(key => ({
                                  key,
                                  ...(navLabels[key]?.trim() ? { label: navLabels[key].trim() } : {}),
                                })),
                              },
                              'Layout saved',
                              'Failed to save the layout'
                            );
                            if (ok) setNavOrder(null);
                          }}
                          className="mt-2 px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                        >
                          Save layout
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmTarget({ kind: 'layout', id: site.id, label: 'the section order' })
                          }
                          className="mt-2 ml-2 px-3 py-1.5 text-sm rounded-md text-tertiary hover:bg-surface-sunken transition-colors"
                        >
                          Reset to recommended order
                        </button>
                      </>
                    );
                  })()}
                </div>
              )}
              {/* R3: site logo — square PNG through the shared editor,
                  streamed publicly by /api/media/org-logo/[siteId]. */}
              <div className="pt-2 space-y-1.5">
                <p className="text-sm font-medium text-primary">Logo</p>
                <div className="flex flex-wrap items-center gap-2">
                  {site.logo_path ? (
                    <Image
                      src={orgLogoUrl(site.id, site.logo_path)!}
                      alt="Current site logo"
                      width={40}
                      height={40}
                      unoptimized
                      className="rounded border border-border shrink-0"
                    />
                  ) : (
                    <span className="text-xs text-tertiary">No logo yet.</span>
                  )}
                  <OrgLogoUploader
                    endpoint={`/api/${plural}/${orgId}/site/logo`}
                    onUploaded={() => {
                      showSuccess('Website', 'Logo updated');
                      refresh();
                    }}
                    render={({ open, uploading }) => (
                      <button
                        type="button"
                        onClick={open}
                        disabled={uploading}
                        className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50"
                      >
                        {uploading ? 'Uploading…' : site.logo_path ? 'Replace logo' : 'Upload logo'}
                      </button>
                    )}
                  />
                  {site.logo_path && (
                    <button
                      type="button"
                      onClick={() =>
                        void act(
                          `/api/${plural}/${orgId}/site/logo`,
                          { method: 'DELETE' },
                          'Logo removed',
                          'Failed to remove the logo',
                          'Website'
                        )
                      }
                      className="px-3 py-1.5 text-sm rounded-md text-tertiary hover:bg-surface-sunken transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              {/* S6: announce to members — every member is belled (guardians
                  of supervised members too); optionally the title becomes
                  the site's notice band until a day. Rate-limited: a
                  megaphone, not a chat. */}
              <div className="pt-2 space-y-1.5">
                <p className="text-sm font-medium text-primary">Announce to members</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={announceTitle}
                    onChange={e => setAnnounceTitle(e.target.value)}
                    maxLength={80}
                    placeholder="Title (e.g. Rain-out: Week 3 extended to Sunday)"
                    aria-label="Announcement title"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                </div>
                <textarea
                  value={announceMessage}
                  onChange={e => setAnnounceMessage(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="The message every member receives."
                  aria-label="Announcement message"
                  className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-sm text-secondary">
                    <input
                      type="checkbox"
                      checked={announceOnSite}
                      onChange={e => setAnnounceOnSite(e.target.checked)}
                      aria-label="Also show on the site"
                    />
                    Also show on the site until
                  </label>
                  <input
                    type="date"
                    value={announceUntil}
                    onChange={e => setAnnounceUntil(e.target.value)}
                    disabled={!announceOnSite}
                    aria-label="Show on the site until"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm disabled:opacity-50"
                  />
                  <button
                    type="button"
                    disabled={announceBusy || !announceTitle.trim() || !announceMessage.trim() || (announceOnSite && !announceUntil)}
                    onClick={async () => {
                      setAnnounceBusy(true);
                      try {
                        const res = await fetch(`/api/${plural}/${orgId}/announce`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            title: announceTitle.trim(),
                            message: announceMessage.trim(),
                            ...(announceOnSite && announceUntil ? { siteNoticeUntil: announceUntil } : {}),
                          }),
                        });
                        const body = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          showError('Announce', body.error || 'Failed to send the announcement');
                          return;
                        }
                        showSuccess(
                          'Announce',
                          `Sent to ${body.sent ?? 0} ${body.sent === 1 ? 'member' : 'members'}${body.siteNotice ? ' · shown on the site' : ''}`
                        );
                        setAnnounceTitle('');
                        setAnnounceMessage('');
                        setAnnounceOnSite(false);
                        setAnnounceUntil('');
                        setAnnounceSentAt(Date.now());
                        if (body.siteNotice) refresh();
                      } catch {
                        showError('Announce', 'Failed to send the announcement');
                      } finally {
                        setAnnounceBusy(false);
                      }
                    }}
                    className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                  >
                    Send announcement
                  </button>
                </div>
                {/* N3: the archive — what was sent, and which went to the site. */}
                <AnnouncementHistory plural={plural as 'clubs' | 'leagues'} orgId={orgId} refreshKey={announceSentAt} />
              </div>
              {/* M2 (both sides since program 12): the manager curates members' round photos onto the gallery. */}
              {site && (
                <MemberPhotoPicker side={side as 'league' | 'club'} orgId={orgId} onError={message => showError('Website', message)} />
              )}
              {/* R3 branding editors — flat inline forms (house pattern,
                  never a modal). Saves send the COMPLETE object (replace
                  semantics), seeded from the GET above. */}
              <div className="pt-2 space-y-1.5">
                <p className="text-sm font-medium text-primary">Hero</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={heroHeadline}
                    onChange={e => setHeroHeadline(e.target.value)}
                    maxLength={80}
                    placeholder={orgName ?? 'Headline'}
                    aria-label="Hero headline"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                  <input
                    type="text"
                    value={heroTagline}
                    onChange={e => setHeroTagline(e.target.value)}
                    maxLength={140}
                    placeholder="Schedules, standings, and teams — live."
                    aria-label="Hero tagline"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                </div>
                {/* S1: photo (a site image asset), the one button, the notice. */}
                <div className="flex flex-wrap items-center gap-2">
                  {heroImagePath && (
                    <Image
                      src={orgMediaUrl(site.id, heroImagePath) ?? ''}
                      alt=""
                      width={96}
                      height={54}
                      unoptimized
                      className="h-14 w-24 rounded object-cover border border-border"
                    />
                  )}
                  <label className="text-xs text-secondary">
                    {heroImagePath ? 'Replace photo' : 'Hero photo'}
                    <input
                      type="file"
                      accept="image/*"
                      aria-label="Hero photo"
                      className="block w-48 text-xs"
                      onChange={async e => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        const formData = new FormData();
                        formData.append('image', file);
                        try {
                          const res = await fetch(`/api/${plural}/${orgId}/site/assets`, {
                            method: 'POST',
                            body: formData,
                          });
                          const body = await res.json();
                          if (!res.ok) {
                            showError('Website', body.error || 'Failed to upload the photo');
                            return;
                          }
                          setHeroImagePath(body.path);
                        } catch {
                          showError('Website', 'Upload failed — please try again');
                        }
                      }}
                    />
                  </label>
                  {heroImagePath && (
                    <button
                      type="button"
                      onClick={() => setHeroImagePath('')}
                      className="px-2 py-1 text-xs rounded-md text-tertiary hover:bg-surface-sunken transition-colors"
                    >
                      Remove photo
                    </button>
                  )}
                  <input
                    type="text"
                    value={heroImageAlt}
                    onChange={e => setHeroImageAlt(e.target.value)}
                    maxLength={200}
                    placeholder="Photo description (for screen readers)"
                    aria-label="Hero photo description"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={heroCtaLabel}
                    onChange={e => setHeroCtaLabel(e.target.value)}
                    maxLength={24}
                    placeholder="Button label (e.g. Book a tee time)"
                    aria-label="Hero button label"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                  <input
                    type="url"
                    value={heroCtaUrl}
                    onChange={e => setHeroCtaUrl(e.target.value)}
                    maxLength={200}
                    placeholder="https:// (where the button goes)"
                    aria-label="Hero button link"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={heroNotice}
                    onChange={e => setHeroNotice(e.target.value)}
                    maxLength={200}
                    placeholder="Notice on every page (e.g. Cart path only this week)"
                    aria-label="Site notice"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                  <input
                    type="date"
                    value={heroNoticeUntil}
                    onChange={e => setHeroNoticeUntil(e.target.value)}
                    aria-label="Notice shown until"
                    title="Shown through this day"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void siteAct(
                        {
                          action: 'set_hero',
                          ...(heroHeadline.trim() ? { headline: heroHeadline.trim() } : {}),
                          ...(heroTagline.trim() ? { tagline: heroTagline.trim() } : {}),
                          ...(heroImagePath ? { imagePath: heroImagePath } : {}),
                          ...(heroImagePath && heroImageAlt.trim() ? { imageAlt: heroImageAlt.trim() } : {}),
                          ...(heroCtaLabel.trim() ? { ctaLabel: heroCtaLabel.trim() } : {}),
                          ...(heroCtaUrl.trim() ? { ctaUrl: heroCtaUrl.trim() } : {}),
                          ...(heroNotice.trim() ? { notice: heroNotice.trim() } : {}),
                          ...(heroNotice.trim() && heroNoticeUntil ? { noticeUntil: heroNoticeUntil } : {}),
                        },
                        'Hero updated',
                        'Failed to update the hero'
                      )
                    }
                    className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    Save hero
                  </button>
                </div>
              </div>
              <div className="pt-2 space-y-1.5">
                <p className="text-sm font-medium text-primary">Template</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TEMPLATE_IDS.map(id => {
                    const t = templateSpec(id);
                    const current = templateSpec(site.template_id).id === id;
                    return (
                      <label
                        key={id}
                        className={`flex items-start gap-2 rounded-lg border p-3 text-sm cursor-pointer ${
                          current ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-sunken'
                        }`}
                      >
                        <input
                          type="radio"
                          name="site-template"
                          checked={current}
                          aria-label={`${t.name} template`}
                          onChange={() =>
                            void siteAct(
                              { action: 'set_template', templateId: id },
                              `${t.name} template applied`,
                              'Failed to change the template'
                            )
                          }
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-medium text-primary">{t.name}</span>
                          <span className="block text-xs text-tertiary">{t.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="pt-2 space-y-1.5">
                <p className="text-sm font-medium text-primary">Brand</p>
                <p className="text-xs text-tertiary">
                  Colors, a wordmark and a typeface. Very light colors are rejected — the
                  hero text is white.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm text-secondary">
                    <input
                      type="color"
                      value={themeAccent || '#7c3aed'}
                      onChange={e => setThemeAccent(e.target.value)}
                      aria-label="Accent color"
                      className="h-9 w-12 rounded-md border border-border-strong bg-surface p-0.5"
                    />
                    Accent
                  </label>
                  <label className="flex items-center gap-2 text-sm text-secondary">
                    <input
                      type="color"
                      value={themeStrong || '#5b21b6'}
                      onChange={e => setThemeStrong(e.target.value)}
                      aria-label="Strong accent color"
                      className="h-9 w-12 rounded-md border border-border-strong bg-surface p-0.5"
                    />
                    Strong accent (gradient end, links)
                    {themeStrong && (
                      <button
                        type="button"
                        onClick={() => setThemeStrong('')}
                        className="text-xs text-tertiary hover:text-primary"
                      >
                        auto
                      </button>
                    )}
                  </label>
                  <label className="text-sm text-secondary">
                    <span className="block text-xs font-medium text-secondary mb-1">Wordmark</span>
                    <input
                      type="text"
                      value={themeWordmark}
                      onChange={e => setThemeWordmark(e.target.value)}
                      maxLength={WORDMARK_MAX}
                      placeholder={orgName ?? 'Your name, as branded'}
                      aria-label="Wordmark"
                      className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                    />
                  </label>
                  <label className="text-sm text-secondary">
                    <span className="block text-xs font-medium text-secondary mb-1">Typeface</span>
                    <select
                      value={themeTypeface}
                      onChange={e => setThemeTypeface(e.target.value as 'sans' | 'serif')}
                      aria-label="Typeface"
                      className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm bg-surface"
                    >
                      <option value="sans">Sans (default)</option>
                      <option value="serif">Serif headings</option>
                    </select>
                  </label>
                  <fieldset className="text-sm text-secondary sm:col-span-2">
                    <legend className="text-xs font-medium text-secondary mb-1">Background</legend>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="theme-surface"
                          checked={themeSurface === 'plain'}
                          onChange={() => setThemeSurface('plain')}
                        />
                        Plain
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="theme-surface"
                          checked={themeSurface === 'tinted'}
                          onChange={() => setThemeSurface('tinted')}
                        />
                        Tinted with the accent
                      </label>
                    </div>
                  </fieldset>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void siteAct(
                        {
                          action: 'set_theme',
                          accent: themeAccent || '#7c3aed',
                          accentStrong: themeStrong || null,
                          surface: themeSurface,
                          typeface: themeTypeface,
                          ...(themeWordmark.trim() ? { wordmark: themeWordmark.trim() } : {}),
                        },
                        'Brand updated',
                        'Failed to update the brand'
                      )
                    }
                    className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    Save brand
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void siteAct(
                        { action: 'set_theme', accent: null },
                        'Brand reset',
                        'Failed to reset the brand'
                      )
                    }
                    className="px-3 py-1.5 text-sm rounded-md text-tertiary hover:bg-surface-sunken transition-colors"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <div className="pt-2 space-y-1.5">
                <p className="text-sm font-medium text-primary">Documents &amp; policies</p>
                <p className="text-xs text-tertiary">
                  Upload a PDF or link to one hosted elsewhere. Shown when the Documents section is on.
                </p>
                {documentDrafts.map((d, index) => (
                  <div key={index} className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={d.title}
                      onChange={e =>
                        setDocumentDrafts(list =>
                          list.map((row, i) => (i === index ? { ...row, title: e.target.value } : row))
                        )
                      }
                      maxLength={80}
                      placeholder="Title (e.g. Code of conduct)"
                      aria-label={`Document ${index + 1} title`}
                      className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                    />
                    {d.path ? (
                      <span className="inline-flex items-center gap-1 text-xs text-secondary">
                        PDF attached
                        <button
                          type="button"
                          onClick={() =>
                            setDocumentDrafts(list =>
                              list.map((row, i) => (i === index ? { ...row, path: '' } : row))
                            )
                          }
                          className="text-tertiary hover:text-primary"
                          aria-label={`Detach document ${index + 1} file`}
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <>
                        <input
                          type="url"
                          value={d.url}
                          onChange={e =>
                            setDocumentDrafts(list =>
                              list.map((row, i) => (i === index ? { ...row, url: e.target.value } : row))
                            )
                          }
                          maxLength={200}
                          placeholder="https:// link (or upload)"
                          aria-label={`Document ${index + 1} link`}
                          className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                        />
                        <label className="flex items-center gap-1.5 text-xs text-tertiary">
                          PDF
                          <input
                            type="file"
                            accept="application/pdf"
                            aria-label={`Document ${index + 1} file`}
                            className="w-32 text-xs"
                            onChange={async e => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (!file) return;
                              const formData = new FormData();
                              formData.append('document', file);
                              try {
                                const res = await fetch(`/api/${plural}/${orgId}/site/assets`, {
                                  method: 'POST',
                                  body: formData,
                                });
                                const body = await res.json();
                                if (!res.ok) {
                                  showError('Website', body.error || 'Failed to upload the document');
                                  return;
                                }
                                setDocumentDrafts(list =>
                                  list.map((row, i) =>
                                    i === index ? { ...row, path: body.path, url: '' } : row
                                  )
                                );
                              } catch {
                                showError('Website', 'Upload failed — please try again');
                              }
                            }}
                          />
                        </label>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setDocumentDrafts(list => list.filter((_, i) => i !== index))}
                      aria-label={`Remove document ${index + 1}`}
                      className="px-2 text-tertiary hover:text-primary"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  {documentDrafts.length < 20 && (
                    <button
                      type="button"
                      onClick={() =>
                        setDocumentDrafts(list => [...list, { title: '', path: '', url: '' }])
                      }
                      className="px-3 py-1.5 text-sm rounded-md text-tertiary hover:bg-surface-sunken transition-colors"
                    >
                      + Add document
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      void siteAct(
                        {
                          action: 'set_documents',
                          documents: documentDrafts
                            .filter(d => d.title.trim() && (d.path || d.url.trim()))
                            .map(d => ({
                              title: d.title.trim(),
                              ...(d.path ? { path: d.path } : { url: d.url.trim() }),
                            })),
                        },
                        'Documents saved',
                        'Failed to save documents'
                      )
                    }
                    className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    Save documents
                  </button>
                </div>
              </div>
              <div className="pt-2 space-y-1.5">
                <p className="text-sm font-medium text-primary">Sponsors</p>
                {sponsorDrafts.map((s, index) => (
                  <div key={index} className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={s.name}
                      onChange={e =>
                        setSponsorDrafts(d =>
                          d.map((row, i) => (i === index ? { ...row, name: e.target.value } : row))
                        )
                      }
                      maxLength={80}
                      placeholder="Sponsor name"
                      aria-label={`Sponsor ${index + 1} name`}
                      className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                    />
                    <input
                      type="url"
                      value={s.url}
                      onChange={e =>
                        setSponsorDrafts(d =>
                          d.map((row, i) => (i === index ? { ...row, url: e.target.value } : row))
                        )
                      }
                      maxLength={200}
                      placeholder="https:// (optional)"
                      aria-label={`Sponsor ${index + 1} link`}
                      className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-tertiary">
                      {s.logoPath ? (
                        <Image
                          src={orgMediaUrl(site.id, s.logoPath) ?? ''}
                          alt=""
                          width={24}
                          height={24}
                          unoptimized
                          className="rounded border border-border shrink-0"
                        />
                      ) : (
                        'Logo'
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        aria-label={`Sponsor ${index + 1} logo`}
                        className="w-32 text-xs"
                        onChange={async e => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          const formData = new FormData();
                          formData.append('image', file);
                          try {
                            const res = await fetch(`/api/${plural}/${orgId}/site/assets`, {
                              method: 'POST',
                              body: formData,
                            });
                            const body = await res.json();
                            if (!res.ok) {
                              showError('Website', body.error || 'Failed to upload the logo');
                              return;
                            }
                            setSponsorDrafts(d =>
                              d.map((row, i) =>
                                i === index ? { ...row, logoPath: body.path } : row
                              )
                            );
                          } catch {
                            showError('Website', 'Upload failed — please try again');
                          }
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setSponsorDrafts(d => d.filter((_, i) => i !== index))}
                      aria-label={`Remove sponsor ${index + 1}`}
                      className="px-2 text-tertiary hover:text-primary"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  {sponsorDrafts.length < 20 && (
                    <button
                      type="button"
                      onClick={() =>
                        setSponsorDrafts(d => [...d, { name: '', url: '', logoPath: '' }])
                      }
                      className="px-3 py-1.5 text-sm rounded-md text-tertiary hover:bg-surface-sunken transition-colors"
                    >
                      + Add sponsor
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      void siteAct(
                        {
                          action: 'set_sponsors',
                          sponsors: sponsorDrafts
                            .filter(s => s.name.trim())
                            .map(s => ({
                              name: s.name.trim(),
                              ...(s.url.trim() ? { url: s.url.trim() } : {}),
                              ...(s.logoPath ? { logoPath: s.logoPath } : {}),
                            })),
                        },
                        'Sponsors updated',
                        'Failed to update sponsors'
                      )
                    }
                    className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    Save sponsors
                  </button>
                </div>
              </div>
              {/* Cleanup round: contact — the three DELIBERATELY public
                  fields (manager-entered org contact info); Save sends the
                  complete object (replace semantics). */}
              <div className="pt-2 space-y-1.5">
                <p className="text-sm font-medium text-primary">Contact</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={e => setContactEmail(e.target.value)}
                    maxLength={200}
                    placeholder="contact@your-org.example"
                    aria-label="Contact email"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                  <input
                    type="tel"
                    value={contactPhone}
                    onChange={e => setContactPhone(e.target.value)}
                    maxLength={40}
                    placeholder="Phone (optional)"
                    aria-label="Contact phone"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                  <input
                    type="url"
                    value={contactWebsite}
                    onChange={e => setContactWebsite(e.target.value)}
                    maxLength={200}
                    placeholder="https:// (optional)"
                    aria-label="Contact website"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                </div>
                {/* S1: address, hours, directions, socials — the golf club's card. */}
                <div className="flex flex-wrap gap-2">
                  {contactAddress.map((line, i) => (
                    <input
                      key={i}
                      type="text"
                      value={line}
                      onChange={e =>
                        setContactAddress(a => a.map((v, j) => (j === i ? e.target.value : v)))
                      }
                      maxLength={80}
                      placeholder={i === 0 ? 'Street address' : i === 1 ? 'City, region' : 'Postal code, country'}
                      aria-label={`Address line ${i + 1}`}
                      className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <textarea
                    value={contactHours}
                    onChange={e => setContactHours(e.target.value)}
                    maxLength={200}
                    rows={2}
                    placeholder={'Hours (e.g. Pro shop 7am–8pm daily\nRange closes at dusk)'}
                    aria-label="Hours"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                  <input
                    type="url"
                    value={contactDirections}
                    onChange={e => setContactDirections(e.target.value)}
                    maxLength={200}
                    placeholder="Directions link (optional — the address makes one)"
                    aria-label="Directions link"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['instagram', 'facebook', 'x', 'youtube'] as const).map(n => (
                    <input
                      key={n}
                      type="url"
                      value={contactSocial[n]}
                      onChange={e => setContactSocial(s => ({ ...s, [n]: e.target.value }))}
                      maxLength={200}
                      placeholder={`${n === 'x' ? 'X' : n[0].toUpperCase() + n.slice(1)} URL`}
                      aria-label={`${n === 'x' ? 'X' : n[0].toUpperCase() + n.slice(1)} link`}
                      className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const address = contactAddress.map(l => l.trim()).filter(Boolean);
                      const social = Object.fromEntries(
                        Object.entries(contactSocial)
                          .map(([k, v]) => [k, v.trim()])
                          .filter(([, v]) => v)
                      );
                      void siteAct(
                        {
                          action: 'set_contact',
                          ...(contactEmail.trim() ? { email: contactEmail.trim() } : {}),
                          ...(contactPhone.trim() ? { phone: contactPhone.trim() } : {}),
                          ...(contactWebsite.trim() ? { website: contactWebsite.trim() } : {}),
                          ...(address.length ? { address } : {}),
                          ...(contactHours.trim() ? { hours: contactHours.trim() } : {}),
                          ...(contactDirections.trim() ? { directionsUrl: contactDirections.trim() } : {}),
                          ...(Object.keys(social).length ? { social } : {}),
                        },
                        'Contact updated',
                        'Failed to update contact'
                      );
                    }}
                    className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    Save contact
                  </button>
                </div>
                <p className="text-xs text-tertiary">
                  These details are published on your public site.
                </p>
              </div>
              {/* R3: custom pages — list + create here; the block editor is
                  a subpage (the competitions-detail precedent). */}
              <div className="pt-2 space-y-1.5">
                <p className="text-sm font-medium text-primary">Pages</p>
                {sitePages.map(p => (
                  <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm text-primary min-w-0 truncate">{p.title}</span>
                    <span className="text-xs text-muted">/{p.slug}</span>
                    {p.visibility === 'public' ? (
                      <span className="text-xs text-emerald-600">public</span>
                    ) : (
                      <span className="text-xs text-amber-600">draft</span>
                    )}
                    <Link
                      href={`/app/org/${side}/${orgId}/site/pages/${p.id}`}
                      className="text-sm text-brand-fg font-medium"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmTarget({ kind: 'page', id: p.id, label: p.title })
                      }
                      className="text-sm text-tertiary hover:text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={pageTitle}
                    onChange={e => setPageTitle(e.target.value)}
                    maxLength={120}
                    placeholder="New page title"
                    aria-label="New page title"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!pageTitle.trim()) {
                        showError('Website', 'A page title is required');
                        return;
                      }
                      const ok = await act(
                        `/api/${plural}/${orgId}/site/pages`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ title: pageTitle.trim() }),
                        },
                        'Page created — it starts as a draft',
                        'Failed to create the page',
                        'Website'
                      );
                      if (ok) setPageTitle('');
                    }}
                    className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    Add page
                  </button>
                </div>
              </div>
              {/* Phase 3.5: news posts — same shape as Pages; published_at
                  is the state and the feed order. */}
              <div className="pt-2 space-y-1.5">
                <p className="text-sm font-medium text-primary">News</p>
                {siteNews.map(n => (
                  <div key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm text-primary min-w-0 truncate">{n.title}</span>
                    <span className="text-xs text-muted">/news/{n.slug}</span>
                    {n.published_at ? (
                      <span className="text-xs text-emerald-600">published</span>
                    ) : (
                      <span className="text-xs text-amber-600">draft</span>
                    )}
                    {n.audience === 'members' && (
                      <span className="text-xs text-secondary" data-news-audience="members">members only</span>
                    )}
                    <Link
                      href={`/app/org/${side}/${orgId}/site/news/${n.id}`}
                      className="text-sm text-brand-fg font-medium"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => setConfirmTarget({ kind: 'news', id: n.id, label: n.title })}
                      className="text-sm text-tertiary hover:text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={newsTitle}
                    onChange={e => setNewsTitle(e.target.value)}
                    maxLength={120}
                    placeholder="New post title"
                    aria-label="New post title"
                    className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newsTitle.trim()) {
                        showError('Website', 'A post title is required');
                        return;
                      }
                      const ok = await act(
                        `/api/${plural}/${orgId}/site/news`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ title: newsTitle.trim() }),
                        },
                        'Post created — it starts as a draft',
                        'Failed to create the post',
                        'Website'
                      );
                      if (ok) setNewsTitle('');
                    }}
                    className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    Add post
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </>
    ),
  };

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-primary">
            <i className="fas fa-sitemap mr-2 text-brand-fg" aria-hidden="true"></i>
            {orgName ?? 'Organization'}
            {pending && (
              <span className="ml-3 align-middle inline-block px-2 py-0.5 text-xs font-semibold uppercase rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                Pending approval
              </span>
            )}
          </h1>
          {pending && (
            <p className="mt-1 text-sm text-secondary">
              Awaiting approval — you can keep building; publishing unlocks when approved.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={`/${side}/${orgId}`} className="text-brand-fg hover:text-brand-fg-strong">
              View public page
            </Link>
            <Link
              href={`/${side}/${orgId}`}
              className="text-brand-fg hover:text-brand-fg-strong"
            >
              Members &amp; roster
            </Link>
          </div>
        </div>

        <OrgSetupChecklist
          storageKey={`org-checklist:${side}:${orgId}`}
          variant={golfFirst ? 'golf' : 'default'}
          input={{
            hasSeasonWithDates,
            hasDivisions,
            hasTeams: teams.length > 0,
            managerCount: counts.managers,
            rosterAthleteCount: counts.rosterAthletes,
            // C5 (golf variant) — all derived from rows already fetched.
            hasSite: !!site,
            hasSitePhotoOrCta: !!(heroImagePath || heroCtaUrl),
            hasHomeCourse: venues.some(v => v.courses.length > 0),
            sitePublished: !!site?.published_at,
            memberCount,
            hasGolfLeague: competitions.some(c => c.sport_key === 'golf' && c.format === 'leaderboard'),
            hasNotice: !!heroNotice,
            ...(FEATURE_FLAGS.FEATURE_ORG_REGISTRATION && regAvailable
              ? { hasOpenRegistration: regWindows.length > 0 }
              : {}),
          }}
        />

        {CONSOLE_SECTION_ORDER[golfFirst ? 'golf' : 'default']
          .filter(key => key === 'hierarchy' || !visibleKeys || visibleKeys.includes(key))
          .map(key => (
            <Fragment key={key}>{sectionNodes[key]}</Fragment>
          ))}
      </main>

      <ConfirmModal
        isOpen={!!confirmTarget}
        title={confirmTarget?.kind === 'layout' ? 'Reset the section order?' : `Delete ${confirmTarget?.label ?? 'this'}?`}
        message={
          confirmTarget?.kind === 'season'
            ? 'Its divisions and their entries are removed too. Teams persist.'
            : confirmTarget?.kind === 'venue'
              ? 'Its facilities are removed too. Events keep their dates.'
            : confirmTarget?.kind === 'layout'
              ? `Sections go back to the recommended ${side} order. Your section labels are kept.`
            : confirmTarget?.kind === 'domain'
              ? 'Visitors on that domain will stop reaching your site. Your Edge Athlete address keeps working.'
            : confirmTarget?.kind === 'page' || confirmTarget?.kind === 'news'
              ? `The ${confirmTarget.kind === 'page' ? 'page' : 'post'} comes off your site immediately.`
              : 'Its entries are removed too. Teams persist.'
        }
        confirmText={confirmTarget?.kind === 'layout' ? 'Reset' : 'Delete'}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => {
          const target = confirmTarget;
          setConfirmTarget(null);
          if (target) remove(target);
        }}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
