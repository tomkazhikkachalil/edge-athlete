// Shared event read-gate — used by the detail route and the .ics download.
// Readable by the organizer and ANY guest row holder INCLUDING declined
// (deep links must let a declined guest change their mind). Everyone else
// gets null → the caller responds 404, never revealing existence.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export const EVENT_FIELDS =
  'id, organizer_id, title, description, location, starts_at, ends_at, all_day, timezone, category, status, cancelled_at, series_id, series_override';

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
  updated_at?: string;
}

export async function loadEventForViewer(
  admin: Admin,
  eventId: string,
  viewerId: string
): Promise<CalendarEventRow | null> {
  const { data: event } = await admin
    .from('events')
    .select(`${EVENT_FIELDS}, updated_at`)
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return null;
  if (event.organizer_id !== viewerId) {
    const { data: myGuestRow } = await admin
      .from('event_guests')
      .select('id')
      .eq('event_id', eventId)
      .eq('profile_id', viewerId)
      .maybeSingle();
    if (!myGuestRow) return null;
  }
  return event as CalendarEventRow;
}
