// Shared event read-gate — used by the detail route and the .ics download.
// Readable by the organizer and ANY guest row holder INCLUDING declined
// (deep links must let a declined guest change their mind), plus — fan-out
// round — any member of the org an event is attached to (org events are on
// the public org page, so members opening them reveals nothing new; the
// respond route is what turns a member into a real guest). Everyone else
// gets null → the caller responds 404, never revealing existence. No status
// filter anywhere: cancelled events stay openable (the cancel-notification
// deep link needs the banner, not a 404).

import type { SupabaseClient } from '@supabase/supabase-js';
import { getOrgRole } from '@/lib/affiliations/authz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export const EVENT_FIELDS =
  'id, organizer_id, title, description, location, starts_at, ends_at, all_day, timezone, category, status, cancelled_at, series_id, series_override, routine_id, routine_snapshot, league_id, club_id';

export interface CalendarEventRow {
  id: string;
  organizer_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  category: string;
  status: 'active' | 'cancelled';
  cancelled_at: string | null;
  series_id: string | null;
  series_override: boolean;
  routine_id: string | null;
  routine_snapshot: unknown;
  league_id?: string | null;
  club_id?: string | null;
  updated_at?: string;
}

export type ViewerAccess = 'organizer' | 'guest' | 'org_member';

export async function loadEventForViewer(
  admin: Admin,
  eventId: string,
  viewerId: string
): Promise<{ event: CalendarEventRow; access: ViewerAccess } | null> {
  const { data: event } = await admin
    .from('events')
    .select(`${EVENT_FIELDS}, updated_at`)
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return null;
  if (event.organizer_id === viewerId) {
    return { event: event as CalendarEventRow, access: 'organizer' };
  }
  const { data: myGuestRow } = await admin
    .from('event_guests')
    .select('id')
    .eq('event_id', eventId)
    .eq('profile_id', viewerId)
    .maybeSingle();
  if (myGuestRow) return { event: event as CalendarEventRow, access: 'guest' };

  if (event.league_id || event.club_id) {
    const side = event.league_id ? 'league' : 'club';
    const orgId = (event.league_id ?? event.club_id) as string;
    const { data: org } = await admin
      .from(side === 'league' ? 'leagues' : 'clubs')
      .select('owner_profile_id')
      .eq('id', orgId)
      .maybeSingle();
    const role = await getOrgRole(
      admin,
      side === 'league' ? 'league_members' : 'club_members',
      orgId,
      viewerId,
      (org?.owner_profile_id as string | null) ?? null
    );
    if (role) return { event: event as CalendarEventRow, access: 'org_member' };
  }
  return null;
}
