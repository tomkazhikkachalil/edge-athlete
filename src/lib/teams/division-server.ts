// ── A division's page — the READS (teams & divisions program, PR 9) ─────────
// One division of an org: its header (season, sport, age band, tier), the
// teams entered in it, the standings of the competitions pinned to it, and
// its schedule (division-scoped calendar events + those competitions'
// contests, home-first "Comets 2–3 Blazers"). The public site and the
// in-app page both read it:
//   • 'public' — public competitions only (the org's own privacy is the
//     caller's gate: a private org's page renders the members-only panel);
//   • 'member' — the org's private competitions too.
// Never throws: a failed read is an empty part, logged.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, type OrgKind } from '@/lib/orgs/org-ref';
import { switchesOf } from '@/lib/orgs/switches';
import { fetchPublicStandings, type PublicCompetitionStandings } from '@/lib/competitions/public-standings';
import { teamLogoUrl } from './logo-url';
import { divisionSchedule, type CalendarInput, type TeamScheduleItem } from './schedule';
import { CONTEST_FIELDS, resolveOutcomes, type CompetitionRow, type ContestRow } from './schedule-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[DIVISION VIEW]';

export interface DivisionView {
  division: { id: string; name: string; seasonLabel: string | null; sportKey: string; ageBand: string | null; genderStream: string | null; tier: string | null };
  teams: { id: string; name: string; logoUrl: string | null; primaryColor: string | null; secondaryColor: string | null }[];
  standings: PublicCompetitionStandings[];
  schedule: { upcoming: TeamScheduleItem[]; results: TeamScheduleItem[] };
}

export async function fetchDivisionView(
  admin: Admin,
  input: { side: OrgKind; orgId: string; divisionId: string; mode: 'public' | 'member'; links: { contest: (contestId: string) => string | null } }
): Promise<DivisionView | null> {
  try {
    const { data: division } = await admin
      .from('divisions')
      .select('id, name, season_id, sport_key, age_band, gender_stream, tier')
      .eq('id', input.divisionId)
      .eq(ORG_ID, input.orgId)
      .maybeSingle();
    if (!division) return null;
    const d = division as { id: string; name: string; season_id: string; sport_key: string; age_band: string | null; gender_stream: string | null; tier: string | null };

    const [seasonRes, entriesRes, orgRes, calendarRes, compsRes] = await Promise.all([
      admin.from('seasons').select('label').eq('id', d.season_id).maybeSingle(),
      admin.from('team_entries').select('team_id').eq('division_id', d.id).limit(200),
      admin.from('organizations').select('operates_competitions').eq('id', input.orgId).maybeSingle(),
      admin
        .from('events')
        .select('id, title, starts_at, all_day, timezone, location, status')
        .eq('division_id', d.id)
        .eq('status', 'active')
        .gte('starts_at', new Date(Date.now() - 86_400_000).toISOString())
        .order('starts_at', { ascending: true })
        .limit(20),
      admin
        .from('competitions')
        .select('id, name, org_id, visibility, status, format, sport_key, scoring_rule')
        .eq(ORG_ID, input.orgId)
        .eq('division_id', d.id)
        .in('status', ['active', 'completed'])
        .limit(20),
    ]);

    const teamIds = [...new Set(((entriesRes.data ?? []) as { team_id: string }[]).map(e => e.team_id))];
    const { data: teamRows } = teamIds.length
      ? await admin.from('teams').select('id, name, display_name, primary_color, secondary_color, logo_path').in('id', teamIds).eq('status', 'active')
      : { data: [] };
    const teams = ((teamRows ?? []) as { id: string; name: string; display_name: string | null; primary_color: string | null; secondary_color: string | null; logo_path: string | null }[])
      .map(t => ({ id: t.id, name: t.display_name || t.name, logoUrl: teamLogoUrl(t.id, t.logo_path), primaryColor: t.primary_color, secondaryColor: t.secondary_color }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const competitionsOn = switchesOf(orgRes.data as { operates_competitions?: boolean } | null).competitions;
    const comps = competitionsOn
      ? ((compsRes.data ?? []) as CompetitionRow[]).filter(c => (c.format === 'fixture' || c.format === 'bracket') && (input.mode === 'member' || c.visibility === 'public'))
      : [];
    const compById = new Map(comps.map(c => [c.id, c]));
    const { data: contestData } = comps.length
      ? await admin.from('contests').select(CONTEST_FIELDS).in('competition_id', comps.map(c => c.id)).limit(300)
      : { data: [] };
    const contestRows = (contestData ?? []) as ContestRow[];
    const outcomes = await resolveOutcomes(admin, contestRows, compById);

    const [standings, schedule] = await Promise.all([
      competitionsOn
        ? fetchPublicStandings(admin, input.side, input.orgId, { divisionId: d.id, membersView: input.mode === 'member' }).then(p => p?.competitions ?? [])
        : Promise.resolve([]),
      Promise.resolve(
        divisionSchedule({
          calendar: ((calendarRes.data ?? []) as Omit<CalendarInput, 'href'>[]).map(e => ({ ...e, href: null })),
          contests: contestRows.flatMap(c => {
            const comp = compById.get(c.competition_id);
            const outcome = outcomes.get(c.id);
            return comp && outcome
              ? [{ id: c.id, competitionName: comp.name, round: c.round, scheduledAt: c.scheduled_at, playFrom: c.play_from, status: c.status, eventId: c.event_id, outcome, href: input.links.contest(c.id) }]
              : [];
          }),
        })
      ),
    ]);

    return {
      division: { id: d.id, name: d.name, seasonLabel: (seasonRes.data as { label?: string } | null)?.label ?? null, sportKey: d.sport_key, ageBand: d.age_band, genderStream: d.gender_stream, tier: d.tier },
      teams,
      standings,
      schedule,
    };
  } catch (e) {
    console.error(`${TAG} failed:`, e);
    return null;
  }
}
