import type { SupabaseClient } from '@supabase/supabase-js';
import { deriveDisplayTier, type ResultProvenance } from '@/lib/orgs/provenance';
import { computeProfileTile, type SportStatSchema, type StatLineData } from '../stat-schemas';
import type { SkillCardContribution, SkillProvenance, SkillTile } from './types';

// ── Official (org-sourced) athlete stats — phase 4 R2 ───────────────────────
// The read side of contest_stat_lines: what an athlete's profile shows
// from results entered by competition owners and team staff. Rules:
//  * PUBLIC competitions only — a private competition's stat lines (and
//    its NAME, which every surface would print) stay off the profile
//    until the org flips it public, mirroring how standings surface.
//  * 'sanctioned' is derived per line via the owning league's ACTIVE
//    sanctioned_by edge to the athlete's club (provenance.ts — the chip
//    can change when affiliations change, by design).
//  * A stored 'self_reported' displays as 'entered' — one vocabulary.
//  * NEVER throws: a pre-157 database, an RLS-limited client, or any
//    read error degrades to an empty list (the org-sites reader
//    contract). Callers own the PROFILE privacy gate.

export interface OfficialStatLine {
  contestId: string;
  competitionId: string;
  competitionName: string;
  sportKey: string;
  /** contests.scheduled_at — the game date, when known. */
  date: string | null;
  teamName: string | null;
  opponentName: string | null;
  stats: Record<string, number>;
  provenance: SkillProvenance;
  /** The provenance backlink — the owner's public standings page. */
  href: string;
}

const LINE_LIMIT = 200;

function asSkillProvenance(p: ResultProvenance): SkillProvenance {
  return p === 'self_reported' ? 'entered' : p;
}

/** Display precedence: verified beats tracked beats history beats claimed. */
export function provenanceRank(p: SkillProvenance): number {
  switch (p) {
    case 'sanctioned':
      return 6;
    case 'league_verified':
      return 5;
    case 'club_recorded':
      return 4;
    case 'tracked':
      return 3;
    case 'imported':
      return 2;
    default:
      return 1; // entered
  }
}

/** All of one athlete's official lines from PUBLIC competitions, newest
 *  contest first, sanctioned tier derived. Degrades to [] on any error. */
