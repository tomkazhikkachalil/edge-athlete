/**
 * The event GET — the I/O half (Events program, PR 4). One reader for the
 * event place and every tab: the gate, then the rows, then the pure
 * projection (./view). Names come through publicDisplayName; nothing
 * private leaves.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { readSportEventAccess } from './access-server';
import { ROUND_COLUMNS } from './rounds-server';
import type { SportEventGroupMemberRow, SportEventGroupRow, SportEventParticipantRow, SportEventRoundRow } from './types';
import { projectEvent, projectParticipant, projectViewer, roundCounts, visibleParticipants, type CountsTowardView, type GroupView, type HostOrgView, type ProfileForView, type RoundView, type SportEventViewPayload } from './view';
import { eventOrg } from './contest-link';
import { readCountsToward } from './contest-link-server';
import { readRoster } from './join-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export async function fetchSportEventView(admin: Admin, eventId: string, viewerId: string | null, presentedToken: string | null): Promise<SportEventViewPayload | null> {
  const read = await readSportEventAccess(admin, eventId, viewerId, presentedToken);
  if (!read) return null;
  const { event, access, participant } = read;

  const [roster, roundsRes] = await Promise.all([
    readRoster(admin, eventId),
    admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('sport_event_id', eventId).order('sequence', { ascending: true }),
  ]);
  const rounds = (roundsRes.data ?? []) as SportEventRoundRow[];
  const roundIds = rounds.map(r => r.id);

  const [profilesRes, groupsRes, membersRes, groupPostsRes] = await Promise.all([
    roster.length > 0
      ? admin.from('profiles').select('id, first_name, last_name, full_name, visibility, email, supervision_state, handle, avatar_url').in('id', roster.map(r => r.profile_id))
      : Promise.resolve({ data: [] as ProfileForView[] }),
    roundIds.length > 0
      ? admin.from('sport_event_groups').select('id, sport_event_round_id, sequence, name, tee_time, starting_hole, created_at, updated_at').in('sport_event_round_id', roundIds).order('sequence', { ascending: true })
      : Promise.resolve({ data: [] as SportEventGroupRow[] }),
    roundIds.length > 0
      ? admin.from('sport_event_group_members').select('id, group_id, sport_event_round_id, participant_id, position, created_at').in('sport_event_round_id', roundIds).order('position', { ascending: true })
      : Promise.resolve({ data: [] as SportEventGroupMemberRow[] }),
    roundIds.length > 0
      ? admin.from('group_posts').select('id, sport_event_round_id').in('sport_event_round_id', roundIds)
      : Promise.resolve({ data: [] as Array<{ id: string; sport_event_round_id: string }> }),
  ]);

  const profileById = new Map<string, ProfileForView>();
  for (const p of (profilesRes.data ?? []) as ProfileForView[]) profileById.set(p.id, p);
  const viewer = { profileId: viewerId, canManage: access.canManage };
  const participants = visibleParticipants(roster, viewer).map(r => projectParticipant(r, profileById.get(r.profile_id) ?? null, viewer));

  const groupPostByRound = new Map<string, string>();
  for (const gp of (groupPostsRes.data ?? []) as Array<{ id: string; sport_event_round_id: string }>) groupPostByRound.set(gp.sport_event_round_id, gp.id);
  const roundViews: RoundView[] = rounds.map(r => ({ ...r, group_post_id: groupPostByRound.get(r.id) ?? null }));

  // Phase 2b: the host org by name and what the event counts toward (tolerant pre-211).
  const org = eventOrg(event);
  const [orgRes, countsToward] = await Promise.all([
    org ? admin.from(org.side === 'club' ? 'clubs' : 'leagues').select('id, name').eq('id', org.id).maybeSingle() : Promise.resolve({ data: null }),
    org && roundIds.length > 0 ? readCountsToward(admin, roundIds) : Promise.resolve(null),
  ]);
  const host_org: HostOrgView | null = org && orgRes.data ? { side: org.side, id: org.id, name: (orgRes.data as { name: string }).name } : null;
  let counts_toward: CountsTowardView | null = null;
  if (countsToward && countsToward.size > 0) {
    const first = [...countsToward.values()][0];
    counts_toward = { competition_id: first.competitionId, competition_name: first.competitionName, contests: [...countsToward.entries()].map(([round_id, c]) => ({ round_id, contest_id: c.contestId })) };
  }

  const members = (membersRes.data ?? []) as SportEventGroupMemberRow[];
  const groups: GroupView[] = ((groupsRes.data ?? []) as SportEventGroupRow[]).map(g => ({
    ...g,
    members: members.filter(m => m.group_id === g.id).map(m => ({ id: m.id, participant_id: m.participant_id, position: m.position })),
  }));

  return {
    event: projectEvent(event, access),
    rounds: roundViews,
    participants,
    groups,
    counts: roundCounts(roster as SportEventParticipantRow[]),
    viewer: projectViewer(viewerId, access, participant, roster as SportEventParticipantRow[]),
    host_org,
    counts_toward,
  };
}
