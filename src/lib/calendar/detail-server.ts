// Shared event read-gate — used by the detail route and the .ics download.
// Readable by the organizer and ANY guest row holder INCLUDING declined
// (deep links must let a declined guest change their mind), plus — fan-out
// round — any member of the org an event is attached to (org events are on
// the public org page, so members opening them reveals nothing new; the
// respond route is what turns a member into a real guest), plus — calendar
// guardian-parity round — HOUSEHOLD members: a guardian or view-only seat
// of a profile that is a guest (or, for org events, an org member) reads
// the event too, so co-guardian bell deep links Just Work with no person
// context (the carpoolAccess precedent). Household access is READ-ONLY by
// construction: PATCH/DELETE hard-check organizer_id after loading, and the
// modal's RSVP/edit affordances key off own guest row / organizer. The
// household branch runs LAST so a guardian who is also an org member keeps
// 'org_member' (and its first-response RSVP affordance). Everyone else
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

export type ViewerAccess = 'organizer' | 'guest' | 'org_member' | 'household';

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

  if (await householdReadAccess(admin, event as CalendarEventRow, viewerId)) {
    return { event: event as CalendarEventRow, access: 'household' };
  }
  return null;
}

/**
 * True when a profile the viewer holds a guardian/viewer seat on can see
 * this event — as a guest, or (org events) as a member/owner of the org.
 * The org leg matters because a child's org-merged events reach the
 * guardian's list read with no guest row at all; without it they would
 * 404 on detail.
 */
async function householdReadAccess(
  admin: Admin,
  event: CalendarEventRow,
  viewerId: string
): Promise<boolean> {
  const { data: seats } = await admin
    .from('profile_access')
    .select('profile_id')
    .eq('user_id', viewerId)
    .in('role', ['guardian', 'viewer']);
  const childIds = (seats ?? []).map(r => r.profile_id as string);
  if (childIds.length === 0) return false;

  const { data: childGuest } = await admin
    .from('event_guests')
    .select('id')
    .eq('event_id', event.id)
    .in('profile_id', childIds)
    .limit(1)
    .maybeSingle();
  if (childGuest) return true;

  if (event.league_id || event.club_id) {
    const side = event.league_id ? 'league' : 'club';
    const orgId = (event.league_id ?? event.club_id) as string;
    const { data: org } = await admin
      .from(side === 'league' ? 'leagues' : 'clubs')
      .select('owner_profile_id')
      .eq('id', orgId)
      .maybeSingle();
    if (org?.owner_profile_id && childIds.includes(org.owner_profile_id as string)) return true;
    const { data: childMember } = await admin
      .from(side === 'league' ? 'league_members' : 'club_members')
      .select('profile_id')
      .eq(side === 'league' ? 'league_id' : 'club_id', orgId)
      .in('profile_id', childIds)
      .limit(1)
      .maybeSingle();
    if (childMember) return true;
  }
  return false;
}
