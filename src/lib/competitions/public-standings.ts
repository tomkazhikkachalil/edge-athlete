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
import { resolveFixtureRule, resolveLeaderboardRule, type StandingsColumn } from './scoring';
import { publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';

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
  /** Phase 6 R4: open disputes among this competition's results — the
   *  table footnotes "includes disputed results" when > 0. */
  disputedCount: number;
  /** Phase 6c G1: 'asc' = fewer is better (strokes); null for formats
   *  without a leaderboard direction. Renderers must not read a null
   *  points cell as 0 on an ascending board. */
  direction: 'asc' | 'desc' | null;
  /** 'team' | 'athlete' — the entrant column header + the people rules. */
  entrant_type: string;
  /** G3: the club golf teaser filters on it. */
  sport_key: string;
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
    .select('id, name, season_id, sport_key, format, scoring_rule, status, entrant_type')
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

  // Phase 6 R4: open disputes per competition (embed-filtered, one read;
  // best-effort — never-throw is the standings contract).
  const disputedByComp = new Map<string, number>();
  try {
    const { data: disputedRows } = await admin
      .from('contest_results')
      .select('contest_id, contests!inner(competition_id)')
      .eq('dispute_status', 'disputed')
      .in('contests.competition_id', competitionIds)
      .limit(500);
    const seenContests = new Set<string>();
    for (const r of disputedRows ?? []) {
      if (seenContests.has(r.contest_id as string)) continue; // one per contest, not per row
      seenContests.add(r.contest_id as string);
      const embedded = r.contests as { competition_id: string } | { competition_id: string }[];
      const compId = (Array.isArray(embedded) ? embedded[0] : embedded)?.competition_id;
      if (compId) disputedByComp.set(compId, (disputedByComp.get(compId) ?? 0) + 1);
    }
  } catch {
    // pre-152/168 or embed failure — footnote simply absent
  }

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
      ? // PUBLIC page: names only — and the masterplan's §6 rule applies
        // (minors never indexed; athlete pages public only for adult+
        // public profiles). The masking rule itself lives in
        // orgs/public-names.ts (publicDisplayName), shared by every
        // public org-site surface; email is selected ONLY to feed it.
        admin
          .from('profiles')
          .select('id, first_name, last_name, full_name, visibility, email, supervision_state')
          .in('id', profileIds)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const teamName = new Map((teamsRes.data ?? []).map(t => [t.id, (t.display_name || t.name) as string]));
  const profileName = new Map(
    (profilesRes.data ?? []).map(p => [p.id, publicDisplayName(p as MaskableProfile)])
  );
  // Phase 6c G1 — THE PEOPLE RULE on a crawlable board: supervised
  // athletes are OMITTED, not masked (the gallery/leaders rule from 6b
  // widened to standings). Their rank is left as a gap, which reveals
  // nothing and keeps everyone else's rank honest.
  const supervisedProfiles = new Set(
    (profilesRes.data ?? [])
      .filter(p => p.supervision_state === 'supervised')
      .map(p => p.id as string)
  );
  const omittedEntries = new Set(
    (entries ?? []).filter(e => e.profile_id && supervisedProfiles.has(e.profile_id)).map(e => e.id)
  );
  const entryName = new Map(
    (entries ?? []).map(e => [
      e.id,
      e.team_id ? (teamName.get(e.team_id) ?? 'Team') : (profileName.get(e.profile_id) ?? 'Athlete'),
    ])
  );

  const rowsByCompetition = new Map<string, PublicStandingRow[]>();
  for (const r of standingsRes.data ?? []) {
    if (omittedEntries.has(r.entry_id)) continue;
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
          : c.format === 'leaderboard'
            ? resolveLeaderboardRule(c.sport_key as string, c.scoring_rule as string | null).columns
            : [],
      rows: rowsByCompetition.get(c.id) ?? [],
      disputedCount: disputedByComp.get(c.id) ?? 0,
      direction:
        c.format === 'leaderboard'
          ? resolveLeaderboardRule(c.sport_key as string, c.scoring_rule as string | null).direction
          : c.format === 'fixture'
            ? 'desc'
            : null,
      entrant_type: (c.entrant_type as string | null) ?? 'team',
      sport_key: c.sport_key as string,
    })),
  };
}
