// ── Public standings — the viewer-independent read (phase 2 R3, THE SPIKE) ──
// One fetch shared by the /api/{side}s/[id]/standings route (the #303
// CDN recipe: cacheable per org, NO Vary:Cookie) and the repo's first
// SERVER-COMPONENT page (/league/[id]/standings). Service-role reads
// gated app-side on competitions.visibility='public' — posture A stays;
// whether phase 3 flips this table to an anon-GRANT projection is the
// spike's DEVLOG verdict.
//
// VIEWER-INDEPENDENT is the contract: nothing here may branch on a
// session, so one cached entry serves everyone (authed or not).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { resolveFixtureRule, type StandingsColumn } from './scoring';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface PublicStandingRow {
  rank: number;
  entrant_name: string;
  played: number;
  points: number | null;
  stats: Record<string, number>;
}

export interface PublicCompetitionStandings {
  id: string;
  name: string;
  season_label: string | null;
  format: string;
  status: string;
  columns: StandingsColumn[];
  rows: PublicStandingRow[];
}

export interface PublicStandingsPayload {
  orgName: string;
  competitions: PublicCompetitionStandings[];
}

export async function fetchPublicStandings(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<PublicStandingsPayload | null> {
  const orgTable = side === 'league' ? 'leagues' : 'clubs';
  const orgColumn = side === 'league' ? 'league_id' : 'club_id';

  const { data: org } = await admin.from(orgTable).select('id, name').eq('id', orgId).maybeSingle();
  if (!org) return null;

  const { data: competitions, error } = await admin
    .from('competitions')
    .select('id, name, season_id, sport_key, format, scoring_rule, status')
    .eq(orgColumn, orgId)
    .eq('visibility', 'public')
    .in('status', ['active', 'completed'])
    .order('created_at', { ascending: false })
    .limit(20);
  if (error || !competitions || competitions.length === 0) {
    return { orgName: org.name as string, competitions: [] };
  }

  const competitionIds = competitions.map(c => c.id);
  const seasonIds = [...new Set(competitions.map(c => c.season_id))];
  const [standingsRes, seasonsRes] = await Promise.all([
    admin
      .from('competition_standings')
      .select('competition_id, entry_id, rank, points, played, stats')
      .in('competition_id', competitionIds)
      .order('rank', { ascending: true })
      .limit(1000),
    admin.from('seasons').select('id, label').in('id', seasonIds),
  ]);
  const seasonLabel = new Map((seasonsRes.data ?? []).map(s => [s.id, s.label as string]));

  // Entrant display names, batched.
  const entryIds = [...new Set((standingsRes.data ?? []).map(r => r.entry_id))];
  const { data: entries } = entryIds.length
    ? await admin
        .from('competition_entries')
        .select('id, team_id, profile_id')
        .in('id', entryIds)
    : { data: [] };
  const teamIds = [...new Set((entries ?? []).map(e => e.team_id).filter(Boolean))] as string[];
  const profileIds = [...new Set((entries ?? []).map(e => e.profile_id).filter(Boolean))] as string[];
  const [teamsRes, profilesRes] = await Promise.all([
    teamIds.length
      ? admin.from('teams').select('id, name, display_name').in('id', teamIds)
      : Promise.resolve({ data: [] as never[] }),
    profileIds.length
      ? // PUBLIC page: name only, and ONLY for entrants whose entry exists —
        // athlete entrants resolved through roster rows (R5); no other
        // profile fields ever cross this boundary.
        admin.from('profiles').select('id, first_name, last_name, full_name').in('id', profileIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const teamName = new Map((teamsRes.data ?? []).map(t => [t.id, (t.display_name || t.name) as string]));
  const profileName = new Map(
    (profilesRes.data ?? []).map(p => [
      p.id,
      ([p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || 'Athlete') as string,
    ])
  );
  const entryName = new Map(
    (entries ?? []).map(e => [
      e.id,
      e.team_id ? (teamName.get(e.team_id) ?? 'Team') : (profileName.get(e.profile_id) ?? 'Athlete'),
    ])
  );

  const rowsByCompetition = new Map<string, PublicStandingRow[]>();
  for (const r of standingsRes.data ?? []) {
    if (!rowsByCompetition.has(r.competition_id)) rowsByCompetition.set(r.competition_id, []);
    rowsByCompetition.get(r.competition_id)!.push({
      rank: r.rank,
      entrant_name: entryName.get(r.entry_id) ?? 'Entrant',
      played: r.played,
      points: r.points,
      stats: (r.stats ?? {}) as Record<string, number>,
    });
  }

  return {
    orgName: org.name as string,
    competitions: competitions.map(c => ({
      id: c.id,
      name: c.name as string,
      season_label: seasonLabel.get(c.season_id) ?? null,
      format: c.format as string,
      status: c.status as string,
      columns:
        c.format === 'fixture'
          ? resolveFixtureRule(c.sport_key as string, c.scoring_rule as string | null).columns
          : [],
      rows: rowsByCompetition.get(c.id) ?? [],
    })),
  };
}
