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
import { readApproval } from '@/lib/orgs/approval';
import type { OrgSide } from '@/lib/orgs/authz';
import { resolveFixtureRule, resolveLeaderboardRule, type StandingsColumn } from './scoring';
import { publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import {
  buildGolfBlock,
  utcToday,
  type GolfContestRaw,
  type GolfParticipantRaw,
  type GolfResultRaw,
  type PublicGolfBlock,
} from './golf-weeks';

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
  /** Phase 6d W1: the week-to-week view of a golf leaderboard — the
   *  open window, who has posted, per-round results. PRESENT ONLY when
   *  the competition has at least one windowed round (mig 172), so
   *  legacy boards and non-golf payloads are byte-identical to before. */
  golf?: PublicGolfBlock;
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
  // Phase 7 C4: a pending org (174) publishes nothing yet — the page keeps
  // its shape (the org name, the empty state), never a 404 for managers
  // previewing their own twin.
  if ((await readApproval(admin, side, orgId)).pending) {
    return { orgName: org.name as string, competitions: [] };
  }

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

  // Phase 6d W1: the golf weeks' raw rows (windowed rounds, their
  // participants and results). Read BEFORE the names so a member who has
  // posted this week but has no standings row yet (standings count only
  // completed rounds) still gets a masked name. Never throws — pre-172
  // (no holes/play_from) simply yields no block.
  const golfRaw = await readGolfWeeksRaw(
    admin,
    competitions.filter(c => c.sport_key === 'golf' && c.format === 'leaderboard').map(c => c.id)
  );
  const golfParticipantEntry = new Map(golfRaw.participants.map(p => [p.id, p.entry_id]));
  const golfResultEntryIds = golfRaw.results
    .map(r => golfParticipantEntry.get(r.participant_id))
    .filter((id): id is string => !!id);

  // Entrant display names, batched.
  const entryIds = [
    ...new Set([...(standingsRes.data ?? []).map(r => r.entry_id), ...golfResultEntryIds]),
  ];
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

  function golfBlockFor(competitionId: string, scoringRule: string | null): { golf?: PublicGolfBlock } {
    const contests = golfRaw.contestsByCompetition.get(competitionId);
    if (!contests || contests.length === 0) return {};
    const contestIds = new Set(contests.map(c => c.id));
    const block = buildGolfBlock({
      contests,
      participants: golfRaw.participants.filter(p => contestIds.has(p.contest_id)),
      results: golfRaw.results.filter(r => contestIds.has(r.contest_id)),
      entryName,
      omittedEntries,
      courseNameByVenue: golfRaw.courseNameByVenue,
      pick: golfRaw.pickByCompetition.get(competitionId) ?? 'first',
      scoringRule,
      today: utcToday(),
    });
    return block ? { golf: block } : {};
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
      ...golfBlockFor(c.id, c.scoring_rule as string | null),
    })),
  };

}

interface GolfWeeksRaw {
  contestsByCompetition: Map<string, GolfContestRaw[]>;
  participants: GolfParticipantRaw[];
  results: GolfResultRaw[];
  courseNameByVenue: Map<string, string>;
  pickByCompetition: Map<string, 'first' | 'best'>;
}

const EMPTY_GOLF_RAW: GolfWeeksRaw = {
  contestsByCompetition: new Map(),
  participants: [],
  results: [],
  courseNameByVenue: new Map(),
  pickByCompetition: new Map(),
};

/** The windowed rounds of the org's public golf leaderboards, with their
 *  participants, results and course names — bounded (≤300 rounds, ≤2000
 *  participants, ≤1000 results per org payload) and never-throw. */
async function readGolfWeeksRaw(admin: Admin, competitionIds: string[]): Promise<GolfWeeksRaw> {
  if (competitionIds.length === 0) return EMPTY_GOLF_RAW;
  try {
    const { data: contests, error } = await admin
      .from('contests')
      .select('id, competition_id, round, status, venue_id, holes, play_from, play_to')
      .in('competition_id', competitionIds)
      .not('holes', 'is', null)
      .order('play_from', { ascending: true })
      .limit(300);
    if (error || !contests || contests.length === 0) return EMPTY_GOLF_RAW;

    const contestIds = contests.map(c => c.id as string);
    const venueIds = [...new Set(contests.map(c => c.venue_id).filter(Boolean))] as string[];
    const [participantsRes, resultsRes, venuesRes, configRes] = await Promise.all([
      admin
        .from('contest_participants')
        .select('id, contest_id, entry_id')
        .in('contest_id', contestIds)
        .limit(2000),
      admin
        .from('contest_results')
        .select('contest_id, participant_id, score, payload, provenance, dispute_status')
        .in('contest_id', contestIds)
        .limit(1000),
      venueIds.length
        ? admin.from('venues').select('id, name, golf_course_id').in('id', venueIds)
        : Promise.resolve({ data: [] as { id: string; name: string; golf_course_id: string | null }[] }),
      admin.from('competitions').select('id, config').in('id', competitionIds),
    ]);

    // Course name: the linked course's catalog name; a club-linked venue
    // (many courses) or an unlinked one reads as the venue itself.
    const courseIds = [...new Set((venuesRes.data ?? []).map(v => v.golf_course_id).filter(Boolean))] as string[];
    const { data: courses } = courseIds.length
      ? await admin.from('golf_courses').select('id, name').in('id', courseIds)
      : { data: [] as { id: string; name: string }[] };
    const courseName = new Map((courses ?? []).map(c => [c.id as string, c.name as string]));
    const courseNameByVenue = new Map<string, string>();
    for (const v of venuesRes.data ?? []) {
      const linked = v.golf_course_id ? courseName.get(v.golf_course_id as string) : undefined;
      courseNameByVenue.set(v.id as string, linked ?? (v.name as string));
    }

    const pickByCompetition = new Map<string, 'first' | 'best'>();
    for (const c of configRes.data ?? []) {
      const pick = ((c.config as Record<string, unknown> | null)?.golf as { pick?: unknown } | undefined)?.pick;
      pickByCompetition.set(c.id as string, pick === 'best' ? 'best' : 'first');
    }

    const contestsByCompetition = new Map<string, GolfContestRaw[]>();
    for (const c of contests) {
      const compId = c.competition_id as string;
      if (!contestsByCompetition.has(compId)) contestsByCompetition.set(compId, []);
      contestsByCompetition.get(compId)!.push({
        id: c.id as string,
        round: (c.round as string | null) ?? null,
        status: c.status as string,
        venue_id: (c.venue_id as string | null) ?? null,
        holes: c.holes as number,
        play_from: c.play_from as string,
        play_to: c.play_to as string,
      });
    }

    return {
      contestsByCompetition,
      participants: (participantsRes.data ?? []).map(p => ({
        id: p.id as string,
        contest_id: p.contest_id as string,
        entry_id: p.entry_id as string,
      })),
      results: (resultsRes.data ?? []).map(r => ({
        contest_id: r.contest_id as string,
        participant_id: r.participant_id as string,
        score: (r.score as number | null) ?? null,
        payload: (r.payload as Record<string, unknown> | null) ?? null,
        provenance: r.provenance as string,
        dispute_status: (r.dispute_status as string | null) ?? null,
      })),
      courseNameByVenue,
      pickByCompetition,
    };
  } catch {
    // pre-172 (no holes/play_from) or an embed failure — the block is absent
    return EMPTY_GOLF_RAW;
  }
}
