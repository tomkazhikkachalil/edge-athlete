/**
 * The I/O half of the one gate (Events program, PR 4): read the event and
 * the viewer's participant row on the admin client (posture A — the app
 * gate IS the authorization), then resolveSportEventAccess. A miss of any
 * kind is null → the route answers the same 404 as not-found.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveSportEventAccess, type SportEventAccess } from './access';
import type { SportEventParticipantRow, SportEventRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

/** 207's `format_config` rides here since PR 8 (phase 2) — every gate read selects it; the column MUST exist (a missing column 404s the API). */
export const EVENT_COLUMNS =
  'id, host_profile_id, created_by_user_id, club_id, league_id, sport_key, name, description, cover_path, join_mode, visibility, link_token, format, status, capacity, format_config, self_entry, starts_on, opened_at, went_live_at, completed_at, cancelled_at, created_at, updated_at';

export const PARTICIPANT_COLUMNS =
  'id, sport_event_id, profile_id, role, status, playing, handicap_index, handicap_source, flight, waitlist_position, hide_from_profile, recorder, invited_by, accepted_at, responded_at, created_at, updated_at';

export interface AccessRead {
  event: SportEventRow;
  participant: SportEventParticipantRow | null;
  access: SportEventAccess;
}

export async function readSportEventAccess(admin: Admin, eventId: string, viewerId: string | null, presentedToken: string | null): Promise<AccessRead | null> {
  const { data: event, error } = await admin.from('sport_events').select(EVENT_COLUMNS).eq('id', eventId).maybeSingle();
  if (error) {
    console.error('[sport-events] event read failed:', error);
    return null;
  }
  if (!event) return null;
  let participant: SportEventParticipantRow | null = null;
  if (viewerId) {
    const { data } = await admin.from('sport_event_participants').select(PARTICIPANT_COLUMNS).eq('sport_event_id', eventId).eq('profile_id', viewerId).maybeSingle();
    participant = (data as SportEventParticipantRow | null) ?? null;
  }
  const row = event as SportEventRow;
  const access = resolveSportEventAccess({
    event: { hostProfileId: row.host_profile_id, visibility: row.visibility, status: row.status, linkToken: row.link_token },
    viewerId,
    presentedToken,
    participant: participant ? { role: participant.role, status: participant.status } : null,
  });
  if (!access) return null;
  return { event: row, participant, access };
}
