// ── One handler for both kinds: the in-app team reads (teams & divisions, PR 8) ──
//   GET /api/{leagues,clubs}/[id]/teams            — the org page's Teams tile + window
//   GET /api/{leagues,clubs}/[id]/teams/[teamId]   — one team's in-app page
// The shims pass their kind; the gates live HERE. The org's own rules decide:
// a private org's teams are for its members (the members-list rule); a
// switched-off Teams part reads empty / 404 (hidden, never deleted). The
// answers are viewer-dependent (a member sees the team's own org's private
// games; a manager sees full names and "Manage team"), so never a shared
// cache: `private, no-store` (the edge-cache trap).

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_ID, ORG_LABEL } from '@/lib/orgs/org-ref';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';
import { switchesOf } from '@/lib/orgs/switches';
import { readOrgAccess } from '@/lib/orgs/access';
import { capabilityAllows, getOrgCapabilities, hasAnyCapability } from '@/lib/orgs/authz';
import { divisionIdsForTeam } from '@/lib/orgs/scoped-members';
import { currentTeamRosterProfileIds, currentTeamRosterRows } from '@/lib/teams/roster-server';
import { fetchTeamSchedule, readTeamForPage, readTeamRecords } from '@/lib/teams/schedule-server';
import { fetchDivisionView } from '@/lib/teams/division-server';
import { teamLogoUrl } from '@/lib/teams/logo-url';
import { teamLook } from '@/lib/teams/brand';
import { readSiteBrandRow } from '@/lib/org-sites/revalidate';
import { buildOrgBrand } from '@/lib/org-sites/brand';
import { publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import { formatDisplayName } from '@/lib/formatters';

const NO_STORE = { 'Cache-Control': 'private, no-store' };
type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Who is looking, and whether the org lets them see its teams. */
async function viewerGate(admin: Admin, kind: OrgKind, orgId: string, viewerId: string | null) {
  const { data: org } = await admin.from('organizations').select('id, name, operates_teams, operates_competitions').eq('id', orgId).maybeSingle();
  if (!org) return { error: NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 }) };
  const [access, caps] = await Promise.all([readOrgAccess(admin, kind, orgId), viewerId ? getOrgCapabilities(admin, kind, orgId, viewerId) : Promise.resolve(null)]);
  const isMember = !!caps && (caps.role !== null || hasAnyCapability(caps));
  const switches = switchesOf(org as { operates_teams?: boolean; operates_competitions?: boolean });
  return { org: org as { id: string; name: string }, caps, isMember, teamsOn: switches.teams, divisionsOn: switches.teams || switches.competitions, privateOutsider: access.visibility === 'private' && !isMember };
}

