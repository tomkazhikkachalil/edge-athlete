// ── An org's games — the READS (sports-team website program, G1, Sep 28 2026) ──
// Every game the org plays or runs in its PUBLIC fixture / bracket
// competitions (all divisions), as the division page reads them: home-first
// "Comets 2–3 Blazers" (`divisionSchedule` — there is no one side to read a
// W/L from at the org level), upcoming soonest first, results newest first.
// The site's Results page and (G2) its game-day sections read it. A window
// keeps it bounded (-60 … +60 days by the contest's time). "We run
// competitions" off ⇒ nothing. Never throws: a failed read is empty, logged.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID, type OrgKind } from '@/lib/orgs/org-ref';
import { switchesOf } from '@/lib/orgs/switches';
import { divisionSchedule, inGameWindow, type TeamScheduleItem } from './schedule';
import { CONTEST_FIELDS, resolveOutcomes, type CompetitionRow, type ContestRow } from './schedule-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG GAMES]';

export interface OrgGames {
  upcoming: TeamScheduleItem[];
  results: TeamScheduleItem[];
}

export async function fetchOrgGames(
  admin: Admin,
  input: { side: OrgKind; orgId: string; links: { contest: (contestId: string) => string | null } }
): Promise<OrgGames> {
  const empty: OrgGames = { upcoming: [], results: [] };
  try {
    const [orgRes, compsRes] = await Promise.all([
      admin.from('organizations').select('operates_competitions').eq('id', input.orgId).maybeSingle(),
      admin
        .from('competitions')
        .select('id, name, org_id, visibility, status, format, sport_key, scoring_rule')
        .eq(ORG_ID, input.orgId)
        .eq('visibility', 'public')
        .in('status', ['active', 'completed'])
        .in('format', ['fixture', 'bracket'])
        .limit(50),
    ]);
    if (!switchesOf(orgRes.data as { operates_competitions?: boolean } | null).competitions) return empty;
    const comps = (compsRes.data ?? []) as CompetitionRow[];
    if (comps.length === 0) return empty;
    const compById = new Map(comps.map(c => [c.id, c]));
    const { data: contestData, error } = await admin.from('contests').select(CONTEST_FIELDS).in('competition_id', comps.map(c => c.id)).limit(500);
    if (error) {
      console.error(`${TAG} contests read failed:`, error);
      return empty;
    }
    const nowMs = Date.now();
    const contestRows = ((contestData ?? []) as ContestRow[]).filter(c => inGameWindow(c.scheduled_at ?? c.play_from, nowMs));
    const outcomes = await resolveOutcomes(admin, contestRows, compById);
    return divisionSchedule({
      calendar: [],
      contests: contestRows.flatMap(c => {
        const comp = compById.get(c.competition_id);
        const outcome = outcomes.get(c.id);
        return comp && outcome
          ? [{ id: c.id, competitionName: comp.name, round: c.round, scheduledAt: c.scheduled_at, playFrom: c.play_from, status: c.status, eventId: c.event_id, outcome, href: input.links.contest(c.id) }]
          : [];
      }),
    });
  } catch (e) {
    console.error(`${TAG} failed:`, e);
    return empty;
  }
}