export async function fetchOfficialStatLines(
  admin: SupabaseClient,
  profileId: string
): Promise<OfficialStatLine[]> {
  try {
    const { data: lineRows, error } = await admin
      .from('contest_stat_lines')
      .select('contest_id, team_id, stats, provenance')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(LINE_LIMIT);
    if (error || !lineRows || lineRows.length === 0) return [];

    const contestIds = [...new Set(lineRows.map(l => l.contest_id as string))];
    const { data: contests } = await admin
      .from('contests')
      .select('id, scheduled_at, competition_id')
      .in('id', contestIds);
    const contestById = new Map(
      (contests ?? []).map(c => [
        c.id as string,
        { scheduledAt: (c.scheduled_at as string | null) ?? null, competitionId: c.competition_id as string },
      ])
    );

    const competitionIds = [...new Set([...contestById.values()].map(c => c.competitionId))];
    const { data: comps } = competitionIds.length
      ? await admin
          .from('competitions')
          .select('id, name, sport_key, league_id, club_id, visibility')
          .in('id', competitionIds)
          .eq('visibility', 'public')
      : { data: [] };
    const compById = new Map(
      (comps ?? []).map(c => [
        c.id as string,
        {
          name: c.name as string,
          sportKey: c.sport_key as string,
          leagueId: (c.league_id as string | null) ?? null,
          clubId: (c.club_id as string | null) ?? null,
        },
      ])
    );

    // Opponent names: the other side's team on each contest.
    const { data: participants } = await admin
      .from('contest_participants')
      .select('contest_id, entry:entry_id (team_id)')
      .in('contest_id', contestIds)
      .limit(1000);
    const contestTeams = new Map<string, string[]>();
    for (const p of participants ?? []) {
      const entry = Array.isArray(p.entry) ? p.entry[0] : p.entry;
      const teamId = entry?.team_id as string | null;
      if (!teamId) continue;
      const cid = p.contest_id as string;
      if (!contestTeams.has(cid)) contestTeams.set(cid, []);
      contestTeams.get(cid)!.push(teamId);
    }

    const teamIds = [
      ...new Set([
        ...lineRows.map(l => l.team_id as string | null).filter((v): v is string => !!v),
        ...[...contestTeams.values()].flat(),
      ]),
    ];
    const { data: teamRows } = teamIds.length
      ? await admin.from('teams').select('id, name, display_name, club_id').in('id', teamIds)
      : { data: [] };
    const teamById = new Map(
      (teamRows ?? []).map(t => [
        t.id as string,
        {
          name: ((t.display_name as string | null) || (t.name as string)) ?? 'Team',
          clubId: (t.club_id as string | null) ?? null,
        },
      ])
    );

    // Sanctioned derivation: one batched edge read over the league ids in
    // play, then a per-line pair check.
    const leagueIds = [
      ...new Set([...compById.values()].map(c => c.leagueId).filter((v): v is string => !!v)),
    ];
    const sanctionedPairs = new Set<string>();
    if (leagueIds.length) {
      const { data: edges } = await admin
        .from('league_clubs')
        .select('league_id, club_id')
        .in('league_id', leagueIds)
        .eq('status', 'active')
        .eq('affiliation_type', 'sanctioned_by')
        .limit(1000);
      for (const e of edges ?? []) {
        sanctionedPairs.add(`${e.league_id}:${e.club_id}`);
      }
    }

    const out: OfficialStatLine[] = [];
    for (const line of lineRows) {
      const contest = contestById.get(line.contest_id as string);
      if (!contest) continue;
      const comp = compById.get(contest.competitionId);
      if (!comp) continue; // private or missing competition — off the profile
      const ownTeamId = (line.team_id as string | null) ?? null;
      const ownTeam = ownTeamId ? teamById.get(ownTeamId) : null;
      const opponentId =
        (contestTeams.get(line.contest_id as string) ?? []).find(id => id !== ownTeamId) ?? null;
      const stored = line.provenance as ResultProvenance;
      const tier = deriveDisplayTier(stored, {
        ownerIsLeague: !!comp.leagueId,
        sanctionedEdgeToClub:
          !!comp.leagueId && !!ownTeam?.clubId
            ? sanctionedPairs.has(`${comp.leagueId}:${ownTeam.clubId}`)
            : false,
      });
      out.push({
        contestId: line.contest_id as string,
        competitionId: contest.competitionId,
        competitionName: comp.name,
        sportKey: comp.sportKey,
        date: contest.scheduledAt,
        teamName: ownTeam?.name ?? null,
        opponentName: opponentId ? (teamById.get(opponentId)?.name ?? null) : null,
        stats: (line.stats as Record<string, number>) ?? {},
        provenance: asSkillProvenance(tier),
        href: comp.leagueId
          ? `/league/${comp.leagueId}/standings`
          : `/club/${comp.clubId}/standings`,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Merge official tiles into a sport's tracked contribution (pure,
 *  node-tested). Official tiles are computed with the SAME profileTiles
 *  machinery as self-posted lines and REPLACE a tracked/entered tile of
 *  the same label (verified beats tracked — the consumedEnteredKeys
 *  precedent generalized). Tile provenance is the CONSERVATIVE minimum
 *  across the sport's official lines: a total is only as strong as its
 *  weakest source. */
export function mergeOfficialContribution(
  contribution: SkillCardContribution | null,
  officialLines: OfficialStatLine[],
  schema: SportStatSchema | null
): SkillCardContribution | null {
  if (officialLines.length === 0 || !schema) return contribution;

  let tier: SkillProvenance = 'sanctioned';
  for (const line of officialLines) {
    if (provenanceRank(line.provenance) < provenanceRank(tier)) tier = line.provenance;
  }

  const asData: StatLineData[] = officialLines.map(l => ({
    type: 'stat_line',
    sport_key: schema.sport_key,
    stats: l.stats,
  }));
  const officialTiles: SkillTile[] = schema.profileTiles.map(t => ({
    label: t.label,
    value: computeProfileTile(t, asData),
    provenance: tier,
  }));

  const officialLabels = new Set(officialTiles.map(t => t.label));
  const keptTracked = (contribution?.tiles ?? []).filter(t => !officialLabels.has(t.label));
  return {
    ...(contribution ?? {}),
    tiles: [...officialTiles, ...keptTracked],
  };
}
