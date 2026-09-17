/**
 * The sides pre-filled from an org's TEAMS (Events + formats leftovers,
 * PR 5) — the organizer's field: every roster member of each team becomes
 * an accepted, playing participant (never `planJoin` — capacity and the
 * waitlist are the organizer's to exceed), and ONE group per round carries
 * the sides SENT (a game's groups are never derived). Shared by the create
 * route (the wizard's two team picks) and the contest → event door (a
 * fixture's team entries). A player on both rosters plays HOME
 * (`splitSides`); the host keeps their row (playing only as a member).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { splitSides } from './game';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[side-prefill]';

export interface OrgRef {
  col: 'league_id' | 'club_id';
  id: string;
}

/** A team's roster under the org: the team-scope roster rows, active or placed. */
export async function teamRosterMembers(admin: Admin, org: OrgRef, teamId: string): Promise<string[]> {
  const { data } = await admin.from('memberships').select('profile_id').eq(org.col, org.id).eq('kind', 'roster').eq('scope_type', 'team').eq('scope_id', teamId).in('status', ['active', 'placed']);
  return [...new Set(((data ?? []) as Array<{ profile_id: string }>).map(r => r.profile_id))];
}

export interface PrefillInput {
  eventId: string;
  hostProfileId: string;
  rounds: Array<{ id: string; starts_at?: string | null }>;
  /** The two sides' players (home first); a player on both plays home. */
  sides: [string[], string[]];
  groupName: string;
}

/** Every side member accepted + playing; ONE group per round (skipped when the round already has one) with the sides sent. */
export async function prefillSidesFromTeams(admin: Admin, input: PrefillInput): Promise<{ participants: number; groups: number } | { error: string }> {
  const [home, away] = splitSides(input.sides[0], input.sides[1]);
  const members = [...new Set([...home, ...away])];
  const now = new Date().toISOString();
  const { data: existing } = await admin.from('sport_event_participants').select('id, profile_id, playing, status').eq('sport_event_id', input.eventId);
  const rows = (existing ?? []) as Array<{ id: string; profile_id: string; playing: boolean; status: string }>;
  const have = new Map(rows.map(r => [r.profile_id, r]));
  const missing = members.filter(p => !have.has(p));
  let inserted = 0;
  if (missing.length > 0) {
    const { data: made, error } = await admin
      .from('sport_event_participants')
      .insert(missing.map(profile_id => ({ sport_event_id: input.eventId, profile_id, role: 'participant', status: 'accepted', playing: true, accepted_at: now, responded_at: now })))
      .select('id, profile_id');
    if (error) { console.error(`${TAG} participants insert failed:`, error); return { error: 'Could not add the players' }; }
    for (const p of (made ?? []) as Array<{ id: string; profile_id: string }>) have.set(p.profile_id, { id: p.id, profile_id: p.profile_id, playing: true, status: 'accepted' });
    inserted = (made ?? []).length;
  }
  // The host is a member: they play (their row stays an organizer's).
  const host = have.get(input.hostProfileId);
  if (host && members.includes(input.hostProfileId) && !host.playing) await admin.from('sport_event_participants').update({ playing: true }).eq('id', host.id);

  let groups = 0;
  for (const round of input.rounds) {
    const { data: present } = await admin.from('sport_event_groups').select('id').eq('sport_event_round_id', round.id).limit(1);
    if ((present ?? []).length > 0) continue;
    const { data: group, error } = await admin.from('sport_event_groups').insert({ sport_event_round_id: round.id, sequence: 1, name: input.groupName, starting_hole: 1, tee_time: round.starts_at ?? null }).select('id').single();
    if (error || !group) { console.error(`${TAG} group insert failed:`, error); continue; }
    const memberRows = [...home.map(p => ({ profile_id: p, side: 1 })), ...away.map(p => ({ profile_id: p, side: 2 }))]
      .map((m, i) => ({ group_id: (group as { id: string }).id, sport_event_round_id: round.id, participant_id: have.get(m.profile_id)?.id as string, position: i + 1, side: m.side }))
      .filter(m => !!m.participant_id);
    if (memberRows.length > 0) {
      const { error: memberError } = await admin.from('sport_event_group_members').insert(memberRows);
      if (memberError) console.error(`${TAG} group members insert failed:`, memberError);
    }
    groups += 1;
  }
  return { participants: inserted, groups };
}
