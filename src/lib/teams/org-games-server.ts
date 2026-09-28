// ── An org's games — the READS (sports-team website program, G1 + G3) ──────
// Every game of the org's public fixture / bracket competitions (all
// divisions) AND, since G3, every game its own teams play in another org's
// public competition (a club's teams in a league), as the division page
// reads them: home-first "Comets 2–3 Blazers" (`divisionSchedule` — there is
// no one side to read a W/L from at the org level), upcoming soonest first,
// results newest first, each item tagged with the teams playing it
// (`teamIds`, the game-day tiles' team filter). The site's Results page and
// its game-day sections read it. A window keeps it bounded (-60 … +60 days
// by the contest's time).
//
// The gates, the team schedule's (`schedule-server.ts readContests`): the
// org's own competitions need "We run competitions"; another org's need
// ITS switch and that org not private; every competition public. Never
// throws: a failed read is empty, logged.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, type OrgKind } from '@/lib/orgs/org-ref';
import { switchesOf } from '@/lib/orgs/switches';
import { divisionSchedule, inGameWindow, type TeamScheduleItem } from './schedule';
import { CONTEST_FIELDS, resolveOutcomes, type CompetitionRow, type ContestRow } from './schedule-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG GAMES]';
const COMP_FIELDS = 'id, name, org_id, visibility, status, format, sport_key, scoring_rule';
const GAME_FORMATS = ['fixture', 'bracket'];

export interface OrgGames {
  upcoming: TeamScheduleItem[];
  results: TeamScheduleItem[];
}

export interface OrgGamesLinks {
  /** `competitionOrgId` = the org that runs the contest's competition. */
  contest: (contestId: string, competitionOrgId: string) => string | null;
}

export async function fetchOrgGames(admin: Admin, input: { side: OrgKind; orgId: string; links: OrgGamesLinks }): Promise<OrgGames> {
  const empty: OrgGames = { upcoming: [], results: [] };
  try {
    const [orgRes, ownRes, teamsRes] = await Promise.all([
      admin.from('organizations').select('operates_competitions').eq('id', input.orgId).maybeSingle(),
      admin.from('competitions').select(COMP_FIELDS).eq(ORG_ID, input.orgId).eq('visibility', 'public').in('status', ['active', 'completed']).in('format', GAME_FORMATS).limit(50),
      admin.from('teams').select('id').eq(ORG_ID, input.orgId).limit(200),
    ]);
    const own = switchesOf(orgRes.data as { operates_competitions?: boolean } | null).competitions ? ((ownRes.data ?? []) as CompetitionRow[]) : [];
    const orgTeamIds = new Set(((teamsRes.data ?? []) as { id: string }[]).map(t => t.id));

    // G3: the org's teams' entries in OTHER orgs' public competitions.
    let foreign: CompetitionRow[] = [];
    if (orgTeamIds.size > 0) {
      const { data: entries } = await admin.from('competition_entries').select('competition_id').in('team_id', [...orgTeamIds]).eq('status', 'approved').limit(200);
      const ownIds = new Set(((ownRes.data ?? []) as CompetitionRow[]).map(c => c.id));
      const ids = [...new Set(((entries ?? []) as { competition_id: string }[]).map(e => e.competition_id))].filter(id => !ownIds.has(id));
      if (ids.length > 0) {
        const { data: comps } = await admin.from('competitions').select(COMP_FIELDS).in('id', ids).eq('visibility', 'public').in('status', ['active', 'completed']).in('format', GAME_FORMATS);
        const rows = ((comps ?? []) as CompetitionRow[]).filter(c => c.org_id !== input.orgId);
        const { data: orgs } = rows.length ? await admin.from('organizations').select('id, visibility, operates_competitions').in('id', [...new Set(rows.map(c => c.org_id))]) : { data: [] };
        const orgById = new Map(((orgs ?? []) as { id: string; visibility: string | null; operates_competitions?: boolean }[]).map(o => [o.id, o]));
        foreign = rows.filter(c => {
          const o = orgById.get(c.org_id);
          return !!o && o.visibility !== 'private' && switchesOf(o).competitions;
        });
      }
    }
    const comps = [...own, ...foreign];
    if (comps.length === 0) return empty;
    const compById = new Map(comps.map(c => [c.id, c]));
    const foreignIds = new Set(foreign.map(c => c.id));
    const reads = await Promise.all([
      own.length ? admin.from('contests').select(CONTEST_FIELDS).in('competition_id', own.map(c => c.id)).limit(500) : Promise.resolve({ data: [], error: null }),
      foreign.length ? admin.from('contests').select(CONTEST_FIELDS).in('competition_id', foreign.map(c => c.id)).limit(500) : Promise.resolve({ data: [], error: null }),
    ]);
    for (const r of reads) {
      if (r.error) {
        console.error(`${TAG} contests read failed:`, r.error);
        return empty;
      }
    }
    const nowMs = Date.now();
    const contestRows = reads.flatMap(r => (r.data ?? []) as ContestRow[]).filter(c => inGameWindow(c.scheduled_at ?? c.play_from, nowMs));
    const entryTeams = new Map<string, string>();
    const outcomes = await resolveOutcomes(admin, contestRows, compById, entryTeams);
    const teamsOf = new Map<string, string[]>();
    for (const c of contestRows) {
      const o = outcomes.get(c.id);
      const sides = o && (o.kind === 'fixture' || o.kind === 'bracket') ? [o.home?.entryId, o.away?.entryId] : [];
      teamsOf.set(c.id, [...new Set(sides.map(e => (e ? entryTeams.get(e) : undefined)).filter((v): v is string => !!v))]);
    }
    const out = divisionSchedule({
      calendar: [],
      contests: contestRows.flatMap(c => {
        const comp = compById.get(c.competition_id);
        const outcome = outcomes.get(c.id);
        // Another org's competition: only the games one of OUR teams plays.
        if (comp && foreignIds.has(comp.id) && !(teamsOf.get(c.id) ?? []).some(t => orgTeamIds.has(t))) return [];
        return comp && outcome
          ? [{ id: c.id, competitionName: comp.name, round: c.round, scheduledAt: c.scheduled_at, playFrom: c.play_from, status: c.status, eventId: c.event_id, outcome, href: input.links.contest(c.id, comp.org_id) }]
          : [];
      }),
    });
    const tag = (i: TeamScheduleItem): TeamScheduleItem => {
      const ids = teamsOf.get(i.key.slice('contest:'.length));
      return ids && ids.length ? { ...i, teamIds: ids } : i;
    };
    return { upcoming: out.upcoming.map(tag), results: out.results.map(tag) };
  } catch (e) {
    console.error(`${TAG} failed:`, e);
    return empty;
  }
}