export async function teamsListRouteGET(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    if (!UUID_RE.test(params.id)) return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const gate = await viewerGate(admin, kind, params.id, user?.id ?? null);
    if ('error' in gate) return gate.error;
    if (!gate.teamsOn || gate.privateOutsider) return NextResponse.json({ teams: [] }, { headers: NO_STORE });
    const { data } = await admin
      .from('teams')
      .select('id, name, display_name, sport_key, primary_color, secondary_color, logo_path')
      .eq(ORG_ID, params.id)
      .eq('status', 'active')
      .order('name', { ascending: true })
      .limit(200);
    const teams = (data ?? []) as { id: string; name: string; display_name: string | null; sport_key: string | null; primary_color: string | null; secondary_color: string | null; logo_path: string | null }[];
    const counts = await currentTeamRosterProfileIds(admin, teams.map(t => t.id), { orgId: params.id });
    return NextResponse.json(
      {
        teams: teams.map(t => ({
          id: t.id,
          name: t.display_name || t.name,
          sportKey: t.sport_key,
          primaryColor: t.primary_color,
          secondaryColor: t.secondary_color,
          logoUrl: teamLogoUrl(t.id, t.logo_path),
          players: counts.get(t.id)?.size ?? 0,
        })),
        canManage: !!gate.caps && capabilityAllows(gate.caps, 'manage_teams'),
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[TEAMS] ${kind} list error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function teamRouteGET(request: NextRequest, kind: OrgKind, params: { id: string; teamId: string }) {
  try {
    if (!UUID_RE.test(params.id)) return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    if (!UUID_RE.test(params.teamId)) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const gate = await viewerGate(admin, kind, params.id, user?.id ?? null);
    if ('error' in gate) return gate.error;
    // Hidden (switched off) or members-only reads exactly like a missing team.
    if (!gate.teamsOn || gate.privateOutsider) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    const team = await readTeamForPage(admin, params.id, params.teamId);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const canManage = !!gate.caps && capabilityAllows(gate.caps, 'manage_teams', { type: 'team', id: team.id, parentDivisionIds: await divisionIdsForTeam(admin, team.id) });
    const mode = gate.isMember ? 'member' : 'public';
    const [brandRow, rows, schedule, records, divisionsRes] = await Promise.all([
      readSiteBrandRow(admin, kind, params.id),
      currentTeamRosterRows(admin, [team.id], { orgId: params.id }),
      fetchTeamSchedule(admin, { orgId: params.id, teamId: team.id, mode, links: { contest: id => `/event/${id}`, event: id => `/events/${id}` } }),
      readTeamRecords(admin, { orgId: params.id, teamId: team.id, mode }),
      admin.from('team_entries').select('division:divisions(id, name, season:seasons(label, archived_at))').eq('team_id', team.id),
    ]);
    const profileIds = [...new Set(rows.map(r => r.profile_id))];
    const { data: profiles } = profileIds.length
      ? await admin.from('profiles').select('id, first_name, last_name, full_name, visibility, email, supervision_state, departed_at').in('id', profileIds)
      : { data: [] };
    // A manager reads full names (they run the roster); everyone else the public mask.
    const roster = ((profiles ?? []) as (MaskableProfile & { id: string })[])
      .map(p => ({ name: canManage ? formatDisplayName(p.first_name, null, p.last_name, p.full_name) : publicDisplayName(p), supervised: p.supervision_state === 'supervised' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    type DivisionJoin = { division: { id: string; name: string; season: { label: string; archived_at: string | null } | null } | null };
    // PR 9: each current division is a door to its page.
    const divisions = ((divisionsRes.data ?? []) as unknown as DivisionJoin[])
      .flatMap(e => (e.division && !e.division.season?.archived_at ? [{ id: e.division.id, label: e.division.season ? `${e.division.name} · ${e.division.season.label}` : e.division.name }] : []));
    const divisionLabels = divisions.map(d => d.label);

    return NextResponse.json(
      {
        team: { id: team.id, name: team.display_name || team.name, sportKey: team.sport_key, divisionLabels, divisions },
        org: { id: gate.org.id, name: gate.org.name },
        look: teamLook(team, buildOrgBrand(brandRow)),
        roster: canManage || gate.isMember ? roster : roster.map(r => ({ name: r.name, supervised: false })),
        schedule,
        records,
        canManage,
        isMember: gate.isMember,
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[TEAMS] ${kind} team error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** GET /api/{leagues,clubs}/[id]/divisions/[divisionId] — one division's
 *  in-app page (PR 9). The org's rules: a private org's division is for its
 *  members; with both switches off there are no divisions to show. */
export async function divisionRouteGET(request: NextRequest, kind: OrgKind, params: { id: string; divisionId: string }) {
  try {
    if (!UUID_RE.test(params.id)) return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    if (!UUID_RE.test(params.divisionId)) return NextResponse.json({ error: 'Division not found' }, { status: 404 });
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const gate = await viewerGate(admin, kind, params.id, user?.id ?? null);
    if ('error' in gate) return gate.error;
    if (!gate.divisionsOn || gate.privateOutsider) return NextResponse.json({ error: 'Division not found' }, { status: 404 });
    const view = await fetchDivisionView(admin, {
      side: kind,
      orgId: params.id,
      divisionId: params.divisionId,
      mode: gate.isMember ? 'member' : 'public',
      links: { contest: id => `/event/${id}`, event: id => `/events/${id}` },
    });
    if (!view) return NextResponse.json({ error: 'Division not found' }, { status: 404 });
    const canManage = !!gate.caps && capabilityAllows(gate.caps, 'manage_structure', { type: 'division', id: params.divisionId });
    return NextResponse.json({ ...view, org: { id: gate.org.id, name: gate.org.name }, canManage }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[TEAMS] ${kind} division error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
