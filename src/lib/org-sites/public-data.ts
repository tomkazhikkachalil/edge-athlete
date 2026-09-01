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
import type { OrgSide } from '@/lib/orgs/authz';
import { publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import { listAffiliations } from '@/lib/affiliations/server';
import { type OrgEvent } from '@/lib/calendar/org-events-server';
import { isMissingTableError, MODULE_SUBPAGE_KEYS } from './validate';

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
  lastModified: string | null;
  moduleKeys: string[]; // enabled subpage modules (news/standings/schedule/teams)
  pageSlugs: string[]; // public custom pages
  teamIds: string[]; // active teams, only when the teams module is enabled
  newsSlugs: string[]; // published posts, only when the news module is enabled
}

/** Every published site with its crawlable sub-URLs — the repo's first
 *  org_sites enumerator, explicitly bounded (house rule). Cached under
 *  the 'org-sitemap' tag; publish/unpublish purge it, module/page churn
 *  rides the hourly revalidate. Degrades partial, never throws. */
export async function fetchPublishedSitesForSitemap(
  admin: Admin
): Promise<SitemapSiteEntry[]> {
  const { data: sites, error } = await admin
    .from('org_sites')
    .select('id, subdomain, updated_at, league_id, club_id')
    .not('published_at', 'is', null)
    .order('created_at', { ascending: true })
    .limit(500);
  if (degraded('sitemap sites', error) || !sites || sites.length === 0) return [];

  const siteIds = sites.map(s => s.id as string);
  const leagueIds = sites.map(s => s.league_id as string | null).filter(Boolean) as string[];
  const clubIds = sites.map(s => s.club_id as string | null).filter(Boolean) as string[];
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

  return sites.map(s => {
    const moduleKeys = modulesBySite.get(s.id) ?? [];
    const orgKey = s.league_id ? `league:${s.league_id}` : `club:${s.club_id}`;
    return {
      subdomain: s.subdomain as string,
      lastModified: (s.updated_at ?? null) as string | null,
      moduleKeys,
      pageSlugs: pagesBySite.get(s.id) ?? [],
      // Team pages 404 when the module is off — gate like requireSiteModule.
      teamIds: moduleKeys.includes('teams') ? (teamsByOrg.get(orgKey) ?? []) : [],
      newsSlugs: moduleKeys.includes('news') ? (newsBySite.get(s.id) ?? []) : [],
    };
  });
}

// ── News (phase 3.5) ────────────────────────────────────────────────────────

export interface PublicNewsItem {
  slug: string;
  title: string;
  publishedAt: string;
  excerpt: string | null; // first paragraph block, truncated
}

export interface PublicNewsPost {
  slug: string;
  title: string;
  publishedAt: string;
  body: unknown; // parsed defensively at render (parsePageBody)
}

function firstParagraph(body: unknown): string | null {
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
  siteId: string
): Promise<PublicNewsItem[]> {
  const { data, error } = await admin
    .from('org_site_news')
    .select('slug, title, body, published_at')
    .eq('site_id', siteId)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(50);
  if (degraded('news list', error) || !data) return [];
  return data.map(n => ({
    slug: n.slug as string,
    title: n.title as string,
    publishedAt: n.published_at as string,
    excerpt: firstParagraph(n.body),
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
  newsSlug: string
): Promise<PublicNewsPost | null> {
  const { data, error } = await admin
    .from('org_site_news')
    .select('slug, title, body, published_at')
    .eq('site_id', siteId)
    .eq('slug', newsSlug)
    .not('published_at', 'is', null)
    .maybeSingle();
  if (degraded('news post', error) || !data) return null;
  return {
    slug: data.slug as string,
    title: data.title as string,
    publishedAt: data.published_at as string,
    body: data.body,
  };
}
