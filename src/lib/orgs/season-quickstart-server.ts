// ── "Start our season" for a TEAM sport (Round 4, Sep 2026) ─────────────────
// The golf org has had one tap since Onboarding v2 R4; a hockey or soccer
// org read "Create a season first." This is the parity door: one POST
// composes the existing server functions, in order —
//   ensureDefaultSeason → competitionCreatePOST (a FIXTURE competition —
//   the league table — in the org's sport with the sport's default points
//   rule) → entryAddPOST for every ACTIVE team of the org → competitionPATCH
//   active.
// The SCHEDULE stays the manager's: the fixtures come from the console's
// Schedule section (or an import) once the dates are known — a one-tap that
// invented a calendar would be wrong more often than right.
// Idempotent: an org that already has a live fixture competition in this
// sport gets it back (`action: 'exists'`). Refuses by name when the sport
// has no fixture format (golf, track: `format_unsupported`) or the org has
// fewer than two teams (`too_few_teams` — the checklist's "add your teams"
// step comes first).
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCompetitionProfile, defaultRuleFor } from '@/lib/sports/competition-profiles';
import { SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';
import { ensureDefaultSeason } from './default-season';
import type { OrgSide } from './listing';
import { ORG_ID } from './org-ref';
import { competitionCreatePOST, competitionPATCH, entryAddPOST } from './competition-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;
const TAG = '[SEASON QUICKSTART]';

async function readJson(res: NextResponse): Promise<Record<string, unknown>> {
  return ((await res.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
}

/** The competition's name: "Ice Hockey 2026–27 league" / "Soccer 2026 league". */
export function seasonCompetitionName(sportKey: string, seasonLabel: string): string {
  const sport = sportKey in SPORT_REGISTRY ? SPORT_REGISTRY[sportKey as SportKey].display_name : sportKey;
  return `${sport} ${seasonLabel} league`;
}

export async function seasonQuickstartPOST(
  admin: Admin,
  actorId: string,
  scope: { side: OrgSide; orgId: string },
  sportKey: string
): Promise<NextResponse> {
  const profile = resolveCompetitionProfile(sportKey);
  if (!profile.formats.fixture) {
    return NextResponse.json({ error: 'This sport has no league-table season to start here.', reason: 'format_unsupported' }, { status: 400 });
  }

  // Idempotent: a live fixture competition in this sport → hand it back.
  const { data: existing } = await admin
    .from('competitions')
    .select('id, name, season_id, status')
    .eq(ORG_ID, scope.orgId)
    .eq('sport_key', sportKey)
    .eq('format', 'fixture')
    .in('status', ['active', 'draft'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ action: 'exists', competitionId: existing.id, seasonId: existing.season_id, name: existing.name });
  }

  const { data: teams } = await admin.from('teams').select('id').eq(ORG_ID, scope.orgId).eq('status', 'active').limit(200);
  const teamIds = ((teams ?? []) as Array<{ id: string }>).map(t => t.id);
  if (teamIds.length < 2) {
    return NextResponse.json({ error: 'Add at least two teams first — the season is a table of them.', reason: 'too_few_teams', teams: teamIds.length }, { status: 400 });
  }

  const season = await ensureDefaultSeason(admin, scope, sportKey);
  if ('error' in season) {
    console.error(`${TAG} season:`, season.error);
    return NextResponse.json({ error: 'Could not create the season' }, { status: 500 });
  }

  const created = await competitionCreatePOST(admin, scope, {
    side: scope.side,
    orgId: scope.orgId,
    seasonId: season.seasonId,
    sportKey,
    name: seasonCompetitionName(sportKey, season.label),
    format: 'fixture',
    scoringRule: defaultRuleFor(profile, 'fixture') ?? 'points_2_1_0',
    visibility: 'public',
    config: {},
  });
  if (!created.ok) return created;
  const compBody = await readJson(created);
  const competitionId = (compBody.competition as { id?: string } | undefined)?.id;
  if (!competitionId) {
    console.error(`${TAG} competition create returned no id`, compBody);
    return NextResponse.json({ error: 'Could not create the league' }, { status: 500 });
  }

  let entered = 0;
  for (const teamId of teamIds) {
    const res = await entryAddPOST(admin, { competitionId, teamId }, scope, actorId);
    if (res.ok) entered += 1;
  }

  const activated = await competitionPATCH(admin, { id: competitionId, status: 'active' }, scope);
  if (!activated.ok) return activated;

  return NextResponse.json(
    { action: 'created', competitionId, seasonId: season.seasonId, seasonCreated: season.created, name: seasonCompetitionName(sportKey, season.label), teamsEntered: entered, teams: teamIds.length },
    { status: 201 }
  );
}
