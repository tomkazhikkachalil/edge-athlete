// ── A team's schedule & results — the READS (teams & divisions program, PR 7) ─
// Gathers the three sources for ONE team and hands them to the pure merge
// (schedule.ts). Two modes:
//   • 'public' — the org site's team page (ISR, viewer-independent): public
//     competitions of public orgs that run competitions, public events only;
//     every person's name masked (publicDisplayName).
//   • 'member' — the in-app team page (PR 8): also the team's OWN org's
//     private competitions and the events that org hosts.
// A competition can belong to ANOTHER org (a club's team in a league): it
// counts when that org's own gates allow it. Never throws — a failed read is
// an empty source, logged.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID } from '@/lib/orgs/org-ref';
import { switchesOf } from '@/lib/orgs/switches';
import { publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import { deriveContestOutcome } from '@/lib/competitions/contest-outcome';
import { entryDisplayName } from '@/lib/competitions/entries';
import { mergeTeamSchedule, type CalendarInput, type ContestInput, type EventInput, type TeamScheduleItem } from './schedule';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[TEAM SCHEDULE]';
const TEAM_FORMATS = new Set(['fixture', 'bracket']);

export interface TeamScheduleLinks {
  /** `competitionOrgId` = the org that runs the contest's competition. */
  contest: (contestId: string, competitionOrgId: string) => string | null;
  event: (eventId: string) => string | null;
  calendar?: (eventId: string) => string | null;
}

export interface TeamSchedule {
  upcoming: TeamScheduleItem[];
  results: TeamScheduleItem[];
}

const EMPTY: TeamSchedule = { upcoming: [], results: [] };

function logged<T>(label: string, res: { data: T | null; error: unknown }): T | null {
  if (res.error) console.error(`${TAG} ${label} read failed:`, res.error);
  return res.data;
}

export async function fetchTeamSchedule(
  admin: Admin,
  input: { orgId: string; teamId: string; mode: 'public' | 'member'; links: TeamScheduleLinks }
): Promise<TeamSchedule> {
  try {
    const [calendar, contests, events] = await Promise.all([
      readCalendar(admin, input),
      readContests(admin, input),
      readEvents(admin, input),
    ]);
    return mergeTeamSchedule({ calendar, contests, events });
  } catch (e) {
    console.error(`${TAG} failed:`, e);
    return EMPTY;
  }
}

// ── Calendar: the team's events, and its divisions' (upcoming only) ─────────
async function readCalendar(admin: Admin, input: { teamId: string; links: TeamScheduleLinks }): Promise<CalendarInput[]> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const entries = logged('team entries', await admin.from('team_entries').select('division_id').eq('team_id', input.teamId)) ?? [];
  const divisionIds = [...new Set((entries as { division_id: string }[]).map(e => e.division_id))];
  const fields = 'id, title, starts_at, all_day, timezone, location, status';
  const [teamRes, divRes] = await Promise.all([
    admin.from('events').select(fields).eq('team_id', input.teamId).eq('status', 'active').gte('starts_at', since).order('starts_at', { ascending: true }).limit(20),
    divisionIds.length
      ? admin.from('events').select(fields).in('division_id', divisionIds).eq('status', 'active').gte('starts_at', since).order('starts_at', { ascending: true }).limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const rows = [...(logged('team events', teamRes) ?? []), ...(logged('division events', divRes) ?? [])] as Omit<CalendarInput, 'href'>[];
  const seen = new Set<string>();
  return rows.filter(r => !seen.has(r.id) && !!seen.add(r.id)).map(r => ({ ...r, href: input.links.calendar?.(r.id) ?? null }));
}

// ── Contests: the fixtures / brackets the team's entries play ───────────────
async function readContests(admin: Admin, input: { orgId: string; teamId: string; mode: 'public' | 'member'; links: TeamScheduleLinks }): Promise<ContestInput[]> {
  const myEntries = (logged('entries', await admin.from('competition_entries').select('id, competition_id').eq('team_id', input.teamId).eq('status', 'approved').limit(100)) ?? []) as { id: string; competition_id: string }[];
  if (myEntries.length === 0) return [];
  const comps = (logged('competitions', await admin.from('competitions').select('id, name, org_id, visibility, status, format, sport_key, scoring_rule').in('id', [...new Set(myEntries.map(e => e.competition_id))])) ?? []) as {
    id: string; name: string; org_id: string; visibility: string; status: string; format: string; sport_key: string; scoring_rule: string | null;
  }[];
  const orgs = (logged('orgs', await admin.from('organizations').select('id, visibility, operates_competitions').in('id', [...new Set(comps.map(c => c.org_id))])) ?? []) as { id: string; visibility: string | null; operates_competitions?: boolean }[];
  const orgById = new Map(orgs.map(o => [o.id, o]));
  const allowed = new Map(
    comps
      .filter(c => TEAM_FORMATS.has(c.format) && (c.status === 'active' || c.status === 'completed'))
      .filter(c => {
        const org = orgById.get(c.org_id);
        if (!org || !switchesOf(org).competitions) return false;
        if (input.mode === 'member' && c.org_id === input.orgId) return true;
        return c.visibility === 'public' && org.visibility !== 'private';
      })
      .map(c => [c.id, c])
  );
  const entryIds = myEntries.filter(e => allowed.has(e.competition_id)).map(e => e.id);
  if (entryIds.length === 0) return [];

  const mine = (logged('my participants', await admin.from('contest_participants').select('contest_id, entry_id').in('entry_id', entryIds).limit(500)) ?? []) as { contest_id: string; entry_id: string }[];
  const myEntryByContest = new Map(mine.map(p => [p.contest_id, p.entry_id]));
  const contestIds = [...myEntryByContest.keys()];
  if (contestIds.length === 0) return [];
  const [contestsRes, partsRes] = await Promise.all([
    admin.from('contests').select('id, competition_id, event_id, scheduled_at, round, status, play_from, sport_event_round_id, stage, slot').in('id', contestIds).limit(300),
    admin.from('contest_participants').select('id, contest_id, entry_id, side, start_position').in('contest_id', contestIds).limit(1000),
  ]);
  const contestRows = (logged('contests', contestsRes) ?? []) as {
    id: string; competition_id: string; event_id: string | null; scheduled_at: string | null; round: string | null; status: string; play_from: string | null; sport_event_round_id: string | null; stage: number | null; slot: number | null;
  }[];
  const parts = (logged('participants', partsRes) ?? []) as { id: string; contest_id: string; entry_id: string; side: 'home' | 'away' | null; start_position: number | null }[];
  const allEntryIds = [...new Set(parts.map(p => p.entry_id))];
  const [entriesRes, resultsRes] = await Promise.all([
    admin.from('competition_entries').select('id, team_id, profile_id, name').in('id', allEntryIds),
    admin.from('contest_results').select('participant_id, score, payload').in('participant_id', parts.map(p => p.id)),
  ]);
  const entries = (logged('entry names', entriesRes) ?? []) as { id: string; team_id: string | null; profile_id: string | null; name: string | null }[];
  const teamIds = [...new Set(entries.map(e => e.team_id).filter((v): v is string => !!v))];
  const profileIds = [...new Set(entries.map(e => e.profile_id).filter((v): v is string => !!v))];
  const [teamsRes, profilesRes] = await Promise.all([
    teamIds.length ? admin.from('teams').select('id, name, display_name').in('id', teamIds) : Promise.resolve({ data: [], error: null }),
    profileIds.length ? admin.from('profiles').select('id, first_name, last_name, full_name, visibility, email, supervision_state, departed_at').in('id', profileIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const teamName = new Map(((logged('team names', teamsRes) ?? []) as { id: string; name: string; display_name: string | null }[]).map(t => [t.id, t.display_name || t.name]));
  const personName = new Map(((logged('people', profilesRes) ?? []) as (MaskableProfile & { id: string })[]).map(p => [p.id, publicDisplayName(p)]));
  const entryName = new Map(entries.map(e => [e.id, entryDisplayName(e, e.team_id ? teamName.get(e.team_id) : null, e.profile_id ? personName.get(e.profile_id) : null)]));
  const resultByParticipant = new Map(((logged('results', resultsRes) ?? []) as { participant_id: string; score: number | null; payload: Record<string, unknown> | null }[]).map(r => [r.participant_id, r]));

  return contestRows.flatMap(c => {
    const comp = allowed.get(c.competition_id);
    const myEntryId = myEntryByContest.get(c.id);
    if (!comp || !myEntryId) return [];
    const outcome = deriveContestOutcome({
      format: comp.format,
      sportKey: comp.sport_key,
      scoringRule: comp.scoring_rule,
      status: c.status,
      stage: c.stage,
      slot: c.slot,
      roundName: c.round,
      participants: parts
        .filter(p => p.contest_id === c.id)
        .map(p => {
          const r = resultByParticipant.get(p.id);
          return { participantId: p.id, entryId: p.entry_id, side: p.side, startPosition: p.start_position, name: entryName.get(p.entry_id) ?? 'Entrant', score: r?.score === null || r?.score === undefined ? null : Number(r.score), payload: r?.payload ?? null };
        }),
    });
    return [{
      id: c.id,
      competitionName: comp.name,
      round: c.round,
      scheduledAt: c.scheduled_at,
      playFrom: c.play_from,
      status: c.status,
      eventId: c.event_id,
      sportEventRoundId: c.sport_event_round_id,
      myEntryId,
      outcome,
      href: input.links.contest(c.id, comp.org_id),
    }];
  });
}

// ── Sport events: the games the team plays a side of (sport_event_teams) ────
async function readEvents(admin: Admin, input: { orgId: string; teamId: string; mode: 'public' | 'member'; links: TeamScheduleLinks }): Promise<EventInput[]> {
  const mySides = (logged('event sides', await admin.from('sport_event_teams').select('sport_event_id, side').eq('team_id', input.teamId).limit(200)) ?? []) as { sport_event_id: string; side: 1 | 2 }[];
  if (mySides.length === 0) return [];
  const eventIds = mySides.map(s => s.sport_event_id);
  const [eventsRes, sidesRes, roundsRes] = await Promise.all([
    admin.from('sport_events').select('id, name, status, visibility, org_id, format_config').in('id', eventIds),
    admin.from('sport_event_teams').select('sport_event_id, side, team_id').in('sport_event_id', eventIds),
    admin.from('sport_event_rounds').select('id, sport_event_id, sequence, starts_at, scheduled_on, side1_score, side2_score, timezone').in('sport_event_id', eventIds).order('sequence', { ascending: true }),
  ]);
  const events = (logged('events', eventsRes) ?? []) as { id: string; name: string; status: string; visibility: string; org_id: string | null; format_config: { game?: { side_names?: string[] } } | null }[];
  const allSides = (logged('all sides', sidesRes) ?? []) as { sport_event_id: string; side: 1 | 2; team_id: string }[];
  const rounds = (logged('rounds', roundsRes) ?? []) as { id: string; sport_event_id: string; starts_at: string | null; scheduled_on: string | null; side1_score: number | null; side2_score: number | null; timezone: string | null }[];
  const otherTeamIds = [...new Set(allSides.filter(s => s.team_id !== input.teamId).map(s => s.team_id))];
  const { data: otherTeams } = otherTeamIds.length ? await admin.from('teams').select('id, name, display_name').in('id', otherTeamIds) : { data: [] };
  const teamName = new Map(((otherTeams ?? []) as { id: string; name: string; display_name: string | null }[]).map(t => [t.id, t.display_name || t.name]));
  const mySide = new Map(mySides.map(s => [s.sport_event_id, s.side]));

  return events
    .filter(e => e.visibility === 'public' || (input.mode === 'member' && e.org_id === input.orgId))
    .flatMap(e => {
      const side = mySide.get(e.id);
      if (!side) return [];
      const other: 1 | 2 = side === 1 ? 2 : 1;
      const otherTeam = allSides.find(s => s.sport_event_id === e.id && s.side === other);
      const eventRounds = rounds.filter(r => r.sport_event_id === e.id);
      const first = eventRounds[0];
      return [{
        id: e.id,
        name: e.name,
        status: e.status,
        startsAt: first?.starts_at ?? null,
        date: first?.scheduled_on ?? null,
        mySide: side,
        opponentName: (otherTeam ? teamName.get(otherTeam.team_id) : null) ?? e.format_config?.game?.side_names?.[other - 1] ?? null,
        side1Score: first?.side1_score ?? null,
        side2Score: first?.side2_score ?? null,
        roundIds: eventRounds.map(r => r.id),
        timezone: first?.timezone ?? null,
        href: input.links.event(e.id),
      }];
    });
}

/** The team row an org page reads (name, identity) — pinned to the org, active. */
export async function readTeamForPage(admin: Admin, orgId: string, teamId: string) {
  const { data } = await admin.from('teams').select('id, name, display_name, status, sport_key, primary_color, secondary_color, logo_path').eq('id', teamId).eq(ORG_ID, orgId).eq('status', 'active').maybeSingle();
  return data as { id: string; name: string; display_name: string | null; sport_key: string | null; primary_color: string | null; secondary_color: string | null; logo_path: string | null } | null;
}
