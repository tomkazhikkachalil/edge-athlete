import type { SupabaseClient } from '@supabase/supabase-js';

// Carpool access rule (Wave 9, mig 139): the caller participates when they
// hold an event_guests row themselves OR are a household member (guardian or
// view-only seat) of a guest — parents drive for kids' events without being
// invitees. Drivers and riders are always the CALLER's own profile
// (first-person: a real adult drives a real car); acting-as is deliberately
// absent here. Callers 404 outsiders — never reveal an event's existence.

export async function carpoolAccess(
  admin: SupabaseClient,
  eventId: string,
  userId: string
): Promise<boolean> {
  const { data: own } = await admin
    .from('event_guests')
    .select('id')
    .eq('event_id', eventId)
    .eq('profile_id', userId)
    .maybeSingle();
  if (own) return true;
  const { data: household } = await admin
    .from('profile_access')
    .select('profile_id')
    .eq('user_id', userId)
    .in('role', ['guardian', 'viewer']);
  const childIds = (household ?? []).map(r => r.profile_id);
  if (childIds.length === 0) return false;
  const { data: childGuest } = await admin
    .from('event_guests')
    .select('id')
    .eq('event_id', eventId)
    .in('profile_id', childIds)
    .limit(1)
    .maybeSingle();
  return !!childGuest;
}
