// ── One handler for both kinds: /api/{leagues,clubs}/[id]/teams/[teamId]/roster ──
// Teams & divisions program, PR 4. The two route files are shims that pass
// their kind; the gates live HERE (the route-authz audit follows the
// delegation). The gate is `manage_teams` at the TEAM's scope — an org-wide
// Teams grant, or a coach's grant on this team or its division — and a move
// is checked on BOTH teams. The writes go through the one writer
// (src/lib/teams/roster-server.ts); the bells through teams/notify.ts.

import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { type OrgKind, ORG_ID, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { divisionIdsForTeam } from '@/lib/orgs/scoped-members';
import { reportRouteError } from '@/lib/observability/report';
import { TeamRosterAddSchema, TeamRosterMoveSchema, TeamRosterRemoveSchema } from '@/lib/teams/validate';
import { addToTeam, currentTeamRosterRows, moveBetweenTeams, pinTeam, removeFromTeam, type TeamRosterResult } from '@/lib/teams/roster-server';
import { TEAM_ADD_REFUSAL } from '@/lib/teams/roster';
import { notifyTeamRoster } from '@/lib/teams/notify';

type Params = { id: string; teamId: string };
type Admin = ReturnType<typeof getSupabaseAdmin>;

async function gateTeam(admin: Admin, user: User, kind: OrgKind, orgId: string, teamId: string) {
  return requireOrgManager(admin, user, kind, orgId, {
    intent: 'manage_teams',
    scope: { type: 'team', id: teamId, parentDivisionIds: await divisionIdsForTeam(admin, teamId) },
  });
}

function badIds(kind: OrgKind, params: Params): NextResponse | null {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
  if (!UUID_RE.test(params.teamId)) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  return null;
}

function refusal(result: Extract<TeamRosterResult, { ok: false }>): NextResponse {
  switch (result.reason) {
    case 'team_not_found':
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    case 'not_member':
    case 'needs_org_roster':
      return NextResponse.json({ error: TEAM_ADD_REFUSAL[result.reason], code: result.reason }, { status: 400 });
    case 'no_season':
      return NextResponse.json({ error: 'Start a season first — a team roster belongs to a season', code: 'no_season' }, { status: 400 });
    case 'already_on_team':
      return NextResponse.json({ error: 'Already on that team', code: 'already_on_team' }, { status: 409 });
    case 'not_on_team':
      return NextResponse.json({ error: 'Not on this team', code: 'not_on_team' }, { status: 404 });
    default:
      return NextResponse.json({ error: 'Could not update the team roster' }, { status: 500 });
  }
}

function nameOf(p: { first_name?: string | null; last_name?: string | null; full_name?: string | null } | undefined): string {
  if (!p) return 'Member';
  return p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || 'Member';
}

/** GET — who is on the team now; `?candidates=1` adds the org's members who
 *  could be added (with whether they are on the org roster yet). */
export async function teamRosterRouteGET(request: NextRequest, kind: OrgKind, params: Params) {
  try {
    const user = await requireAuth(request);
    const bad = badIds(kind, params);
    if (bad) return bad;
    const admin = getSupabaseAdmin();
    const gate = await gateTeam(admin, user, kind, params.id, params.teamId);
    if (!gate.ok) return gate.response;
    const team = await pinTeam(admin, params.id, params.teamId);
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });

    const rows = await currentTeamRosterRows(admin, [team.id], { orgId: params.id });
    const wantCandidates = request.nextUrl.searchParams.get('candidates') === '1';
    const { data: memberRows } = wantCandidates
      ? await admin.from('memberships').select('profile_id, kind, status').eq(ORG_ID, params.id).eq('scope_type', 'org').in('kind', ['follow', 'roster']).limit(2000)
      : { data: [] as { profile_id: string; kind: string; status: string }[] };
    const onTeam = new Set(rows.map(r => r.profile_id));
    const followers = new Set<string>();
    const rostered = new Set<string>();
    for (const m of (memberRows ?? []) as { profile_id: string; kind: string; status: string }[]) {
      if (m.kind === 'follow') followers.add(m.profile_id);
      if (m.kind === 'roster' && (m.status === 'active' || m.status === 'placed')) rostered.add(m.profile_id);
    }
    const candidateIds = [...followers].filter(id => !onTeam.has(id));
    const ids = [...new Set([...onTeam, ...candidateIds])];
    const { data: profiles } = ids.length
      ? await admin.from('profiles').select('id, first_name, last_name, full_name, supervision_state, departed_at').in('id', ids)
      : { data: [] };
    const byId = new Map(((profiles ?? []) as { id: string; departed_at?: string | null; supervision_state?: string | null }[]).map(p => [p.id, p]));
    const player = (id: string) => {
      const p = byId.get(id) as Parameters<typeof nameOf>[0] & { supervision_state?: string | null };
      return { profileId: id, name: nameOf(p), supervised: p?.supervision_state === 'supervised' };
    };
    return NextResponse.json(
      {
        team,
        roster: rows.map(r => ({ ...player(r.profile_id), seasonId: r.season_id, joinedAt: r.joined_at })).sort((a, b) => a.name.localeCompare(b.name)),
        ...(wantCandidates
          ? {
              candidates: candidateIds
                .filter(id => !(byId.get(id) as { departed_at?: string | null } | undefined)?.departed_at)
                .map(id => ({ ...player(id), onRoster: rostered.has(id) }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            }
          : {}),
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[TEAM ROSTER] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST { profileId } — put a member of the org's roster on the team. */
export async function teamRosterRoutePOST(request: NextRequest, kind: OrgKind, params: Params) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const bad = badIds(kind, params);
    if (bad) return bad;
    const admin = getSupabaseAdmin();
    const gate = await gateTeam(admin, user, kind, params.id, params.teamId);
    if (!gate.ok) return gate.response;
    const parsed = await parseBody(request, TeamRosterAddSchema);
    if (!parsed.success) return parsed.response;
    const ref = { side: kind, orgId: params.id };
    const result = await addToTeam(admin, ref, params.teamId, parsed.data.profileId);
    if (!result.ok) return refusal(result);
    await notifyTeamRoster(admin, { ...ref, orgName: gate.org.name, profileId: parsed.data.profileId, actorId: user.id, notice: { kind: 'added', teamName: result.team.name } });
    return NextResponse.json({ ok: true, seasonId: result.seasonId });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[TEAM ROSTER] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH { profileId, toTeamId } — move the player's current spot to another team. */
export async function teamRosterRoutePATCH(request: NextRequest, kind: OrgKind, params: Params) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const bad = badIds(kind, params);
    if (bad) return bad;
    const admin = getSupabaseAdmin();
    const parsed = await parseBody(request, TeamRosterMoveSchema);
    if (!parsed.success) return parsed.response;
    if (parsed.data.toTeamId === params.teamId) return NextResponse.json({ error: 'Already on that team', code: 'already_on_team' }, { status: 409 });
    // Both ends: a coach moves a player only between teams they run.
    const gate = await gateTeam(admin, user, kind, params.id, params.teamId);
    if (!gate.ok) return gate.response;
    const gateTo = await gateTeam(admin, user, kind, params.id, parsed.data.toTeamId);
    if (!gateTo.ok) return gateTo.response;
    const ref = { side: kind, orgId: params.id };
    const result = await moveBetweenTeams(admin, ref, params.teamId, parsed.data.toTeamId, parsed.data.profileId);
    if (!result.ok) return refusal(result);
    await notifyTeamRoster(admin, { ...ref, orgName: gate.org.name, profileId: parsed.data.profileId, actorId: user.id, notice: { kind: 'moved', fromName: result.from.name, teamName: result.to.name } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[TEAM ROSTER] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE { profileId } — take the player off the team (their current spot). */
export async function teamRosterRouteDELETE(request: NextRequest, kind: OrgKind, params: Params) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-structure', { userId: user.id });
    if (limited) return limited;
    const bad = badIds(kind, params);
    if (bad) return bad;
    const admin = getSupabaseAdmin();
    const gate = await gateTeam(admin, user, kind, params.id, params.teamId);
    if (!gate.ok) return gate.response;
    const parsed = await parseBody(request, TeamRosterRemoveSchema);
    if (!parsed.success) return parsed.response;
    const ref = { side: kind, orgId: params.id };
    const result = await removeFromTeam(admin, ref, params.teamId, parsed.data.profileId);
    if (!result.ok) return refusal(result);
    await notifyTeamRoster(admin, { ...ref, orgName: gate.org.name, profileId: parsed.data.profileId, actorId: user.id, notice: { kind: 'removed', teamName: result.team.name } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[TEAM ROSTER] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
