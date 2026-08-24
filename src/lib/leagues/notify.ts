// ── League notifications ─────────────────────────────────────────────────────
// Same contract as guardian-notify.ts and the shared-round notifiers: direct
// inserts on the admin client (create_notification's preference gate has no
// branch for these types), and BEST-EFFORT — a failed notification never
// fails the join that triggered it. Lazily imported by the members route.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches guardian-notify's Admin alias; the notifier is schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

export interface LeagueJoinNotification {
  /** The league's owner (profiles.id === auth user id). Null = orphaned league. */
  ownerProfileId: string | null;
  /** The athlete who joined. */
  actorId: string;
  leagueId: string;
  leagueName: string;
}

/** Tell the owner someone joined their league. No-op when the league is
 *  orphaned or the owner joined their own league (can't happen via the API,
 *  but the guard is free). */
export async function notifyLeagueJoin(admin: Admin, n: LeagueJoinNotification): Promise<void> {
  try {
    if (!n.ownerProfileId || n.ownerProfileId === n.actorId) return;
    const { data: actor } = await admin
      .from('profiles')
      .select('first_name, full_name, display_name')
      .eq('id', n.actorId)
      .maybeSingle();
    const actorName = actor?.first_name || actor?.display_name || actor?.full_name || 'Someone';
    const { error } = await admin.from('notifications').insert({
      user_id: n.ownerProfileId,
      type: 'league_join',
      actor_id: n.actorId,
      title: `${actorName} joined ${n.leagueName}`,
      message: null,
      action_url: `/league/${n.leagueId}`,
      is_read: false,
      metadata: { league_id: n.leagueId },
    });
    if (error) console.error('[LEAGUE NOTIFY] join notify failed:', error);
  } catch (e) {
    console.error('[LEAGUE NOTIFY] join notify failed:', e);
  }
}
