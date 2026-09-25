/**
 * The event view's pure projection (Events program, PR 4). One rule for
 * what leaves the server: the link token only to organizers, a name
 * through publicDisplayName (the contest rule — masked for a private or
 * supervised profile), never an email or a supervision state,
 * hide_from_profile only to its owner and the organizers.
 */
import { publicDisplayName, publicHandle, type MaskableProfile, isDeparted } from '@/lib/orgs/public-names';
import type { SportEventAccess } from './access';
import { readFormatConfig, readGameConfig, readMatchConfig } from './format-config';
import type { FormatConfig, MatchConfig } from './types';
import type { SportEventGroupMemberRow, SportEventGroupRow, SportEventParticipantRow, SportEventRoundRow, SportEventRow } from './types';
import { shapeOf } from './types';
import type { GameConfig, SportEventShape } from './types';
import { pairFieldsOf, type OrgKind } from '@/lib/orgs/org-ref';

export type ProfileForView = MaskableProfile & { id: string; handle?: string | null; avatar_url?: string | null };

export interface EventView {
  id: string;
  host_profile_id: string;
  club_id: string | null;
  league_id: string | null;
  sport_key: string;
  name: string;
  description: string | null;
  cover_path: string | null;
  join_mode: SportEventRow['join_mode'];
  visibility: SportEventRow['visibility'];
  /** Organizers only; null for everyone else. */
  link_token: string | null;
  format: SportEventRow['format'];
  /** 207 — the organizer's format options (the cut, the match shape), read tolerantly. */
  format_config: FormatConfig;
  /** Phase 3: the match options the event plays under (defaults filled) — null on a stroke format. */
  match: (MatchConfig & { allowance: number }) | null;
  /** Phase 4 (214): players enter their own; false = a recorder / organizer enters for everyone. */
  self_entry: boolean;
  /** Phase 4 (215): round (golf) | game | session. */
  shape: SportEventShape;
  /** Phase 4: a game's two sides (Home / Away by default); null off a game. */
  game: GameConfig | null;
  status: SportEventRow['status'];
  capacity: number | null;
  starts_on: string | null;
  opened_at: string | null;
  went_live_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParticipantView {
  id: string;
  profile_id: string;
  name: string;
  /** 238: the person left Edge Athlete — the name stands, nothing links. */
  departed: boolean;
  handle: string | null;
  avatar_url: string | null;
  role: SportEventParticipantRow['role'];
  status: SportEventParticipantRow['status'];
  playing: boolean;
  waitlist_position: number | null;
  handicap_index: number | null;
  handicap_source: SportEventParticipantRow['handicap_source'];
  /** The organizer's flight (phase 2), visible to everyone who sees the roster. */
  flight: string | null;
  /** Self and organizers only; null otherwise. */
  hide_from_profile: boolean | null;
  /** Phase 4 (214): a named recorder — visible to everyone who sees the roster. */
  recorder: boolean;
  accepted_at: string | null;
  created_at: string;
}

export interface ViewerView {
  profile_id: string | null;
  role: SportEventAccess['role'];
  can_manage: boolean;
  can_delete: boolean;
  participant_id: string | null;
  participant_status: SportEventAccess['participantStatus'];
  playing: boolean;
  hide_from_profile: boolean;
  /** Phase 2: how many waitlisted players are ahead of the viewer; null when not waitlisted. */
  waitlist_ahead: number | null;
  /** Phase 4: the viewer is a named recorder (an organizer always may record). */
  recorder: boolean;
}

export function projectEvent(row: SportEventRow, access: SportEventAccess): EventView {
  return {
    id: row.id,
    host_profile_id: row.host_profile_id,
    // The public contract keeps club_id / league_id — derived from the row's org_id + kind (Round 5 D0-b).
    ...pairFieldsOf(row),
    sport_key: row.sport_key,
    name: row.name,
    description: row.description,
    cover_path: row.cover_path,
    join_mode: row.join_mode,
    visibility: row.visibility,
    link_token: access.canManage ? row.link_token : null,
    format: row.format,
    format_config: readFormatConfig(row.format_config, 8, row.format, shapeOf(row)),
    match: readMatchConfig(readFormatConfig(row.format_config, 8, row.format, shapeOf(row)), row.format),
    self_entry: row.self_entry !== false,
    shape: shapeOf(row),
    game: readGameConfig(readFormatConfig(row.format_config, 8, row.format, shapeOf(row)), shapeOf(row)),
    status: row.status,
    capacity: row.capacity,
    starts_on: row.starts_on,
    opened_at: row.opened_at,
    went_live_at: row.went_live_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function projectParticipant(row: SportEventParticipantRow, profile: ProfileForView | null, viewer: { profileId: string | null; canManage: boolean }): ParticipantView {
  const self = viewer.profileId !== null && viewer.profileId === row.profile_id;
  return {
    id: row.id,
    profile_id: row.profile_id,
    name: profile ? publicDisplayName(profile) : 'Athlete',
    departed: profile ? isDeparted(profile) : false,
    handle: profile ? publicHandle(profile) : null,
    avatar_url: profile?.avatar_url ?? null,
    role: row.role,
    status: row.status,
    playing: row.playing,
    waitlist_position: row.waitlist_position,
    handicap_index: row.handicap_index,
    handicap_source: row.handicap_source,
    flight: row.flight ?? null,
    hide_from_profile: self || viewer.canManage ? row.hide_from_profile : null,
    recorder: row.recorder === true,
    accepted_at: row.accepted_at,
    created_at: row.created_at,
  };
}

/**
 * Rows a viewer may see: organizers see everyone; everyone else sees the
 * roster minus the declined / removed / withdrawn — and (phase 2) minus
 * OTHER people's waitlisted rows: a queue position is between the player
 * and the organizer; the count still rides on `counts.waitlisted`.
 */
export function visibleParticipants(rows: SportEventParticipantRow[], viewer: { profileId: string | null; canManage: boolean }): SportEventParticipantRow[] {
  if (viewer.canManage) return rows;
  return rows.filter(r => r.profile_id === viewer.profileId || (r.status !== 'declined' && r.status !== 'removed' && r.status !== 'withdrawn' && r.status !== 'waitlisted'));
}

export function projectViewer(viewerId: string | null, access: SportEventAccess, own: SportEventParticipantRow | null, rows: ReadonlyArray<SportEventParticipantRow> = []): ViewerView {
  const ahead = own && own.status === 'waitlisted'
    ? rows.filter(r => r.status === 'waitlisted' && r.id !== own.id && ((r.waitlist_position ?? Infinity) - (own.waitlist_position ?? Infinity) || r.created_at.localeCompare(own.created_at)) < 0).length
    : null;
  return {
    profile_id: viewerId,
    role: access.role,
    can_manage: access.canManage,
    can_delete: access.canDelete,
    participant_id: own?.id ?? null,
    participant_status: access.participantStatus,
    playing: own?.playing ?? false,
    hide_from_profile: own?.hide_from_profile ?? false,
    waitlist_ahead: ahead,
    recorder: own?.status === 'accepted' && own.recorder === true,
  };
}

export interface RoundView extends SportEventRoundRow {
  group_post_id: string | null;
}

export interface GroupView extends SportEventGroupRow {
  /** `side` (212): 1 | 2 on a match round, null otherwise. */
  members: Array<Pick<SportEventGroupMemberRow, 'id' | 'participant_id' | 'position'> & { side: 1 | 2 | null }>;
}

/** Phase 2b: the org the event is hosted for, by name. */
export interface HostOrgView {
  side: OrgKind;
  id: string;
  name: string;
}

/** Phase 2b (211): the competition the event counts toward and its contest per round. */
export interface CountsTowardView {
  competition_id: string;
  competition_name: string;
  contests: Array<{ round_id: string; contest_id: string }>;
}

/** The whole GET payload. */
export interface SportEventViewPayload {
  event: EventView;
  rounds: RoundView[];
  participants: ParticipantView[];
  groups: GroupView[];
  counts: { playing: number; followers: number; waitlisted: number };
  viewer: ViewerView;
  /** null when the event is the host's own. */
  host_org: HostOrgView | null;
  /** null when the event counts toward nothing (or pre-211). */
  counts_toward: CountsTowardView | null;
}

export function roundCounts(rows: SportEventParticipantRow[]): SportEventViewPayload['counts'] {
  return {
    playing: rows.filter(r => r.status === 'accepted' && r.playing).length,
    followers: rows.filter(r => r.role === 'follower' && r.status === 'accepted').length,
    waitlisted: rows.filter(r => r.status === 'waitlisted').length,
  };
}
