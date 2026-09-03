// ── Public org-site data readers (phase 3 R2) ───────────────────────────────
// Viewer-independent plain-data reads for the (public)/org/[slug] modules,
// consumed ONLY through the cached wrappers in ./cached.ts (tag
// org-site:{slug}, 300s). The standings contract binds every function:
// nothing here may branch on a session, and nothing here may THROW — a
// throw inside unstable_cache 500s the page; a pre-migration database
// (missing table/column) is an empty module, never an error.
//
// The masking invariant: names of PEOPLE pass through publicDisplayName
// (full name only for claimed, unsupervised public profiles, else
// "First L."), and email/supervision_state are selected ONLY to feed it —
// no reader's return type carries email, handle, or avatar. Media reaches
// the public site ONLY through the phase-4 gallery gate (fetchPublicGallery
// — org-published + every tag photo-consented; supervised athletes are
// never labeled).

import type { SupabaseClient } from '@supabase/supabase-js';
import { publicSubpageKeys } from './private';
import { parseGolfPointsConfig } from '@/lib/competitions/golf-points';
import { roundRuleFor } from '@/lib/competitions/golf-league';
import type { OrgSide } from '@/lib/orgs/authz';
import { groupAnnouncements, type AnnouncementNotificationRow } from '@/lib/orgs/announce';
import { publicDisplayName, type MaskableProfile, publicHandle } from '@/lib/orgs/public-names';
import { listAffiliations } from '@/lib/affiliations/server';
import { type OrgEvent } from '@/lib/calendar/org-events-server';
import { isMissingTableError, MODULE_SUBPAGE_KEYS } from './validate';
import { CATALOG_ROW_COLUMNS, rowToCourse, type CatalogRow } from '@/lib/golf/course-catalog';
import { parseStoredHoleGeometry } from '@/lib/golf/hole-svg';
import type { HoleGeometry } from '@/lib/golf/hole-geometry';
import type { GolfCourse } from '@/types/golf';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import type { PublicCompetitionStandings } from '@/lib/competitions/public-standings';
import { sortWeeks, utcToday, weekState, type GolfWeekState } from '@/lib/competitions/golf-weeks';
import { buildGolfLeaderBoards, type GolfLeaderInputRow } from '@/lib/competitions/golf-leaders';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG SITE DATA]';

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

/** True for "this module has nothing" errors; logs and returns true for
 *  real errors too — public modules degrade, they never 500. */
function degraded(context: string, error: { code?: string } | null): boolean {
  if (!error) return false;
  if (!isMissingTableError(error.code) && error.code !== '42703') {
    console.error(`${TAG} ${context} error:`, error);
  }
  return true;
}

// ── Teams ───────────────────────────────────────────────────────────────────

export interface PublicTeam {
  id: string;
  name: string;
  divisionLabels: string[]; // "U13 A · 2026 Winter"
}

