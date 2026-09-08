// ── "Start our season" — the one-tap golf league (Onboarding v2 R4) ─────────
// Before: season → competition (format, scoring, config) → enter every
// rostered member by hand → activate → find the season generator on the
// competition detail page → pick ONE venue linked to ONE catalog course.
// Now: one POST composes the existing server functions, in order —
//   ensureDefaultSeason → competitionCreatePOST (golf leaderboard, gross,
//   first-posted, ANY course unless a venue is named) → the actor rosters
//   themselves (the owner plays too) → entryAddPOST for every active/placed
//   roster athlete → competitionPATCH active → golfSeasonGeneratePOST.
// Idempotent: an org that already has a live golf leaderboard gets it back
// (`action: 'exists'`) — a second tap never doubles a league.
//
// The pure half (`quickstartPlan`) is node-tested.

import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { generateRoundWindows, type SeasonRoundSpec } from '@/lib/competitions/golf-season';
import type { GolfQuickstartInput } from '@/lib/competitions/validate';
import { ensureDefaultSeason } from './default-season';
import type { OrgSide } from './listing';
import { rosterSelfPost } from './roster-server';
import {
  competitionCreatePOST,
  competitionPATCH,
  entryAddPOST,
  golfSeasonGeneratePOST,
} from './competition-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[GOLF QUICKSTART]';

export interface QuickstartPlan {
  seasonLabel: string;
  competitionName: string;
  startDate: string;
  windows: SeasonRoundSpec[];
}

/** PURE: what one tap will create. `startDate` defaults to today (UTC date). */
export function quickstartPlan(input: {
  today: Date;
  holes: 9 | 18;
  weeks: number;
  windowDays: number;
  startDate?: string | null;
}): QuickstartPlan {
  const year = String(input.today.getUTCFullYear());
  const startDate = input.startDate ?? input.today.toISOString().slice(0, 10);
  return {
    seasonLabel: year,
    competitionName: `${year} League`,
    startDate,
    windows: generateRoundWindows({ startDate, weeks: input.weeks, windowDays: input.windowDays, holes: input.holes, labelPattern: null }),
  };
}

async function readJson(res: NextResponse): Promise<Record<string, unknown>> {
  return ((await res.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
}

export async function golfQuickstartPOST(
  admin: Admin,
  user: User,
  scope: { side: OrgSide; orgId: string },
  input: GolfQuickstartInput
): Promise<NextResponse> {
  const orgCol = scope.side === 'league' ? 'league_id' : 'club_id';

  // Idempotent: a live golf leaderboard already exists → hand it back.
  const { data: existing } = await admin
    .from('competitions')
    .select('id, name, season_id, status')
    .eq(orgCol, scope.orgId)
    .eq('sport_key', 'golf')
    .eq('format', 'leaderboard')
    .in('status', ['draft', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ action: 'exists', competitionId: existing.id, seasonId: existing.season_id, name: existing.name });
  }

  const season = await ensureDefaultSeason(admin, scope, 'golf');
  if ('error' in season) {
    console.error(`${TAG} season error:`, season.error);
    return NextResponse.json({ error: 'Could not create the season' }, { status: 500 });
  }
  const plan = quickstartPlan({ today: new Date(), holes: input.holes, weeks: input.weeks, windowDays: input.windowDays, startDate: input.startDate ?? null });

  const created = await competitionCreatePOST(admin, scope, {
    side: scope.side,
    orgId: scope.orgId,
    seasonId: season.seasonId,
    sportKey: 'golf',
    name: plan.competitionName,
    format: 'leaderboard',
    scoringRule: 'golf_gross',
    visibility: 'public',
    config: { golf: { pick: 'first', ...(input.venueId ? {} : { anyCourse: true }) } },
  });
  if (!created.ok) return created;
  const compBody = await readJson(created);
  const competition = compBody.competition as { id?: string } | undefined;
  const competitionId = competition?.id;
  if (!competitionId) {
    console.error(`${TAG} competition create returned no id`, compBody);
    return NextResponse.json({ error: 'Could not create the league' }, { status: 500 });
  }

  // The owner plays too: roster the actor (R3's self opt-in; an owner is
  // never supervised — the R0 creator gate), then enter every roster athlete.
  await rosterSelfPost(admin, user, scope.side, scope.orgId);
  const { data: rosterRows } = await admin
    .from('memberships')
    .select('profile_id')
    .eq(orgCol, scope.orgId)
    .eq('kind', 'roster')
    .eq('scope_type', 'org')
    .in('status', ['active', 'placed'])
    .limit(500);
  let entered = 0;
  for (const row of (rosterRows ?? []) as { profile_id: string }[]) {
    const res = await entryAddPOST(admin, { competitionId, profileId: row.profile_id }, scope, user.id);
    if (res.ok) entered += 1;
  }

  const activated = await competitionPATCH(admin, { id: competitionId, status: 'active' }, scope);
  if (!activated.ok) return activated;

  const generated = await golfSeasonGeneratePOST(
    admin,
    {
      competitionId,
      startDate: plan.startDate,
      weeks: input.weeks,
      windowDays: input.windowDays,
      holes: input.holes,
      venueId: input.venueId ?? null,
      dryRun: false,
      publishToCalendar: input.publishToCalendar ?? true,
      timezone: input.timezone ?? 'UTC',
    },
    scope,
    user.id
  );
  if (!generated.ok) return generated;
  const genBody = await readJson(generated);

  return NextResponse.json({
    action: 'started',
    competitionId,
    seasonId: season.seasonId,
    seasonLabel: season.label,
    name: plan.competitionName,
    entered,
    rounds: (genBody.created as number | undefined) ?? plan.windows.length,
    anyCourse: !input.venueId,
  });
}
