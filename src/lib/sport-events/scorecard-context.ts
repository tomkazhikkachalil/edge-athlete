/**
 * The event context a round's scorecard carries (Events program, PR 5): the
 * scorecard GET answers `sport_event: {…} | null` so the live page can
 * mount the group card and link back to the event. Read on the admin
 * client AFTER the round's own gate admitted the viewer.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { EVENT_COLUMNS } from './access-server';
import { readFormatConfig, readMatchConfig } from './format-config';
import { fetchRoundMatches, type RoundGroup } from './match-server';
import { projectMatch, sideOfViewer, type MatchView } from './match-view';
import { ROUND_COLUMNS } from './rounds-server';
import type { MatchSides, SportEventRoundRow, SportEventRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

/** Phase 3: the viewer's group's MATCH — its computed state, the intent and the version, plus the viewer's side and the event's match options. */
export interface ScorecardMatchContext extends MatchView {
  config: { sides: MatchSides; bracket: boolean; allowance: number };
  side_of_viewer: 1 | 2 | null;
}

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
  /** Phase 4 (214): the viewer may enter for everyone — a named recorder, or an organizer. */
  viewer_recorder: boolean;
  /** Phase 4: players enter their own (false = the recorder's screen is the only entry). */
  self_entry: boolean;
  /** Phase 4: every group of the round (a recorder / organizer switches between them). */
  groups: Array<{ id: string; name: string | null; sequence: number; starting_hole: number; tee_time: string | null; members: Array<{ participant_id: string; profile_id: string; position: number; side: 1 | 2 | null }> }>;
  group: {
    id: string;
    name: string | null;
    sequence: number;
    starting_hole: number;
    tee_time: string | null;
    members: Array<{ participant_id: string; profile_id: string; position: number; side: 1 | 2 | null }>;
  } | null;
  /** Phase 3 (212): the viewer's match on a match-format round; null on a stroke round or outside a group. */
  match: ScorecardMatchContext | null;
}

export async function readScorecardEventContext(admin: Admin, sportEventRoundId: string, viewerProfileId: string | null): Promise<ScorecardEventContext | null> {
  const { data: roundRow } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('id', sportEventRoundId).maybeSingle();
  if (!roundRow) return null;
  const round = roundRow as unknown as SportEventRoundRow;
  const { data: eventRow } = await admin.from('sport_events').select(EVENT_COLUMNS).eq('id', round.sport_event_id).maybeSingle();
  if (!eventRow) return null;
  const event = eventRow as SportEventRow;

  let viewerRole: string | null = null;
  let viewerParticipantId: string | null = null;
  let viewerRecorder = false;
  if (viewerProfileId) {
    const { data: own } = await admin.from('sport_event_participants').select('id, role, status, recorder').eq('sport_event_id', event.id).eq('profile_id', viewerProfileId).maybeSingle();
    if (own && own.status !== 'declined' && own.status !== 'removed') {
      viewerRole = own.role as string;
      viewerParticipantId = own.id as string;
      viewerRecorder = own.status === 'accepted' && (own as { recorder?: boolean }).recorder === true;
    }
    if (event.host_profile_id === viewerProfileId) viewerRole = 'organizer';
    if (viewerRole === 'organizer' || viewerRole === 'co_organizer') viewerRecorder = true;
  }

  // Phase 4: every group of the round with its members' profiles (the recorder's switcher).
  const [{ data: allGroups }, { data: allMembers }] = await Promise.all([
    admin.from('sport_event_groups').select('id, name, sequence, starting_hole, tee_time').eq('sport_event_round_id', round.id).order('sequence', { ascending: true }),
    admin.from('sport_event_group_members').select('group_id, participant_id, position, side, participant:sport_event_participants (profile_id)').eq('sport_event_round_id', round.id).order('position', { ascending: true }),
  ]);
  const memberRows = ((allMembers ?? []) as Array<{ group_id: string; participant_id: string; position: number; side: number | null; participant: { profile_id: string } | { profile_id: string }[] | null }>).map(m => ({ group_id: m.group_id, participant_id: m.participant_id, position: m.position, side: (m.side === 1 || m.side === 2 ? m.side : null) as 1 | 2 | null, profile_id: (Array.isArray(m.participant) ? m.participant[0]?.profile_id : m.participant?.profile_id) ?? '' }));
  const groups: ScorecardEventContext['groups'] = ((allGroups ?? []) as Array<{ id: string; name: string | null; sequence: number; starting_hole: number; tee_time: string | null }>).map(g => ({ id: g.id, name: g.name, sequence: g.sequence, starting_hole: g.starting_hole, tee_time: g.tee_time, members: memberRows.filter(m => m.group_id === g.id).map(m => ({ participant_id: m.participant_id, profile_id: m.profile_id, position: m.position, side: m.side })) }));

  let group: ScorecardEventContext['group'] = null;
  let match: ScorecardMatchContext | null = null;
  if (viewerParticipantId) {
    const { data: membership } = await admin.from('sport_event_group_members').select('group_id').eq('sport_event_round_id', round.id).eq('participant_id', viewerParticipantId).maybeSingle();
    if (membership?.group_id) {
      const [{ data: g }, { data: members }] = await Promise.all([
        admin.from('sport_event_groups').select('id, name, sequence, starting_hole, tee_time').eq('id', membership.group_id).maybeSingle(),
        admin.from('sport_event_group_members').select('participant_id, position, side, participant:sport_event_participants (profile_id)').eq('group_id', membership.group_id).order('position', { ascending: true }),
      ]);
      if (g) {
        group = {
          id: g.id as string,
          name: (g.name as string | null) ?? null,
          sequence: g.sequence as number,
          starting_hole: g.starting_hole as number,
          tee_time: (g.tee_time as string | null) ?? null,
          members: ((members ?? []) as Array<{ participant_id: string; position: number; side: number | null; participant: { profile_id: string } | { profile_id: string }[] | null }>).map(m => ({
            participant_id: m.participant_id,
            profile_id: (Array.isArray(m.participant) ? m.participant[0]?.profile_id : m.participant?.profile_id) ?? '',
            position: m.position,
            side: m.side === 1 || m.side === 2 ? m.side : null,
          })),
        };
        // Phase 3: the group's match, computed on read (one group → one computation).
        const config = readMatchConfig(readFormatConfig(event.format_config, 8, event.format), event.format);
        if (config) {
          const rg: RoundGroup = { id: group.id, sequence: group.sequence, name: group.name, starting_hole: group.starting_hole, tee_time: group.tee_time, members: group.members.map(m => ({ participant_id: m.participant_id, position: m.position, side: m.side })) };
          const [found] = await fetchRoundMatches(admin, event, round, { groups: [rg] });
          if (found) {
            const view = projectMatch(found);
            match = { ...view, config, side_of_viewer: sideOfViewer(view, viewerProfileId) };
          }
        }
      }
    }
  }

  return {
    id: event.id,
    name: event.name,
    status: event.status,
    format: event.format,
    round_id: round.id,
    round_sequence: round.sequence,
    holes: round.holes,
    starting_hole: round.starting_hole,
    viewer_role: viewerRole,
    viewer_participant_id: viewerParticipantId,
    viewer_recorder: viewerRecorder,
    self_entry: event.self_entry !== false,
    groups,
    group,
    match,
  };
}
