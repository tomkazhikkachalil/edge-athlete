// ── sport_event_teams — THE ONE WRITER (teams & divisions program, PR 7) ─────
// Which org team plays each side of a sport event (migration 242: one row per
// (event, side), UNIQUE (event, team), an index on the team). A team's
// schedule finds its games through this table — format_config.game.
// side_team_ids is jsonb and cannot be indexed, and the contest door's games
// never wrote it. Called by the event create route (the wizard's two team
// picks) and the contest → event door (a fixture's team entries).
// BEST-EFFORT: the event is the deliverable; a failed link is logged and the
// team's schedule simply misses that game (242's backfill shape heals it).

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface EventTeamSide {
  side: 1 | 2;
  teamId: string | null;
}

export async function linkEventTeams(admin: Admin, eventId: string, sides: readonly EventTeamSide[]): Promise<void> {
  const rows = sides.filter((s): s is { side: 1 | 2; teamId: string } => !!s.teamId).map(s => ({ sport_event_id: eventId, side: s.side, team_id: s.teamId }));
  // The same team on both sides is not a game between two teams.
  if (rows.length === 0 || (rows.length === 2 && rows[0].team_id === rows[1].team_id)) return;
  const { error } = await admin.from('sport_event_teams').upsert(rows, { onConflict: 'sport_event_id,side', ignoreDuplicates: true });
  if (error) console.error('[SPORT EVENT TEAMS] link failed:', error);
}
