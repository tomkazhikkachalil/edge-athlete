/**
 * The event context a round's scorecard carries (Events program, PR 5): the
 * scorecard GET answers `sport_event: {…} | null` so the live page can
 * mount the group card and link back to the event. Read on the admin
 * client AFTER the round's own gate admitted the viewer.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface ScorecardEventContext {
  id: string;
  name: string;
  status: string;
  format: string;
  round_id: string;
  round_sequence: number;
  holes: number;
  starting_hole: number;
  viewer_role: string | null;
  viewer_participant_id: string | null;
  group: {
    id: string;
    name: string | null;
    sequence: number;
    starting_hole: number;
    tee_time: string | null;
    members: Array<{ participant_id: string; profile_id: string; position: number }>;
  } | null;
}

export async function readScorecardEventContext(admin: Admin, sportEventRoundId: string, viewerProfileId: string | null): Promise<ScorecardEventContext | null> {
  const { data: round } = await admin.from('sport_event_rounds').select('id, sport_event_id, sequence, holes, starting_hole').eq('id', sportEventRoundId).maybeSingle();
  if (!round) return null;
  const { data: event } = await admin.from('sport_events').select('id, name, status, format, host_profile_id').eq('id', round.sport_event_id).maybeSingle();
  if (!event) return null;

  let viewerRole: string | null = null;
  let viewerParticipantId: string | null = null;
  if (viewerProfileId) {
    const { data: own } = await admin.from('sport_event_participants').select('id, role, status').eq('sport_event_id', event.id).eq('profile_id', viewerProfileId).maybeSingle();
    if (own && own.status !== 'declined' && own.status !== 'removed') {
      viewerRole = own.role as string;
      viewerParticipantId = own.id as string;
    }
    if (event.host_profile_id === viewerProfileId) viewerRole = 'organizer';
  }

  let group: ScorecardEventContext['group'] = null;
  if (viewerParticipantId) {
    const { data: membership } = await admin.from('sport_event_group_members').select('group_id').eq('sport_event_round_id', round.id).eq('participant_id', viewerParticipantId).maybeSingle();
    if (membership?.group_id) {
      const [{ data: g }, { data: members }] = await Promise.all([
        admin.from('sport_event_groups').select('id, name, sequence, starting_hole, tee_time').eq('id', membership.group_id).maybeSingle(),
        admin.from('sport_event_group_members').select('participant_id, position, participant:sport_event_participants (profile_id)').eq('group_id', membership.group_id).order('position', { ascending: true }),
      ]);
      if (g) {
        group = {
          id: g.id as string,
          name: (g.name as string | null) ?? null,
          sequence: g.sequence as number,
          starting_hole: g.starting_hole as number,
          tee_time: (g.tee_time as string | null) ?? null,
          members: ((members ?? []) as Array<{ participant_id: string; position: number; participant: { profile_id: string } | { profile_id: string }[] | null }>).map(m => ({
            participant_id: m.participant_id,
            profile_id: (Array.isArray(m.participant) ? m.participant[0]?.profile_id : m.participant?.profile_id) ?? '',
            position: m.position,
          })),
        };
      }
    }
  }

  return {
    id: event.id as string,
    name: event.name as string,
    status: event.status as string,
    format: event.format as string,
    round_id: round.id as string,
    round_sequence: round.sequence as number,
    holes: round.holes as number,
    starting_hole: round.starting_hole as number,
    viewer_role: viewerRole,
    viewer_participant_id: viewerParticipantId,
    group,
  };
}
