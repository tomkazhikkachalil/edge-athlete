// ── Public org-site data readers (phase 3 R2) ───────────────────────────────
// Viewer-independent plain-data reads for the (public)/org/[slug] modules,
// consumed ONLY through the cached wrappers in ./cached.ts (tag
// org-site:{slug}, 300s). The standings contract binds every function:
// nothing here may branch on a session, and nothing here may THROW — a
// throw inside unstable_cache 500s the page; a pre-migration database
// (missing table/column) is an empty module, never an error.
//
// The masking invariant: names of PEOPLE pass through publicDisplayName
// (full name only for claimed public profiles, else "First L."), and email
// is selected ONLY to feed it — no reader's return type carries email,
// handle, or avatar. NO media on the public site until phase 4's
// photo-consent flag exists.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import { listAffiliations } from '@/lib/affiliations/server';
import { type OrgEvent } from '@/lib/calendar/org-events-server';
import { isMissingTableError } from './validate';

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
    .select('role, profile:profile_id (first_name, last_name, full_name, visibility, email)')
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
}

export async function fetchPublicAffiliations(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<PublicAffiliation[]> {
  const listed = await listAffiliations(admin, side, orgId);
  if (!listed) return [];
  return listed.rows
    .filter(r => r.status === 'active' && r.org)
    .map(r => ({
      name: r.org!.name,
      affiliationType: r.affiliation_type,
      city: r.org!.city ?? null,
      region: r.org!.region ?? null,
    }));
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
      .select('joined_at, profile:profile_id (first_name, last_name, full_name, visibility, email)')
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
