/**
 * Who a ticket's emails go to (Spec 1) — server-only.
 *
 * The submitter's email at submit time, else the guest's; a SUPERVISED
 * submitter's synthetic `@minors.invalid` address never renders and never
 * receives — their ticket mails the guardian(s), resolved at send time
 * through the digest's query (Tom's rule: "Minor profiles have no email.
 * Their tickets email the parent account"). Zero deliverable recipients is
 * logged loudly, never silent — a child whose ticket reaches no adult is
 * something an operator needs to see.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSyntheticEmail } from '@/lib/config/minors-config';
import type { TicketRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the admin client is untyped app-wide
type Admin = SupabaseClient<any, 'public', any>;

export async function recipientsFor(admin: Admin, ticket: Pick<TicketRow, 'id' | 'reporter_profile_id' | 'reporter_email' | 'guest_email'>): Promise<string[]> {
  if (ticket.reporter_email && !isSyntheticEmail(ticket.reporter_email)) return [ticket.reporter_email];
  if (ticket.guest_email) return [ticket.guest_email];
  if (!ticket.reporter_profile_id) return [];

  const { data: guardianRows, error } = await admin
    .from('profile_access')
    .select('profiles!profile_access_user_id_fkey(email)')
    .eq('profile_id', ticket.reporter_profile_id)
    .eq('role', 'guardian');
  if (error) {
    console.error('[tickets mail] guardian lookup failed:', error.message);
    return [];
  }
  const emails = (guardianRows ?? [])
    .map(r => {
      const raw = (r as { profiles: unknown }).profiles;
      return (Array.isArray(raw) ? raw[0] : raw) as { email: string | null } | null;
    })
    .map(p => p?.email)
    .filter((e): e is string => !!e && !isSyntheticEmail(e));
  if (emails.length === 0) {
    console.warn('[tickets mail] ticket has NO deliverable recipient (supervised submitter with no guardian email):', ticket.id);
  }
  return [...new Set(emails)];
}