export async function fetchPublicTeams(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<PublicTeam[]> {
  const col = orgColumn(side);
  const { data: teams, error } = await admin
    .from('teams')
    .select('id, name, display_name')
    .eq(col, orgId)
    .eq('status', 'active')
    .order('name', { ascending: true })
    .limit(200);
  if (degraded('teams', error) || !teams || teams.length === 0) return [];

  const teamIds = teams.map(t => t.id as string);
  const { data: entries } = await admin
    .from('team_entries')
    .select('team_id, division_id')
    .in('team_id', teamIds);
  const divisionIds = [...new Set((entries ?? []).map(e => e.division_id as string))];
  const { data: divisions } = divisionIds.length
    ? await admin.from('divisions').select('id, season_id, name').in('id', divisionIds)
    : { data: [] };
  const seasonIds = [...new Set((divisions ?? []).map(d => d.season_id as string))];
  const { data: seasons } = seasonIds.length
    ? await admin.from('seasons').select('id, label').in('id', seasonIds)
    : { data: [] };

  const seasonLabel = new Map((seasons ?? []).map(s => [s.id, s.label as string]));
  const divisionLabel = new Map(
    (divisions ?? []).map(d => {
      const season = seasonLabel.get(d.season_id);
      return [d.id, season ? `${d.name} · ${season}` : (d.name as string)];
    })
  );
  const labelsByTeam = new Map<string, string[]>();
  for (const e of entries ?? []) {
    const label = divisionLabel.get(e.division_id);
    if (!label) continue;
    if (!labelsByTeam.has(e.team_id)) labelsByTeam.set(e.team_id, []);
    labelsByTeam.get(e.team_id)!.push(label);
  }

  return teams.map(t => ({
    id: t.id as string,
    name: (t.display_name || t.name) as string,
    divisionLabels: labelsByTeam.get(t.id) ?? [],
  }));
}

// ── Staff (owner/manager names ONLY — Tom's adopted phase-3 decision) ───────

export interface PublicStaffRow {
  name: string;
  role: 'owner' | 'manager';
}

export async function fetchPublicStaff(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<PublicStaffRow[]> {
  const { data, error } = await admin
    .from('memberships')
    .select('role, profile:profile_id (first_name, last_name, full_name, visibility, email, supervision_state)')
    .eq(orgColumn(side), orgId)
    .eq('kind', 'follow')
    .eq('scope_type', 'org')
    .eq('status', 'active')
    .in('role', ['owner', 'manager'])
    .limit(50);
  if (degraded('staff', error) || !data) return [];

  // The embedded select defeats supabase-js's type parser; cast once.
  const rows = data as unknown as Array<{
    role: 'owner' | 'manager';
    profile: MaskableProfile | null;
  }>;
  return rows
    .filter(r => r.profile)
    .map(r => ({ name: publicDisplayName(r.profile!), role: r.role }))
    .sort((a, b) =>
      a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'owner' ? -1 : 1
    );
}

// ── Venues ──────────────────────────────────────────────────────────────────

export interface PublicVenue {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  facilities: { id: string; name: string; kind: string | null }[];
}

export async function fetchPublicVenues(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<PublicVenue[]> {
  const { data: venues, error } = await admin
    .from('venues')
    .select('id, name, city, region, country')
    .eq(orgColumn(side), orgId)
    .order('name', { ascending: true })
    .limit(50);
  if (degraded('venues', error) || !venues || venues.length === 0) return [];

  const venueIds = venues.map(v => v.id as string);
  const { data: facilities } = await admin
    .from('facilities')
    .select('id, venue_id, name, kind')
    .in('venue_id', venueIds)
    .order('name', { ascending: true });
  const byVenue = new Map<string, PublicVenue['facilities']>();
  for (const f of facilities ?? []) {
    if (!byVenue.has(f.venue_id)) byVenue.set(f.venue_id, []);
    byVenue.get(f.venue_id)!.push({
      id: f.id as string,
      name: f.name as string,
      kind: (f.kind ?? null) as string | null,
    });
  }
  return venues.map(v => ({
    id: v.id as string,
    name: v.name as string,
    city: (v.city ?? null) as string | null,
    region: (v.region ?? null) as string | null,
    country: (v.country ?? null) as string | null,
    facilities: byVenue.get(v.id) ?? [],
  }));
}

// ── Affiliations (active subset only — the public branch of 118) ────────────

export interface PublicAffiliation {
  name: string;
  affiliationType: string | null;
  city: string | null;
  region: string | null;
  /** Phase 6 R3: 'up' = this org sits under the named org (sanctioned
   *  by / member of it); 'down' = the named org sits under this one.
   *  null for the flat league↔club edges (the pre-167 vocabulary). */
  direction?: 'up' | 'down' | null;
}

export async function fetchPublicAffiliations(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<PublicAffiliation[]> {
  const listed = await listAffiliations(admin, side, orgId);
  if (!listed) return [];
  const flat: PublicAffiliation[] = listed.rows
    .filter(r => r.status === 'active' && r.org)
    .map(r => ({
      name: r.org!.name,
      affiliationType: r.affiliation_type,
      city: r.org!.city ?? null,
      region: r.org!.region ?? null,
      direction: null,
    }));
  // Phase 6 R3: leagues also show their league↔league chain (the public
  // sanctioning story). Best-effort — pre-167 reads as no chain.
  if (side !== 'league') return flat;
  const { listParentAffiliations } = await import('@/lib/affiliations/parents-server');
  const chain = await listParentAffiliations(admin, orgId);
  if (!chain) return flat;
  const chainRows: PublicAffiliation[] = chain.rows
    .filter(r => r.status === 'active' && r.org)
    .map(r => ({
      name: r.org!.name,
      affiliationType: r.affiliation_type,
      city: r.org!.city ?? null,
      region: r.org!.region ?? null,
      direction: r.league_id === orgId ? ('up' as const) : ('down' as const),
    }));
  return [...chainRows.filter(r => r.direction === 'up'), ...flat,
          ...chainRows.filter(r => r.direction === 'down')];
}

// ── Team page (Tom's decision 3: FULL team pages, masked rosters) ───────────

export interface PublicTeamRecord {
  competitionName: string;
  seasonLabel: string | null;
  rank: number;
  played: number;
  points: number | null;
}

export interface PublicTeamPage {
  team: { id: string; name: string; divisionLabels: string[] };
  roster: { name: string }[]; // masked, nothing else — NO ids, NO media
  events: OrgEvent[];
  records: PublicTeamRecord[];
}

const TEAM_EVENT_FIELDS =
  'id, title, description, location, starts_at, ends_at, all_day, timezone, category, venue_id, facility_id';

/** One team of THIS org (the org-column filter is the security line — a
 *  foreign teamId under this slug must 404 indistinguishably), or null. */
export async function fetchPublicTeamPage(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  teamId: string
): Promise<PublicTeamPage | null> {
  const col = orgColumn(side);
  const { data: team, error } = await admin
    .from('teams')
    .select('id, name, display_name')
    .eq('id', teamId)
    .eq(col, orgId)
    .eq('status', 'active')
    .maybeSingle();
  if (degraded('team', error) || !team) return null;

  const [entriesRes, rosterRes, eventsRes, compEntriesRes] = await Promise.all([
    admin.from('team_entries').select('division_id').eq('team_id', teamId),
    admin
      .from('memberships')
      .select('joined_at, profile:profile_id (first_name, last_name, full_name, visibility, email, supervision_state)')
      .eq(col, orgId)
      .eq('kind', 'roster')
      .eq('status', 'active')
      .eq('scope_type', 'team')
      .eq('scope_id', teamId)
      .limit(100),
    admin
      .from('events')
      .select(TEAM_EVENT_FIELDS)
      .eq('team_id', teamId)
      .eq('status', 'active')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(10),
    admin
      .from('competition_entries')
      .select('id, competition_id')
      .eq('team_id', teamId)
      .eq('status', 'approved')
      .limit(50),
  ]);

  // Division labels for the header.
  const divisionIds = [...new Set((entriesRes.data ?? []).map(e => e.division_id as string))];
  const { data: divisions } = divisionIds.length
    ? await admin.from('divisions').select('id, season_id, name').in('id', divisionIds)
    : { data: [] };
  const seasonIdsForDivisions = [...new Set((divisions ?? []).map(d => d.season_id as string))];

  // Record rows: entries → standings → PUBLIC competitions only.
  const compEntries = compEntriesRes.data ?? [];
  const entryIds = compEntries.map(e => e.id as string);
  const { data: standingRows } = entryIds.length
    ? await admin
        .from('competition_standings')
        .select('entry_id, competition_id, rank, points, played')
        .in('entry_id', entryIds)
    : { data: [] };
  const compIds = [...new Set((standingRows ?? []).map(r => r.competition_id as string))];
  const { data: competitions } = compIds.length
    ? await admin
        .from('competitions')
        .select('id, name, season_id')
        .in('id', compIds)
        .eq('visibility', 'public')
        .in('status', ['active', 'completed'])
    : { data: [] };
  const seasonIds = [
    ...new Set([
      ...seasonIdsForDivisions,
      ...(competitions ?? []).map(c => c.season_id as string),
    ]),
  ];
  const { data: seasons } = seasonIds.length
    ? await admin.from('seasons').select('id, label').in('id', seasonIds)
    : { data: [] };
  const seasonLabel = new Map((seasons ?? []).map(s => [s.id, s.label as string]));
  const publicComp = new Map((competitions ?? []).map(c => [c.id, c]));

  const records: PublicTeamRecord[] = (standingRows ?? [])
    .filter(r => publicComp.has(r.competition_id))
    .map(r => {
      const comp = publicComp.get(r.competition_id)!;
      return {
        competitionName: comp.name as string,
        seasonLabel: seasonLabel.get(comp.season_id) ?? null,
        rank: r.rank as number,
        played: (r.played ?? 0) as number,
        points: (r.points ?? null) as number | null,
      };
    })
    .sort((a, b) => a.competitionName.localeCompare(b.competitionName));

  const rosterRows = (rosterRes.data ?? []) as unknown as Array<{
    profile: MaskableProfile | null;
  }>;
  const roster = rosterRows
    .filter(r => r.profile)
    .map(r => ({ name: publicDisplayName(r.profile!) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const divisionLabels = (divisions ?? []).map(d => {
    const season = seasonLabel.get(d.season_id);
    return season ? `${d.name} · ${season}` : (d.name as string);
  });

  return {
    team: {
      id: team.id as string,
      name: (team.display_name || team.name) as string,
      divisionLabels,
    },
    roster,
    events: (eventsRes.data ?? []) as unknown as OrgEvent[],
    records,
  };
}

// ── Custom pages (phase 3 R3) ───────────────────────────────────────────────

export interface PublicPageLink {
  slug: string;
  title: string;
}

export interface PublicPageRow {
  slug: string;
  title: string;
  body: unknown; // parsed defensively at render (parsePageBody)
}

/** Public pages of a site (nav + existence checks). */
export async function fetchPublicPages(
  admin: Admin,
  siteId: string
): Promise<PublicPageLink[]> {
  const { data, error } = await admin
    .from('org_site_pages')
    .select('slug, title')
    .eq('site_id', siteId)
    .eq('visibility', 'public')
    .order('created_at', { ascending: true })
    .limit(20);
  if (degraded('pages', error) || !data) return [];
  return data.map(p => ({ slug: p.slug as string, title: p.title as string }));
}

/** One PUBLIC page by slug — drafts are indistinguishable from missing. */
export async function fetchPublicPage(
  admin: Admin,
  siteId: string,
  pageSlug: string
): Promise<PublicPageRow | null> {
  const { data, error } = await admin
    .from('org_site_pages')
    .select('slug, title, body')
    .eq('site_id', siteId)
    .eq('slug', pageSlug)
    .eq('visibility', 'public')
    .maybeSingle();
  if (degraded('page', error) || !data) return null;
  return { slug: data.slug as string, title: data.title as string, body: data.body };
}

// ── Sitemap enumeration (phase 3 R4) ────────────────────────────────────────

export interface SitemapSiteEntry {
  subdomain: string;
  /** C2: the ACTIVE custom domain, or null — such sites leave the main
   *  sitemap (cross-host URLs aren't allowed there) and get their own. */
  customDomain: string | null;
  lastModified: string | null;
  moduleKeys: string[]; // enabled subpage modules (news/standings/schedule/teams/gallery/courses)
  pageSlugs: string[]; // public custom pages
  teamIds: string[]; // active teams, only when the teams module is enabled
  newsSlugs: string[]; // published posts, only when the news module is enabled
  courseIds: string[]; // S2: linked catalog courses, only when the courses module is enabled
  playerHandles: string[]; // P2: public players, only when the standings module is enabled
}

/** Every published site with its crawlable sub-URLs — the repo's first
 *  org_sites enumerator, explicitly bounded (house rule). Cached under
 *  the 'org-sitemap' tag; publish/unpublish purge it, module/page churn
 *  rides the hourly revalidate. Degrades partial, never throws. */
export async function fetchPublishedSitesForSitemap(
  admin: Admin
): Promise<SitemapSiteEntry[]> {
  const readSites = (fields: string) =>
    admin
      .from('org_sites')
      .select(fields)
      .not('published_at', 'is', null)
      .order('created_at', { ascending: true })
      .limit(500);
  // C2 widens the select; a pre-171 database retries without the columns.
  let { data: sites, error } = await readSites(
    'id, subdomain, updated_at, league_id, club_id, custom_domain, domain_active_at'
  );
  if (error?.code === '42703') {
    ({ data: sites, error } = await readSites('id, subdomain, updated_at, league_id, club_id'));
  }
  if (degraded('sitemap sites', error) || !sites || sites.length === 0) return [];
  // The dynamic select string defeats supabase-js's type parser; cast once.
  const siteRows = sites as unknown as {
    id: string;
    subdomain: string;
    updated_at: string | null;
    league_id: string | null;
    club_id: string | null;
    custom_domain?: string | null;
    domain_active_at?: string | null;
  }[];

  const siteIds = siteRows.map(s => s.id);
  const leagueIds = siteRows.map(s => s.league_id).filter(Boolean) as string[];
  const clubIds = siteRows.map(s => s.club_id).filter(Boolean) as string[];
  const [modulesRes, pagesRes, newsRes, leagueTeamsRes, clubTeamsRes] = await Promise.all([
    admin
      .from('org_site_modules')
      .select('site_id, module_key')
      .in('site_id', siteIds)
      .eq('enabled', true)
      .in('module_key', [...MODULE_SUBPAGE_KEYS])
      .limit(1500),
    admin
      .from('org_site_pages')
      .select('site_id, slug')
      .in('site_id', siteIds)
      .eq('visibility', 'public')
      .limit(2000),
    admin
      .from('org_site_news')
      .select('site_id, slug')
      .in('site_id', siteIds)
      .not('published_at', 'is', null)
      .limit(5000),
    // Teams key by ORG, not site — two by-side batches, bounded.
    leagueIds.length
      ? admin
          .from('teams')
          .select('id, league_id')
          .in('league_id', leagueIds)
          .eq('status', 'active')
          .limit(5000)
      : Promise.resolve({ data: [] as { id: string; league_id: string }[] }),
    clubIds.length
      ? admin
          .from('teams')
          .select('id, club_id')
          .in('club_id', clubIds)
          .eq('status', 'active')
          .limit(5000)
      : Promise.resolve({ data: [] as { id: string; club_id: string }[] }),
  ]);
  const modulesBySite = new Map<string, string[]>();
  for (const m of modulesRes.data ?? []) {
    if (!modulesBySite.has(m.site_id)) modulesBySite.set(m.site_id, []);
    modulesBySite.get(m.site_id)!.push(m.module_key as string);
  }
  const pagesBySite = new Map<string, string[]>();
  for (const p of pagesRes.data ?? []) {
    if (!pagesBySite.has(p.site_id)) pagesBySite.set(p.site_id, []);
    pagesBySite.get(p.site_id)!.push(p.slug as string);
  }
  const newsBySite = new Map<string, string[]>();
  for (const n of newsRes.data ?? []) {
    if (!newsBySite.has(n.site_id)) newsBySite.set(n.site_id, []);
    newsBySite.get(n.site_id)!.push(n.slug as string);
  }

  const teamsByOrg = new Map<string, string[]>();
  for (const t of leagueTeamsRes.data ?? []) {
    const key = `league:${t.league_id}`;
    if (!teamsByOrg.has(key)) teamsByOrg.set(key, []);
    teamsByOrg.get(key)!.push(t.id as string);
  }
  for (const t of clubTeamsRes.data ?? []) {
    const key = `club:${(t as { club_id: string }).club_id}`;
    if (!teamsByOrg.has(key)) teamsByOrg.set(key, []);
    teamsByOrg.get(key)!.push(t.id as string);
  }

  // S2: course pages — the venues' golf links → catalog ids (a club link
  // is every section at that club; the matchCourseIds rule). Bounded and
  // best-effort: a pre-169 database simply lists no course pages.
  const coursesByOrg = new Map<string, string[]>();
  try {
    const [lv, cv] = await Promise.all([
      leagueIds.length
        ? admin.from('venues').select('league_id, golf_club_id, golf_course_id').in('league_id', leagueIds).limit(2000)
        : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
      clubIds.length
        ? admin.from('venues').select('club_id, golf_club_id, golf_course_id').in('club_id', clubIds).limit(2000)
        : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
    ]);
    type VenueLink = { key: string; golf_club_id: unknown; golf_course_id: unknown };
    const venueRows: VenueLink[] = [
      ...((lv.data ?? []) as Record<string, unknown>[]).map(v => ({
        key: `league:${v.league_id}`,
        golf_club_id: v.golf_club_id,
        golf_course_id: v.golf_course_id,
      })),
      ...((cv.data ?? []) as Record<string, unknown>[]).map(v => ({
        key: `club:${v.club_id}`,
        golf_club_id: v.golf_club_id,
        golf_course_id: v.golf_course_id,
      })),
    ];
    const golfClubIds = [...new Set(venueRows.map(v => v.golf_club_id).filter((id): id is string => typeof id === 'string'))];
    const { data: sectionRows } = golfClubIds.length
      ? await admin.from('golf_courses').select('id, club_id').in('club_id', golfClubIds).limit(2000)
      : { data: [] as { id: string; club_id: string }[] };
    const sectionsByClub = new Map<string, string[]>();
    for (const r of sectionRows ?? []) {
      const cid = r.club_id as string;
      if (!sectionsByClub.has(cid)) sectionsByClub.set(cid, []);
      sectionsByClub.get(cid)!.push(r.id as string);
    }
    for (const v of venueRows) {
      const ids = typeof v.golf_club_id === 'string'
        ? (sectionsByClub.get(v.golf_club_id) ?? [])
        : typeof v.golf_course_id === 'string'
          ? [v.golf_course_id]
          : [];
      if (ids.length === 0) continue;
      if (!coursesByOrg.has(v.key)) coursesByOrg.set(v.key, []);
      const bucket = coursesByOrg.get(v.key)!;
      for (const id of ids) if (!bucket.includes(id)) bucket.push(id);
    }
  } catch {
    /* pre-169 — no course pages in the sitemap */
  }

  // Phase 9 V4: private clubs — the members-only subpages leave the sitemap.
  const privateClubs = new Set<string>();
  if (clubIds.length) {
    const { data: vis } = await admin.from('clubs').select('id, visibility').in('id', clubIds);
    for (const c of vis ?? []) if ((c as { visibility?: string }).visibility === 'private') privateClubs.add(c.id as string);
  }
  const visibilityOf = (r: { league_id: string | null; club_id: string | null }): 'public' | 'private' =>
    r.club_id && privateClubs.has(r.club_id) ? 'private' : 'public';

  // P2: public players per org (bounded; the standings module gates).
  const playersByOrg = await fetchPlayerHandlesForOrgs(
    admin,
    siteRows
      .filter(r => (modulesBySite.get(r.id) ?? []).includes('standings') && visibilityOf(r) === 'public')
      .map(r =>
        r.league_id
          ? { key: `league:${r.league_id}`, side: 'league' as const, orgId: r.league_id }
          : { key: `club:${r.club_id}`, side: 'club' as const, orgId: r.club_id as string }
      )
  );

  return siteRows.map(s => {
    const visibility = visibilityOf(s);
    const moduleKeys = publicSubpageKeys(visibility, modulesBySite.get(s.id) ?? []);
    const orgKey = s.league_id ? `league:${s.league_id}` : `club:${s.club_id}`;
    return {
      subdomain: s.subdomain as string,
      customDomain:
        s.custom_domain && s.domain_active_at ? (s.custom_domain as string) : null,
      lastModified: (s.updated_at ?? null) as string | null,
      moduleKeys,
      pageSlugs: pagesBySite.get(s.id) ?? [],
      // Team pages 404 when the module is off — gate like requireSiteModule.
      teamIds: moduleKeys.includes('teams') ? (teamsByOrg.get(orgKey) ?? []) : [],
      newsSlugs: moduleKeys.includes('news') ? (newsBySite.get(s.id) ?? []) : [],
      courseIds: moduleKeys.includes('courses') ? (coursesByOrg.get(orgKey) ?? []) : [],
      playerHandles: moduleKeys.includes('standings') ? (playersByOrg.get(orgKey) ?? []) : [],
    };
  });
}

// ── News (phase 3.5) ────────────────────────────────────────────────────────

export interface PublicNewsItem {
  slug: string;
  title: string;
  publishedAt: string;
  excerpt: string | null; // first paragraph block, truncated
  /** Phase 9 V5 (176): 'members' posts leave a PRIVATE club's site. */
  audience?: 'public' | 'members';
  /** N1: the post's cover — its first image block (no cover column). */
  cover: NewsCover | null;
}

export interface PublicNewsPost {
  slug: string;
  title: string;
  publishedAt: string;
  body: unknown; // parsed defensively at render (parsePageBody)
  cover: NewsCover | null;
}

/** N1 (program 10): a news post's cover is DERIVED — the first image
 *  block of its body. No column, no upload slot: the thumbnail on the
 *  list, the home teaser and the post's og:image all read this. */
export interface NewsCover {
  path: string; // org-media/{siteId}/{file} — orgMediaUrl re-asserts the prefix
  alt: string;
  width?: number;
  height?: number;
}

export function firstImage(body: unknown): NewsCover | null {
  if (!Array.isArray(body)) return null;
  for (const block of body) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; path?: unknown; alt?: unknown; width?: unknown; height?: unknown };
    if (b.type !== 'image' || typeof b.path !== 'string' || !b.path.startsWith('org-media/')) continue;
    const dims: { width?: number; height?: number } = {};
    if (typeof b.width === 'number' && Number.isInteger(b.width) && b.width > 0) dims.width = b.width;
    if (typeof b.height === 'number' && Number.isInteger(b.height) && b.height > 0) dims.height = b.height;
    return { path: b.path, alt: typeof b.alt === 'string' ? b.alt.trim() : '', ...dims };
  }
  return null;
}

export function firstParagraph(body: unknown): string | null {
  if (!Array.isArray(body)) return null;
  for (const block of body) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: string }).type === 'paragraph' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      const text = ((block as { text: string }).text || '').trim();
      if (text) return text.length > 160 ? `${text.slice(0, 157)}…` : text;
    }
  }
  return null;
}

/** The published news feed, newest first. */
export async function fetchPublicNewsList(
  admin: Admin,
  siteId: string,
  opts: {
    /** Phase 9 V5: a PRIVATE club's site lists public posts only (a
     *  public club shows everything). Pre-176 (no audience) ⇒ all. */
    publicOnly?: boolean;
  } = {}
): Promise<PublicNewsItem[]> {
  const read = (fields: string) =>
    admin
      .from('org_site_news')
      .select(fields)
      .eq('site_id', siteId)
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(50);
  let { data, error } = await read('slug, title, body, published_at, audience');
  if (error?.code === '42703') ({ data, error } = await read('slug, title, body, published_at'));
  if (degraded('news list', error) || !data) return [];
  return (data as unknown as Record<string, unknown>[])
    .filter(n => !opts.publicOnly || n.audience === undefined || n.audience === 'public')
    .map(n => ({
      slug: n.slug as string,
      title: n.title as string,
      publishedAt: n.published_at as string,
      excerpt: firstParagraph(n.body),
      cover: firstImage(n.body),
      ...(n.audience === 'members' ? { audience: 'members' as const } : n.audience === 'public' ? { audience: 'public' as const } : {}),
    }));
}

// ── Notices (N3, program 10) ────────────────────────────────────────────────
// The announcements a manager ALSO put on the site's notice band, listed
// under News as "Notices" — title, message, date, nothing about a person
// (the rows are notification rows; only the announcement's own text is
// read). Viewer-independent by construction; announce purges the site
// tag whenever it mirrors, so the list is fresh the moment the band is.

export interface PublicNotice {
  id: string;
  title: string; // the announcement title WITHOUT the "{org}: " prefix
  message: string;
  createdAt: string;
  noticeUntil: string | null;
}

export async function fetchPublicNotices(admin: Admin, side: OrgSide, orgId: string, orgName: string): Promise<PublicNotice[]> {
  const { data, error } = await admin
    .from('notifications')
    .select('title, message, created_at, metadata')
    .contains('metadata', { org: `${side}:${orgId}`, announcement: true, site_notice: true })
    .order('created_at', { ascending: false })
    .limit(2000);
  if (degraded('notices', error) || !data) return [];
  const prefix = `${orgName}: `;
  return groupAnnouncements(data as AnnouncementNotificationRow[], 20).map(a => ({
    id: a.id,
    title: a.title.startsWith(prefix) ? a.title.slice(prefix.length) : a.title,
    message: a.message,
    createdAt: a.createdAt,
    noticeUntil: a.noticeUntil,
  }));
}

// ── Register (phase 5 R5 — the registration CTA card) ───────────────────────
// The OPEN windows only, viewer-independent, no personal data. Openness
// is time-based, so a window crossing closes_at can linger ≤ the ISR TTL
// on the cached page — the app-side POST re-gates unconditionally, so a
// stale card can never admit a registration. Missing tables (pre-162)
// read as no windows: the card simply never renders.

export interface PublicOpenWindow {
  seasonLabel: string;
  offeringName: string | null; // division/program name, null = season-wide
  opensAt: string;
  closesAt: string | null;
}

export async function fetchPublicOpenWindows(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<PublicOpenWindow[]> {
  const col = orgColumn(side);
  const { data: rows, error } = await admin
    .from('registration_windows')
    .select(
      'opens_at, closes_at, season:season_id (label), division:division_id (name), program:program_id (name)'
    )
    .eq(col, orgId)
    .order('opens_at', { ascending: false })
    .limit(50);
  if (degraded('open windows', error) || !rows) return [];
  const nowIso = new Date().toISOString();
  const unwrap = <T,>(v: T | T[] | null | undefined): T | null =>
    (Array.isArray(v) ? v[0] : v) ?? null;
  return rows
    .filter(w =>
      (w.opens_at as string) <= nowIso &&
      (!w.closes_at || (w.closes_at as string) > nowIso)
    )
    .map(w => {
      const season = unwrap(w.season as { label: string } | { label: string }[] | null);
      const division = unwrap(w.division as { name: string } | { name: string }[] | null);
      const program = unwrap(w.program as { name: string } | { name: string }[] | null);
      return {
        seasonLabel: season?.label ?? 'This season',
        offeringName: division?.name ?? program?.name ?? null,
        opensAt: w.opens_at as string,
        closesAt: (w.closes_at as string | null) ?? null,
      };
    });
}

// ── Gallery (phase 4 R5 — the consent-gated contest media) ──────────────────
// The bar: org-published (158) AND every actively tagged athlete cleared
// by photo_consent (159) — evaluated by the shared gallery gate, which
// the public streamer re-runs per request (a stale ISR document can
// never out-serve it). Names of tagged athletes pass through the masking
// rule, and SUPERVISED athletes get NO label at all — a consented photo
// may appear, the identification of a minor never does.

export interface PublicGalleryItem {
  id: string;
  url: string; // the tokenless public streamer, gate re-run per request
  mediaType: 'image' | 'video';
  caption: string | null;
  date: string | null; // contest date, else upload date
  competitionName: string;
  tagLabels: string[]; // masked; supervised athletes omitted entirely
}

export async function fetchPublicGallery(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<PublicGalleryItem[]> {
  // M2 (program 10): the members' round photos a manager picked come
  // FIRST (newest pick first) — and independently of the contest media
  // below, which returns early when the org has no public competitions
  // (a golf club rarely has one).
  const memberItems = await fetchMemberGalleryItems(admin, side, orgId);
  const contestItems = await fetchContestGalleryItems(admin, side, orgId);
  return [...memberItems, ...contestItems];
}

async function fetchMemberGalleryItems(admin: Admin, side: OrgSide, orgId: string): Promise<PublicGalleryItem[]> {
  try {
    const { data: site } = await admin.from('org_sites').select('id').eq(orgColumn(side), orgId).maybeSingle();
    if (!site) return [];
    const { data: mod } = await admin
      .from('org_site_modules')
      .select('config')
      .eq('site_id', site.id)
      .eq('module_key', 'gallery')
      .maybeSingle();
    const { readGalleryPicks, evaluateMemberPhotos } = await import('./member-photo-gate');
    const picks = readGalleryPicks(mod?.config);
    if (picks.length === 0) return [];
    const photos = await evaluateMemberPhotos(admin, site.id as string, picks.map(p => p.mediaId));
    return photos.map(p => ({
      id: p.mediaId,
      url: `/api/media/org-gallery/${site.id}/${p.mediaId}`,
      mediaType: 'image' as const,
      caption: null,
      date: p.date,
      competitionName: p.courseName ?? 'A round',
      tagLabels: [p.authorName],
    }));
  } catch (error) {
    console.error(`${TAG} member gallery failed:`, error);
    return [];
  }
}

async function fetchContestGalleryItems(admin: Admin, side: OrgSide, orgId: string): Promise<PublicGalleryItem[]> {
  const col = orgColumn(side);
  const { data: comps, error: compsError } = await admin
    .from('competitions')
    .select('id')
    .eq(col, orgId)
    .eq('visibility', 'public')
    .in('status', ['active', 'completed'])
    .limit(50);
  if (degraded('gallery competitions', compsError) || !comps || comps.length === 0) return [];
  const { data: contests } = await admin
    .from('contests')
    .select('id')
    .in('competition_id', comps.map(c => c.id as string))
    .limit(300);
  const contestIds = (contests ?? []).map(c => c.id as string);
  if (contestIds.length === 0) return [];
  const { data: mediaRows, error: mediaError } = await admin
    .from('contest_media')
    .select('id')
    .in('contest_id', contestIds)
    .eq('published', true)
    .order('created_at', { ascending: false })
    .limit(80);
  if (degraded('gallery media', mediaError) || !mediaRows || mediaRows.length === 0) return [];

  const { evaluatePublicContestMedia } = await import('@/lib/orgs/gallery-gate');
  const eligible = await evaluatePublicContestMedia(admin, mediaRows.map(m => m.id as string));
  if (eligible.length === 0) return [];

  const taggedIds = [...new Set(eligible.flatMap(m => m.taggedProfileIds))];
  const { data: profileRows } = taggedIds.length
    ? await admin
        .from('profiles')
        .select('id, first_name, last_name, full_name, visibility, email, supervision_state')
        .in('id', taggedIds)
    : { data: [] };
  const labelById = new Map<string, string | null>(
    (profileRows ?? []).map(p => [
      p.id as string,
      p.supervision_state === 'supervised' ? null : publicDisplayName(p as MaskableProfile),
    ])
  );

  return eligible.map(m => ({
    id: m.id,
    url: `/api/media/contest-media/${m.id}`,
    mediaType: m.mediaType,
    caption: m.caption,
    date: m.contestDate ?? m.createdAt,
    competitionName: m.competitionName,
    tagLabels: m.taggedProfileIds
      .map(profileId => labelById.get(profileId) ?? null)
      .filter((v): v is string => !!v),
  }));
}

/** One PUBLISHED post by slug — drafts are indistinguishable from missing. */
export async function fetchPublicNewsPost(
  admin: Admin,
  siteId: string,
  newsSlug: string,
  opts: { publicOnly?: boolean } = {}
): Promise<PublicNewsPost | null> {
  const read = (fields: string) =>
    admin
      .from('org_site_news')
      .select(fields)
      .eq('site_id', siteId)
      .eq('slug', newsSlug)
      .not('published_at', 'is', null)
      .maybeSingle();
  let { data, error } = await read('slug, title, body, published_at, audience');
  if (error?.code === '42703') ({ data, error } = await read('slug, title, body, published_at'));
  if (degraded('news post', error) || !data) return null;
  // V5: a members-only post on a private club's site is indistinguishable from missing.
  if (opts.publicOnly && (data as unknown as { audience?: string }).audience === 'members') return null;
  const row = data as unknown as { slug: string; title: string; published_at: string; body: unknown };
  return {
    slug: row.slug,
    title: row.title,
    publishedAt: row.published_at,
    body: row.body,
    cover: firstImage(row.body),
  };
}

// ── Courses (phase 6b A2) ───────────────────────────────────────────────────
// The golf club page's public half: the catalog courses a manager
// recognized on the org's venues (169's golf_club_id / golf_course_id
// pair — a linked club contributes EVERY section/nine, a linked course
// contributes itself). Pure reference data (no people); the description's
// CC BY-SA attribution rides along because it MUST render wherever the
// description does.

export interface PublicCourse {
  venueName: string;
  course: GolfCourse;
  /** S2: the catalog's phone (rowToCourse drops it; the course page shows it). */
  phone?: string;
}

/** S2: the full course page — the org-gated course, its sibling
 *  layouts (same golf club), and the cached OSM hole geometry. */
export interface PublicCoursePage extends PublicCourse {
  siblings: { id: string; name: string; sectionName?: string; sectionKind?: string }[];
  geometry: HoleGeometry | null;
}

export async function fetchPublicCourses(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<PublicCourse[]> {
  let res: { data: unknown[] | null; error: { code?: string } | null } = await admin
    .from('venues')
    .select('id, name, golf_club_id, golf_course_id')
    .eq(orgColumn(side), orgId)
    .order('name', { ascending: true })
    .limit(50);
  // Pre-169 database: no golf_course_id column — fall back to the club link.
  if (res.error?.code === '42703') {
    res = await admin
      .from('venues')
      .select('id, name, golf_club_id')
      .eq(orgColumn(side), orgId)
      .order('name', { ascending: true })
      .limit(50);
  }
  if (degraded('courses', res.error) || !res.data || res.data.length === 0) return [];
  const venues = res.data as {
    id: string;
    name: string;
    golf_club_id: string | null;
    golf_course_id?: string | null;
  }[];

  const clubIds = [...new Set(venues.map(v => v.golf_club_id).filter((id): id is string => !!id))];
  const courseIds = [
    ...new Set(venues.map(v => v.golf_course_id ?? null).filter((id): id is string => !!id)),
  ];
  if (clubIds.length === 0 && courseIds.length === 0) return [];

  const [byClub, byId] = await Promise.all([
    clubIds.length
      ? admin
          .from('golf_courses')
          .select(CATALOG_ROW_COLUMNS)
          .in('club_id', clubIds)
          .order('section_name', { ascending: true })
          .limit(40)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    courseIds.length
      ? admin.from('golf_courses').select(CATALOG_ROW_COLUMNS).in('id', courseIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);
  if (degraded('courses rows', byClub.error) || degraded('courses rows', byId.error)) return [];

  const clubRows = new Map<string, CatalogRow[]>();
  for (const row of (byClub.data ?? []) as unknown as CatalogRow[]) {
    const clubId = row.club_id as string;
    if (!clubRows.has(clubId)) clubRows.set(clubId, []);
    clubRows.get(clubId)!.push(row);
  }
  const idRows = new Map(((byId.data ?? []) as unknown as CatalogRow[]).map(r => [r.id, r]));

  const out: PublicCourse[] = [];
  for (const v of venues) {
    const rows = v.golf_club_id
      ? (clubRows.get(v.golf_club_id) ?? [])
      : v.golf_course_id && idRows.has(v.golf_course_id)
        ? [idRows.get(v.golf_course_id)!]
        : [];
    for (const row of rows) {
      out.push({
        venueName: v.name,
        course: rowToCourse(row),
        ...(row.phone ? { phone: row.phone } : {}),
      });
    }
  }
  return out;
}

/** S2: one course page. The ORG GATE is the list itself — a course the
 *  org's venues don't link is indistinguishable from a missing one
 *  (null → 404). Siblings = the other layouts at the same golf club.
 *  `hole_geometry` is read by a second select on purpose:
 *  CATALOG_ROW_COLUMNS feeds the app's pickers and must not grow. */
export async function fetchPublicCoursePage(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  courseId: string
): Promise<PublicCoursePage | null> {
  const list = await fetchPublicCourses(admin, side, orgId);
  const hit = list.find(c => c.course.id === courseId);
  if (!hit) return null;
  const siblings = list
    .filter(c => c.course.id !== courseId && !!hit.course.clubId && c.course.clubId === hit.course.clubId)
    .map(c => ({
      id: c.course.id,
      name: c.course.name,
      ...(c.course.sectionName ? { sectionName: c.course.sectionName } : {}),
      ...(c.course.sectionKind ? { sectionKind: c.course.sectionKind } : {}),
    }));
  let geometry: HoleGeometry | null = null;
  try {
    const { data, error } = await admin
      .from('golf_courses')
      .select('hole_geometry')
      .eq('id', courseId)
      .maybeSingle();
    if (!degraded('course geometry', error)) geometry = parseStoredHoleGeometry(data?.hole_geometry);
  } catch {
    geometry = null; // pre-102: no column — the page renders without diagrams
  }
  return { ...hit, siblings, geometry };
}

// ── Golf rounds on the schedule (phase 6e S4) ───────────────────────────────
// A golf league's season is its play windows, not `events`: the public
// schedule lists them (open / upcoming / closed) beside the org's events,
// and the site's ICS feed carries the ones no mirror event already
// covers. Viewer-independent; never throws; pre-172 → none.

export interface PublicGolfRound {
  id: string;
  competitionId: string;
  competitionName: string;
  round: string | null;
  holes: number;
  playFrom: string;
  playTo: string;
  courseName: string | null;
  state: GolfWeekState;
  /** The mirror event id when the round was published to the calendar. */
  eventId: string | null;
}

export async function fetchPublicGolfRounds(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<PublicGolfRound[]> {
  try {
    const { data: competitions, error } = await admin
      .from('competitions')
      .select('id, name')
      .eq(orgColumn(side), orgId)
      .eq('sport_key', 'golf')
      .eq('format', 'leaderboard')
      .eq('visibility', 'public')
      .in('status', ['active', 'completed'])
      .order('created_at', { ascending: false })
      .limit(20);
    if (degraded('golf rounds competitions', error) || !competitions || competitions.length === 0) return [];
    const nameOf = new Map(competitions.map(c => [c.id as string, c.name as string]));
    const { data: contests, error: cErr } = await admin
      .from('contests')
      .select('id, competition_id, round, status, venue_id, holes, play_from, play_to, event_id')
      .in('competition_id', [...nameOf.keys()])
      .not('play_from', 'is', null)
      .neq('status', 'canceled')
      .order('play_from', { ascending: true })
      .limit(100);
    if (degraded('golf rounds', cErr) || !contests || contests.length === 0) return [];
    const venueIds = [...new Set(contests.map(c => c.venue_id).filter(Boolean))] as string[];
    const { data: venues } = venueIds.length
      ? await admin.from('venues').select('id, name, golf_course_id').in('id', venueIds)
      : { data: [] as { id: string; name: string; golf_course_id: string | null }[] };
    const courseIds = [...new Set((venues ?? []).map(v => v.golf_course_id).filter(Boolean))] as string[];
    const { data: courses } = courseIds.length
      ? await admin.from('golf_courses').select('id, name').in('id', courseIds)
      : { data: [] as { id: string; name: string }[] };
    const courseName = new Map((courses ?? []).map(c => [c.id as string, c.name as string]));
    const nameByVenue = new Map<string, string>();
    for (const v of venues ?? []) {
      nameByVenue.set(v.id as string, (v.golf_course_id && courseName.get(v.golf_course_id as string)) || (v.name as string));
    }
    const today = utcToday();
    return sortWeeks(
      contests.map(c => ({
        id: c.id as string,
        competitionId: c.competition_id as string,
        competitionName: nameOf.get(c.competition_id as string) ?? 'League',
        round: (c.round as string | null) ?? null,
        holes: Number(c.holes ?? 0),
        playFrom: String(c.play_from),
        playTo: String(c.play_to),
        courseName: (c.venue_id && nameByVenue.get(c.venue_id as string)) || null,
        state: weekState({ playFrom: String(c.play_from), playTo: String(c.play_to) }, today),
        eventId: (c.event_id as string | null) ?? null,
      }))
    );
  } catch (error) {
    console.error(`${TAG} golf rounds failed:`, error);
    return [];
  }
}

// ── Divisions (phase 6b B3) ─────────────────────────────────────────────────
// Teams grouped by division for the org's CURRENT seasons (not ended —
// ends_on null or today or later; the newest three by start). Reuses the
// teams walk in reverse: season → division → entry → active team.

export interface PublicDivision {
  seasonLabel: string;
  divisionName: string;
  ageBand: string | null;
  tier: string | null;
  teams: { id: string; name: string }[];
}

export async function fetchPublicDivisions(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<PublicDivision[]> {
  const col = orgColumn(side);
  const today = new Date().toISOString().slice(0, 10);
  const { data: seasons, error } = await admin
    .from('seasons')
    .select('id, label, starts_on, ends_on')
    .eq(col, orgId)
    .or(`ends_on.is.null,ends_on.gte.${today}`)
    .order('starts_on', { ascending: false, nullsFirst: false })
    .limit(3);
  if (degraded('divisions seasons', error) || !seasons || seasons.length === 0) return [];

  const seasonIds = seasons.map(s => s.id as string);
  const { data: divisions, error: divError } = await admin
    .from('divisions')
    .select('id, season_id, name, age_band, tier')
    .in('season_id', seasonIds)
    .order('name', { ascending: true })
    .limit(100);
  if (degraded('divisions', divError) || !divisions || divisions.length === 0) return [];

  const divisionIds = divisions.map(d => d.id as string);
  const { data: entries } = await admin
    .from('team_entries')
    .select('team_id, division_id')
    .in('division_id', divisionIds)
    .limit(1000);
  const teamIds = [...new Set((entries ?? []).map(e => e.team_id as string))];
  const { data: teams } = teamIds.length
    ? await admin
        .from('teams')
        .select('id, name, display_name')
        .in('id', teamIds)
        .eq('status', 'active')
    : { data: [] };
  const teamName = new Map(
    (teams ?? []).map(t => [t.id as string, (t.display_name || t.name) as string])
  );
  const teamsByDivision = new Map<string, { id: string; name: string }[]>();
  for (const e of entries ?? []) {
    const name = teamName.get(e.team_id as string);
    if (!name) continue;
    if (!teamsByDivision.has(e.division_id)) teamsByDivision.set(e.division_id, []);
    teamsByDivision.get(e.division_id)!.push({ id: e.team_id as string, name });
  }
  const seasonLabel = new Map(seasons.map(s => [s.id as string, s.label as string]));

  return divisions.map(d => ({
    seasonLabel: seasonLabel.get(d.season_id as string) ?? '',
    divisionName: d.name as string,
    ageBand: (d.age_band ?? null) as string | null,
    tier: (d.tier ?? null) as string | null,
    teams: (teamsByDivision.get(d.id as string) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
  }));
}

// ── Stat leaders (phase 6b B3) ──────────────────────────────────────────────
// Per PUBLIC competition: the schema's sum-type profile tiles (Goals,
// Points, Kills…) aggregated over contest_stat_lines, top five each.
// THE PEOPLE RULES: names pass through publicDisplayName, and SUPERVISED
// athletes are OMITTED ENTIRELY — a masked "First L." still names a minor
// on a crawlable page (the gallery's tag rule, applied to a leaderboard).
// A sport with no stat-line schema (golf) answers `unsupported: true`.

export interface PublicLeaderRow {
  name: string;
  teamName: string | null;
  value: number;
  /** P2: the public profile's handle (a link); absent for masked names. */
  playerHandle?: string;
  /** S5: a golf board's context line ("Week 3 · 2026-09-15"). */
  note?: string;
}
export interface PublicLeaderBoard {
  competitionId: string;
  competitionName: string;
  sportKey: string;
  unsupported: boolean;
  /** S5: `valueLabel` heads the value column ("Gross", "Net", "Rounds"); absent = "Total". */
  stats: { label: string; valueLabel?: string; rows: PublicLeaderRow[] }[];
}

/** S5: golf leaderboards have no stat lines — their boards come from
 *  contest_results (completed rounds only, the confirmed record). Names
 *  masked; supervised athletes omitted (null name → no row). */
async function fetchGolfLeaderBoards(
  admin: Admin,
  comps: { id: string; name: string; scoring_rule: string | null; config?: unknown }[]
): Promise<Map<string, PublicLeaderBoard['stats']>> {
  const out = new Map<string, PublicLeaderBoard['stats']>();
  if (comps.length === 0) return out;
  try {
    const compIds = comps.map(c => c.id);
    const { data: contests, error } = await admin
      .from('contests')
      .select('id, competition_id, round, play_from')
      .in('competition_id', compIds)
      .eq('status', 'completed')
      .limit(300);
    if (degraded('golf leaders contests', error) || !contests || contests.length === 0) return out;
    const contestById = new Map(contests.map(c => [c.id as string, c]));
    const { data: results } = await admin
      .from('contest_results')
      .select('contest_id, participant_id, score, payload')
      .in('contest_id', [...contestById.keys()])
      .limit(1000);
    if (!results || results.length === 0) return out;
    const { data: participants } = await admin
      .from('contest_participants')
      .select('id, entry_id')
      .in('id', [...new Set(results.map(r => r.participant_id as string))])
      .limit(1000);
    const entryByParticipant = new Map((participants ?? []).map(p => [p.id as string, p.entry_id as string]));
    const entryIds = [...new Set(entryByParticipant.values())];
    const { data: entries } = entryIds.length
      ? await admin.from('competition_entries').select('id, profile_id').in('id', entryIds)
      : { data: [] as { id: string; profile_id: string | null }[] };
    const profileByEntry = new Map((entries ?? []).map(e => [e.id as string, e.profile_id as string | null]));
    const profileIds = [...new Set([...profileByEntry.values()].filter((id): id is string => !!id))];
    const { data: profiles } = profileIds.length
      ? await admin
          .from('profiles')
          .select('id, first_name, last_name, full_name, visibility, email, supervision_state, handle')
          .in('id', profileIds)
      : { data: [] as (MaskableProfile & { id: string })[] };
    const nameByProfile = new Map<string, string | null>(
      ((profiles ?? []) as (MaskableProfile & { id: string })[]).map(p => [
        p.id,
        p.supervision_state === 'supervised' ? null : publicDisplayName(p),
      ])
    );
    const handleByProfile = new Map<string, string>();
    for (const p of (profiles ?? []) as (MaskableProfile & { id: string; handle?: string | null })[]) {
      const h = publicHandle(p);
      if (h) handleByProfile.set(p.id, h);
    }
    const handleByEntry = new Map<string, string>();
    const nameByEntry = new Map<string, string | null>();
    for (const [entryId, profileId] of profileByEntry) {
      nameByEntry.set(entryId, profileId ? (nameByProfile.get(profileId) ?? null) : null);
      const h = profileId ? handleByProfile.get(profileId) : undefined;
      if (h) handleByEntry.set(entryId, h);
    }
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const rowsByComp = new Map<string, GolfLeaderInputRow[]>();
    for (const r of results) {
      const contest = contestById.get(r.contest_id as string);
      const entryId = entryByParticipant.get(r.participant_id as string);
      if (!contest || !entryId) continue;
      const compId = contest.competition_id as string;
      const payload = ((r.payload as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
      if (!rowsByComp.has(compId)) rowsByComp.set(compId, []);
      rowsByComp.get(compId)!.push({
        contestId: contest.id as string,
        contestRound: (contest.round as string | null) ?? null,
        contestPlayFrom: (contest.play_from as string | null) ?? null,
        entryId,
        gross: num(payload.gross),
        net: num(payload.net),
        holes: num(payload.holes),
        score: num(r.score),
      });
    }
    for (const comp of comps) {
      const rows = rowsByComp.get(comp.id) ?? [];
      out.set(
        comp.id,
        buildGolfLeaderBoards({
          rows,
          nameByEntry,
          handleByEntry,
          scoringRule: roundRuleFor(comp.scoring_rule, comp.config),
          pointsPreset: comp.scoring_rule === 'golf_points' ? parseGolfPointsConfig(comp.config).preset : null,
        }).map(b => ({
          label: b.label,
          valueLabel: b.valueLabel,
          rows: b.rows.map(r => ({
            name: r.name,
            teamName: null,
            value: r.value,
            ...(r.note ? { note: r.note } : {}),
            ...(r.handle ? { playerHandle: r.handle } : {}),
          })),
        }))
      );
    }
  } catch (error) {
    console.error(`${TAG} golf leaders failed:`, error);
  }
  return out;
}

export async function fetchPublicStatLeaders(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<PublicLeaderBoard[]> {
  const col = orgColumn(side);
  const { data: comps, error } = await admin
    .from('competitions')
    .select('id, name, sport_key, format, scoring_rule, config')
    .eq(col, orgId)
    .eq('visibility', 'public')
    .in('status', ['active', 'completed'])
    .order('created_at', { ascending: false })
    .limit(20);
  if (degraded('leaders competitions', error) || !comps || comps.length === 0) return [];

  // S5: golf LEADERBOARDS come from contest_results (their own boards);
  // everything else (incl. a golf fixture, still unsupported) keeps the
  // stat-lines path below.
  const golfComps = comps.filter(c => c.sport_key === 'golf' && c.format === 'leaderboard');
  const golfBoards = await fetchGolfLeaderBoards(
    admin,
    golfComps.map(c => ({ id: c.id as string, name: c.name as string, scoring_rule: (c.scoring_rule as string | null) ?? null, config: c.config ?? null }))
  );
  const golfIds = new Set(golfComps.map(c => c.id as string));

  const compIds = comps.map(c => c.id as string);
  const { data: contests } = await admin
    .from('contests')
    .select('id, competition_id')
    .in('competition_id', compIds)
    .limit(300);
  const contestComp = new Map((contests ?? []).map(c => [c.id as string, c.competition_id as string]));
  const golfOnly = (): PublicLeaderBoard[] =>
    comps
      .filter(c => golfIds.has(c.id as string))
      .map(c => ({
        competitionId: c.id as string,
        competitionName: c.name as string,
        sportKey: c.sport_key as string,
        unsupported: false,
        stats: golfBoards.get(c.id as string) ?? [],
      }))
      .filter(b => b.stats.length > 0);
  if (contestComp.size === 0) return golfOnly();

  const { data: lines, error: linesError } = await admin
    .from('contest_stat_lines')
    .select('contest_id, profile_id, team_id, stats')
    .in('contest_id', [...contestComp.keys()])
    .limit(2000);
  if (degraded('leaders lines', linesError) || !lines || lines.length === 0) return golfOnly();

  const profileIds = [...new Set(lines.map(l => l.profile_id as string))];
  const teamIds = [...new Set(lines.map(l => l.team_id as string | null).filter((t): t is string => !!t))];
  const [{ data: profiles }, { data: teams }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, first_name, last_name, full_name, visibility, email, supervision_state')
      .in('id', profileIds),
    teamIds.length
      ? admin.from('teams').select('id, name, display_name').in('id', teamIds)
      : Promise.resolve({ data: [] as { id: string; name: string; display_name: string | null }[] }),
  ]);
  // Supervised → null → the athlete never appears (omission, not masking).
  const nameById = new Map<string, string | null>(
    (profiles ?? []).map(p => [
      p.id as string,
      p.supervision_state === 'supervised' ? null : publicDisplayName(p as MaskableProfile),
    ])
  );
  const teamNameById = new Map(
    (teams ?? []).map(t => [t.id as string, (t.display_name || t.name) as string])
  );

  // Aggregate per competition → per profile → the stat keys.
  const perComp = new Map<string, Map<string, { teamId: string | null; sums: Record<string, number> }>>();
  for (const line of lines) {
    const compId = contestComp.get(line.contest_id as string);
    if (!compId) continue;
    const stats = (line.stats ?? {}) as Record<string, unknown>;
    if (!perComp.has(compId)) perComp.set(compId, new Map());
    const byProfile = perComp.get(compId)!;
    const profileId = line.profile_id as string;
    if (!byProfile.has(profileId)) byProfile.set(profileId, { teamId: (line.team_id ?? null) as string | null, sums: {} });
    const acc = byProfile.get(profileId)!;
    for (const [key, v] of Object.entries(stats)) {
      if (typeof v === 'number' && Number.isFinite(v)) acc.sums[key] = (acc.sums[key] ?? 0) + v;
    }
  }

  const boards: PublicLeaderBoard[] = [];
  for (const comp of comps) {
    if (golfIds.has(comp.id as string)) {
      const stats = golfBoards.get(comp.id as string) ?? [];
      if (stats.length > 0) {
        boards.push({
          competitionId: comp.id as string,
          competitionName: comp.name as string,
          sportKey: comp.sport_key as string,
          unsupported: false,
          stats,
        });
      }
      continue;
    }
    const byProfile = perComp.get(comp.id as string);
    if (!byProfile) continue;
    const schema = getStatSchema(comp.sport_key as string);
    if (!schema) {
      boards.push({
        competitionId: comp.id as string,
        competitionName: comp.name as string,
        sportKey: comp.sport_key as string,
        unsupported: true,
        stats: [],
      });
      continue;
    }
    const stats = schema.profileTiles
      .filter(tile => tile.compute.kind === 'sum')
      .map(tile => {
        const keys = tile.compute.kind === 'sum' ? tile.compute.keys : [];
        const rows: PublicLeaderRow[] = [];
        for (const [profileId, acc] of byProfile) {
          const name = nameById.get(profileId);
          if (!name) continue;
          const value = keys.reduce((sum, k) => sum + (acc.sums[k] ?? 0), 0);
          if (value <= 0) continue;
          rows.push({ name, teamName: acc.teamId ? (teamNameById.get(acc.teamId) ?? null) : null, value });
        }
        rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
        return { label: tile.label, rows: rows.slice(0, 5) };
      })
      .filter(s => s.rows.length > 0);
    boards.push({
      competitionId: comp.id as string,
      competitionName: comp.name as string,
      sportKey: comp.sport_key as string,
      unsupported: false,
      stats,
    });
  }
  return boards;
}

// ── Club golf boards (phase 6c G3) ──────────────────────────────────────────
// "This week at the club": the club's OWN public golf leaderboards plus
// those of the leagues actively affiliated with it (league_clubs) — the
// leagues that play here. Reuses fetchPublicStandings (viewer-independent,
// masked, supervised omitted), so the teaser inherits every people rule.
// Bounded (≤5 leagues, top 5 rows per board); never throws.

export interface PublicClubGolfBoard {
  orgName: string;
  competition: PublicCompetitionStandings;
}

export async function fetchPublicClubGolfBoards(
  admin: Admin,
  clubId: string
): Promise<PublicClubGolfBoard[]> {
  try {
    const { fetchPublicStandings } = await import('@/lib/competitions/public-standings');
    const boards: PublicClubGolfBoard[] = [];
    const take = (payload: Awaited<ReturnType<typeof fetchPublicStandings>>) => {
      if (!payload) return;
      for (const c of payload.competitions) {
        if (c.sport_key !== 'golf' || c.format !== 'leaderboard' || c.rows.length === 0) continue;
        // W1: the teaser stays the CUMULATIVE board — the week-by-week
        // view belongs to the league's own page (club page ≠ league page),
        // and carrying it here would render every affiliated league's
        // rounds twice.
        const { golf: _golf, ...cumulative } = c;
        void _golf;
        boards.push({ orgName: payload.orgName, competition: { ...cumulative, rows: c.rows.slice(0, 5) } });
      }
    };
    take(await fetchPublicStandings(admin, 'club', clubId));
    const { data: edges, error } = await admin
      .from('league_clubs')
      .select('league_id')
      .eq('club_id', clubId)
      .eq('status', 'active')
      .limit(5);
    if (!degraded('club golf boards', error)) {
      for (const e of edges ?? []) take(await fetchPublicStandings(admin, 'league', e.league_id as string));
    }
    return boards.slice(0, 4);
  } catch (error) {
    console.error(`${TAG} club golf boards error:`, error);
    return [];
  }
}

// ── Player pages (phase 8 P2) ───────────────────────────────────────────────
// A player page exists ONLY for a public, unsupervised, claimed profile
// (isPublicProfile — Tom's decision) who holds an approved entry in one of
// the org's PUBLIC golf leaderboards. Keyed by the profile's handle (the
// only stable public per-person key; /u/[username] already exposes it).
// Built from the public standings payload — the same rows, the same
// masking, the same omission — by picking the rows whose `playerHandle`
// is this player's, so the page can never show more than the boards do.

export interface PublicPlayerWeek {
  round: string | null;
  playFrom: string;
  playTo: string;
  state: 'open' | 'upcoming' | 'closed';
  courseName: string | null;
  gross: number | null;
  net: number | null;
  holes: number | null;
  points?: number;
  status: 'posted' | 'final';
}

export interface PublicPlayerCompetition {
  competitionId: string;
  name: string;
  seasonLabel: string | null;
  status: string;
  /** From the standings table (null before a completed round). */
  rank: number | null;
  points: number | null;
  played: number;
  /** Ranked entrants on the public board. */
  of: number;
  /** The race row (points leagues): places gained/lost into the latest week. */
  movement: number | null;
  weeks: PublicPlayerWeek[];
}

/** P3: a public round of the player's own (the two-key rule: a public
 *  post on the round AND the public profile — the course-stats rule). */
export interface PublicPlayerRound {
  id: string;
  date: string;
  courseName: string | null;
  holes: number;
  gross: number;
  tee: string | null;
}

export interface PublicPlayerHandicap {
  /** Formatted index ("12.4" / "+1.2"). */
  current: string;
  provisional: boolean;
  /** The published index after every counted round (chronological). */
  series: { date: string; index: number }[];
}

export interface PublicPlayerSeason {
  leagueRounds: number;
  wins: number;
  lowGross9: number | null;
  lowGross18: number | null;
  lowNet9: number | null;
  lowNet18: number | null;
}

export interface PublicPlayerPage {
  handle: string;
  name: string;
  competitions: PublicPlayerCompetition[];
  /** P3 — depth; each part absent/empty when there is nothing public to say. */
  season: PublicPlayerSeason;
  handicap: PublicPlayerHandicap | null;
  recentRounds: PublicPlayerRound[];
  /** M2 (program 10) — this member's round photos the manager put on the
   *  site (picks only; the gate re-decides each). Empty when none. */
  photos: PublicPlayerPhoto[];
}

export interface PublicPlayerPhoto {
  mediaId: string;
  url: string;
  date: string | null;
  courseName: string | null;
}

export async function fetchPublicPlayerPage(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  handle: string
): Promise<PublicPlayerPage | null> {
  try {
    const wanted = handle.trim().toLowerCase();
    if (!wanted || wanted.length > 40) return null;
    const { data: profile, error } = await admin
      .from('profiles')
      .select('id, handle, first_name, last_name, full_name, visibility, email, supervision_state')
      .ilike('handle', wanted)
      .maybeSingle();
    if (degraded('player profile', error) || !profile) return null;
    const p = profile as unknown as MaskableProfile & { id: string; handle: string | null };
    const publicHandleValue = publicHandle(p);
    if (!publicHandleValue) return null;

    // The same dynamic import the club golf teaser uses (no static cycle).
    const { fetchPublicStandings } = await import('@/lib/competitions/public-standings');
    const standings = await fetchPublicStandings(admin, side, orgId);
    if (!standings) return null;
    const competitions: PublicPlayerCompetition[] = [];
    for (const c of standings.competitions) {
      if (c.sport_key !== 'golf' || c.format !== 'leaderboard') continue;
      const row = c.rows.find(r => r.playerHandle === publicHandleValue) ?? null;
      const weeks: PublicPlayerWeek[] = [];
      for (const w of c.golf?.weeks ?? []) {
        const mine = w.results.find(r => r.playerHandle === publicHandleValue);
        if (!mine) continue;
        weeks.push({
          round: w.round,
          playFrom: w.playFrom,
          playTo: w.playTo,
          state: w.state,
          courseName: w.courseName,
          gross: mine.gross,
          net: mine.net,
          holes: mine.holes,
          ...(typeof mine.points === 'number' ? { points: mine.points } : {}),
          status: mine.status,
        });
      }
      if (!row && weeks.length === 0) continue;
      const race = c.race?.rows.find(r => r.playerHandle === publicHandleValue) ?? null;
      competitions.push({
        competitionId: c.id,
        name: c.name,
        seasonLabel: c.season_label,
        status: c.status,
        rank: row?.rank ?? null,
        points: row?.points ?? null,
        played: row?.played ?? 0,
        of: c.rows.length,
        movement: race?.movement ?? null,
        weeks,
      });
    }
    if (competitions.length === 0) return null;

    // P3 — the season numbers off the weeks (9 and 18 never mixed — the
    // leaders rule; a win = the week's top points among the public field).
    const season: PublicPlayerSeason = { leagueRounds: 0, wins: 0, lowGross9: null, lowGross18: null, lowNet9: null, lowNet18: null };
    const low = (cur: number | null, v: number | null) => (v === null ? cur : cur === null ? v : Math.min(cur, v));
    for (const c of standings.competitions) {
      for (const w of c.golf?.weeks ?? []) {
        const mine = w.results.find(r => r.playerHandle === publicHandleValue);
        if (!mine) continue;
        season.leagueRounds += 1;
        if (mine.holes === 9) {
          season.lowGross9 = low(season.lowGross9, mine.gross);
          season.lowNet9 = low(season.lowNet9, mine.net);
        } else if (mine.holes === 18) {
          season.lowGross18 = low(season.lowGross18, mine.gross);
          season.lowNet18 = low(season.lowNet18, mine.net);
        }
        if (typeof mine.points === 'number') {
          const top = Math.max(...w.results.map(r => (typeof r.points === 'number' ? r.points : -Infinity)));
          if (mine.points === top) season.wins += 1;
        }
      }
    }

    // P3 — the handicap trend. The index is ALREADY public data for a
    // public profile (/api/public/profile's golf skill card computes the
    // same thing), so the gate is the profile's, not per round.
    let handicap: PublicPlayerHandicap | null = null;
    try {
      const { fetchHandicapComputation } = await import('@/lib/golf/handicap-server');
      const { formatHandicapIndex } = await import('@/lib/golf/handicap');
      const hc = await fetchHandicapComputation(p.id, admin);
      if (hc.current) {
        handicap = {
          current: formatHandicapIndex(hc.current.index),
          provisional: hc.current.provisional === true,
          series: hc.series.map(pt => ({ date: pt.date, index: pt.index })),
        };
      }
    } catch (error) {
      console.error(`${TAG} player handicap failed:`, error);
    }

    // P3 — recent rounds under the TWO-KEY rule (the course-stats recipe):
    // a public, published post on the round AND the public profile.
    const recentRounds: PublicPlayerRound[] = [];
    try {
      const { selectPublicRounds } = await import('@/lib/golf/course-stats');
      const { addDaysIso, utcToday } = await import('@/lib/competitions/golf-weeks');
      const since = addDaysIso(utcToday(), -365);
      const readRounds = (withType: boolean) => {
        let q = admin
          .from('golf_rounds')
          .select('id, date, course, course_id, tee, holes, gross_score, created_at')
          .eq('profile_id', p.id)
          .eq('is_complete', true)
          .gte('date', since)
          .order('date', { ascending: false })
          .limit(40);
        if (withType) q = q.eq('round_type', 'outdoor');
        return q;
      };
      let res = await readRounds(true);
      if (res.error?.code === '42703') res = await readRounds(false);
      const rows = (res.data ?? []) as Record<string, unknown>[];
      if (rows.length > 0) {
        const { data: posts } = await admin
          .from('posts')
          .select('round_id, status')
          .in('round_id', rows.map(r => r.id as string))
          .eq('visibility', 'public');
        const publicPostRoundIds = new Set(
          (posts ?? []).filter(x => x.status == null || x.status === 'published').map(x => x.round_id as string)
        );
        const candidates = rows.map(r => ({ id: r.id as string, profileId: p.id, row: r }));
        const visible = selectPublicRounds(candidates, publicPostRoundIds, new Set([p.id])).slice(0, 20);
        const courseIds = [...new Set(visible.map(v => v.row.course_id as string | null).filter((id): id is string => !!id))];
        const { data: courses } = courseIds.length
          ? await admin.from('golf_courses').select('id, name, club_name').in('id', courseIds)
          : { data: [] as { id: string; name: string; club_name: string | null }[] };
        const courseName = new Map((courses ?? []).map(c => [c.id as string, (c.club_name as string | null) ?? (c.name as string)]));
        for (const v of visible) {
          const r = v.row;
          recentRounds.push({
            id: v.id,
            date: String(r.date),
            courseName:
              (typeof r.course_id === 'string' ? courseName.get(r.course_id) : undefined) ??
              (typeof r.course === 'string' && r.course ? r.course : null),
            holes: Number(r.holes ?? 18),
            gross: Number(r.gross_score ?? 0),
            tee: (r.tee as string | null) ?? null,
          });
        }
      }
    } catch (error) {
      console.error(`${TAG} player rounds failed:`, error);
    }

    // M2 — the member's picked round photos (the site gate, per item).
    let photos: PublicPlayerPhoto[] = [];
    try {
      const { data: site } = await admin.from('org_sites').select('id').eq(orgColumn(side), orgId).maybeSingle();
      if (site) {
        const { data: mod } = await admin
          .from('org_site_modules')
          .select('config')
          .eq('site_id', site.id)
          .eq('module_key', 'gallery')
          .maybeSingle();
        const { readGalleryPicks, evaluateMemberPhotos } = await import('./member-photo-gate');
        const mine = readGalleryPicks(mod?.config).filter(pick => pick.profileId === p.id);
        if (mine.length > 0) {
          const eligible = await evaluateMemberPhotos(admin, site.id as string, mine.map(pick => pick.mediaId));
          photos = eligible
            .filter(photo => photo.profileId === p.id)
            .slice(0, 12)
            .map(photo => ({
              mediaId: photo.mediaId,
              url: `/api/media/org-gallery/${site.id}/${photo.mediaId}`,
              date: photo.date,
              courseName: photo.courseName,
            }));
        }
      }
    } catch (error) {
      console.error(`${TAG} player photos failed:`, error);
    }

    return { handle: publicHandleValue, name: publicDisplayName(p), competitions, season, handicap, recentRounds, photos };
  } catch (error) {
    console.error(`${TAG} player page failed:`, error);
    return null;
  }
}

/** The handles a site's player pages exist for — public profiles with an
 *  approved entry in the org's PUBLIC golf leaderboards. Bounded (cap per
 *  org); the sitemap's enumerator. */
export async function fetchPlayerHandlesForOrgs(
  admin: Admin,
  orgs: { key: string; side: OrgSide; orgId: string }[],
  capPerOrg = 200
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (orgs.length === 0) return out;
  try {
    for (const side of ['league', 'club'] as const) {
      const ids = orgs.filter(o => o.side === side).map(o => o.orgId);
      if (ids.length === 0) continue;
      const column = side === 'league' ? 'league_id' : 'club_id';
      const { data: comps } = await admin
        .from('competitions')
        .select(`id, ${column}`)
        .in(column, ids)
        .eq('sport_key', 'golf')
        .eq('format', 'leaderboard')
        .eq('visibility', 'public')
        .in('status', ['active', 'completed'])
        .limit(2000);
      const compRows = (comps ?? []) as unknown as Record<string, unknown>[];
      if (compRows.length === 0) continue;
      const orgByComp = new Map(compRows.map(c => [c.id as string, c[column] as string]));
      const { data: entries } = await admin
        .from('competition_entries')
        .select('competition_id, profile_id')
        .in('competition_id', [...orgByComp.keys()])
        .eq('status', 'approved')
        .not('profile_id', 'is', null)
        .limit(5000);
      const profileIds = [...new Set((entries ?? []).map(e => e.profile_id as string))];
      if (profileIds.length === 0) continue;
      const handleByProfile = new Map<string, string>();
      for (let i = 0; i < profileIds.length; i += 500) {
        const { data: profiles } = await admin
          .from('profiles')
          .select('id, handle, first_name, last_name, full_name, visibility, email, supervision_state')
          .in('id', profileIds.slice(i, i + 500))
          .eq('visibility', 'public');
        for (const pr of (profiles ?? []) as (MaskableProfile & { id: string; handle: string | null })[]) {
          const h = publicHandle(pr);
          if (h) handleByProfile.set(pr.id, h);
        }
      }
      for (const e of entries ?? []) {
        const orgId = orgByComp.get(e.competition_id as string);
        const h = handleByProfile.get(e.profile_id as string);
        if (!orgId || !h) continue;
        const key = `${side}:${orgId}`;
        if (!out.has(key)) out.set(key, []);
        const bucket = out.get(key)!;
        if (bucket.length < capPerOrg && !bucket.includes(h)) bucket.push(h);
      }
    }
  } catch (error) {
    console.error(`${TAG} player handles failed:`, error);
  }
  return out;
}

// ── The week hub (phase 8 P4) ───────────────────────────────────────────────
// "This week" on the org site: every active golf leaderboard's current
// window — who has posted, points so far — and how many entrants are ON
// THE COURSE right now. The count is the only live-round fact a public
// page may carry (anonymous viewers cannot see live-round detail —
// canViewSharedRound); it names nobody, branches on no viewer, and is
// therefore CDN-safe. Members reach names through the app's /live door.
// Built from the public standings payload (the same rows, masking and
// omission) plus one bounded read of the live rounds at the week's
// course(s) — 300s ISR, labelled "as of".

export interface PublicWeekHubResult {
  entrant_name: string;
  playerHandle?: string;
  gross: number | null;
  net: number | null;
  points?: number;
  status: 'posted' | 'final';
}

export interface PublicWeekHubLeague {
  competitionId: string;
  name: string;
  seasonLabel: string | null;
  week: {
    round: string | null;
    playFrom: string;
    playTo: string;
    state: 'open' | 'upcoming' | 'closed';
    courseName: string | null;
    holes: number;
    posted: number;
    participants: number;
    /** Days until the window closes (open weeks), or until it opens. */
    daysLeft: number;
    results: PublicWeekHubResult[];
  } | null;
  /** Entrants with a live round at the week's course(s), right now. */
  onCourseNow: number;
}

export interface PublicWeekHub {
  /** ISO timestamp of the read (the page shows "as of"). */
  asOf: string;
  today: string;
  leagues: PublicWeekHubLeague[];
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Distinct ENTRANT profiles with a live round at the courses, within the
 *  window. Service-role read; count only. */
async function countEntrantsOnCourse(
  admin: Admin,
  input: { courseIds: string[]; entrantProfiles: Set<string>; playFrom: string; playTo: string; now: number }
): Promise<number> {
  if (input.courseIds.length === 0 || input.entrantProfiles.size === 0) return 0;
  const { data: cards } = await admin
    .from('golf_scorecard_data')
    .select('group_post_id')
    .in('course_id', input.courseIds)
    .limit(400);
  const postIds = [...new Set((cards ?? []).map(c => c.group_post_id as string))];
  if (postIds.length === 0) return 0;
  const { data: rounds } = await admin
    .from('group_posts')
    .select('id, status, date, participants:group_post_participants(profile_id, status, scores:golf_participant_scores(updated_at))')
    .in('id', postIds)
    .eq('type', 'golf_round')
    .in('status', ['pending', 'active'])
    .gte('date', input.playFrom)
    .lte('date', input.playTo)
    .limit(200);
  const { isRoundLive, isActiveParticipant } = await import('@/lib/golf/round-status');
  const onCourse = new Set<string>();
  for (const r of (rounds ?? []) as Array<{
    id: string;
    status: string | null;
    date: string | null;
    participants?: Array<{
      profile_id: string;
      status: string | null;
      scores?: { updated_at: string | null } | Array<{ updated_at: string | null }> | null;
    }> | null;
  }>) {
    let lastActivity: string | null = null;
    for (const pt of r.participants ?? []) {
      const sc = Array.isArray(pt.scores) ? pt.scores[0] : pt.scores;
      if (sc?.updated_at && (!lastActivity || sc.updated_at > lastActivity)) lastActivity = sc.updated_at;
    }
    if (!isRoundLive({ status: r.status, date: r.date, last_score_activity_at: lastActivity }, input.now)) continue;
    for (const pt of r.participants ?? []) {
      if (isActiveParticipant(pt.status) && input.entrantProfiles.has(pt.profile_id)) onCourse.add(pt.profile_id);
    }
  }
  return onCourse.size;
}

export async function fetchPublicWeekHub(admin: Admin, side: OrgSide, orgId: string): Promise<PublicWeekHub> {
  const now = Date.now();
  const { utcToday } = await import('@/lib/competitions/golf-weeks');
  const today = utcToday();
  const hub: PublicWeekHub = { asOf: new Date(now).toISOString(), today, leagues: [] };
  try {
    const { fetchPublicStandings } = await import('@/lib/competitions/public-standings');
    const standings = await fetchPublicStandings(admin, side, orgId);
    if (!standings) return hub;
    for (const c of standings.competitions) {
      if (c.sport_key !== 'golf' || c.format !== 'leaderboard' || c.status !== 'active' || !c.golf) continue;
      const current = c.golf.weeks.find(w => w.id === c.golf!.currentWeekId) ?? null;
      let onCourseNow = 0;
      if (current && current.state === 'open') {
        // The week's course(s) — the venue's golf link → catalog rows.
        const { data: contest } = await admin.from('contests').select('id, venue_id').eq('id', current.id).maybeSingle();
        const { data: venue } = contest?.venue_id
          ? await admin.from('venues').select('golf_club_id, golf_course_id').eq('id', contest.venue_id).maybeSingle()
          : { data: null };
        const courseIds = new Set<string>();
        if (venue?.golf_course_id) courseIds.add(venue.golf_course_id as string);
        if (venue?.golf_club_id) {
          const { data: sections } = await admin.from('golf_courses').select('id').eq('club_id', venue.golf_club_id).limit(40);
          for (const sec of sections ?? []) courseIds.add(sec.id as string);
        }
        // The week's entrants — profiles behind the contest's participants.
        const { data: parts } = await admin
          .from('contest_participants')
          .select('entry_id')
          .eq('contest_id', current.id)
          .limit(1000);
        const entryIds = [...new Set((parts ?? []).map(pr => pr.entry_id as string))];
        const { data: entries } = entryIds.length
          ? await admin.from('competition_entries').select('profile_id').in('id', entryIds)
          : { data: [] as { profile_id: string | null }[] };
        const entrantProfiles = new Set((entries ?? []).map(e => e.profile_id as string | null).filter((id): id is string => !!id));
        onCourseNow = await countEntrantsOnCourse(admin, {
          courseIds: [...courseIds],
          entrantProfiles,
          playFrom: current.playFrom,
          playTo: current.playTo,
          now,
        });
      }
      hub.leagues.push({
        competitionId: c.id,
        name: c.name,
        seasonLabel: c.season_label,
        week: current
          ? {
              round: current.round,
              playFrom: current.playFrom,
              playTo: current.playTo,
              state: current.state,
              courseName: current.courseName,
              holes: current.holes,
              posted: current.posted,
              participants: current.participants,
              daysLeft: current.state === 'upcoming' ? daysBetween(today, current.playFrom) : daysBetween(today, current.playTo),
              results: current.results.map(r => ({
                entrant_name: r.entrant_name,
                ...(r.playerHandle ? { playerHandle: r.playerHandle } : {}),
                gross: r.gross,
                net: r.net,
                ...(typeof r.points === 'number' ? { points: r.points } : {}),
                status: r.status,
              })),
            }
          : null,
        onCourseNow,
      });
    }
  } catch (error) {
    console.error(`${TAG} week hub failed:`, error);
  }
  return hub;
}

// ── The club directory (phase 9 V6) ─────────────────────────────────────────
// /clubs: every PUBLISHED club site, grouped by region — name, place, sport,
// and "Private club · request to join" for a private one. Identity only
// (no people); bounded; cached under the sitemap tag (publish/unpublish
// purge it; the club PATCH purges it on a visibility flip).

export interface DirectoryClub {
  name: string;
  subdomain: string;
  customDomain: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  sport: string | null;
  visibility: 'public' | 'private';
}

export interface DirectoryRegion {
  label: string;
  clubs: DirectoryClub[];
}

export async function fetchPublicClubDirectory(admin: Admin): Promise<DirectoryRegion[]> {
  try {
    const readSites = (fields: string) =>
      admin.from('org_sites').select(fields).not('published_at', 'is', null).not('club_id', 'is', null).limit(500);
    let { data: sites, error } = await readSites('subdomain, club_id, custom_domain, domain_active_at');
    if (error?.code === '42703') ({ data: sites, error } = await readSites('subdomain, club_id'));
    if (degraded('directory sites', error) || !sites || sites.length === 0) return [];
    const siteRows = sites as unknown as { subdomain: string; club_id: string; custom_domain?: string | null; domain_active_at?: string | null }[];
    const clubIds = [...new Set(siteRows.map(r => r.club_id))];
    const readClubs = (fields: string) => admin.from('clubs').select(fields).in('id', clubIds);
    let { data: clubs, error: clubError } = await readClubs('id, name, city, region, country, primary_sport, visibility, approved_at');
    if (clubError?.code === '42703') ({ data: clubs, error: clubError } = await readClubs('id, name, city, region, country'));
    if (degraded('directory clubs', clubError) || !clubs) return [];
    const byId = new Map((clubs as unknown as Record<string, unknown>[]).map(c => [c.id as string, c]));
    const entries: DirectoryClub[] = [];
    for (const site of siteRows) {
      const c = byId.get(site.club_id);
      if (!c) continue;
      // Pending (C4) clubs never list; pre-174 (no column) reads live.
      if ('approved_at' in c && c.approved_at === null) continue;
      entries.push({
        name: c.name as string,
        subdomain: site.subdomain,
        customDomain: site.custom_domain && site.domain_active_at ? site.custom_domain : null,
        city: (c.city as string | null) ?? null,
        region: (c.region as string | null) ?? null,
        country: (c.country as string | null) ?? null,
        sport: (c.primary_sport as string | null) ?? null,
        visibility: c.visibility === 'private' ? 'private' : 'public',
      });
    }
    const groups = new Map<string, DirectoryClub[]>();
    for (const e of entries) {
      const label = [e.region, e.country].filter(Boolean).join(', ') || e.country || 'Elsewhere';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(e);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === 'Elsewhere' ? 1 : b === 'Elsewhere' ? -1 : a.localeCompare(b)))
      .map(([label, list]) => ({ label, clubs: list.sort((a, b) => a.name.localeCompare(b.name)) }));
  } catch (error) {
    console.error(`${TAG} directory failed:`, error);
    return [];
  }
}
