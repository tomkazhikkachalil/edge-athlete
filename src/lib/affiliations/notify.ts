// ── Affiliation notifications (118) ─────────────────────────────────────────
// Same contract as the org notifiers: direct admin-client inserts,
// BEST-EFFORT, lazily imported. The invite goes to the RECEIVING org's
// owner and links to THEIR OWN page — that is where the Accept button lives.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-agnostic notifier
type Admin = SupabaseClient<any, 'public', any>;

export interface AffiliationInviteNotification {
  /** The receiving org's owner (null = ownerless org: nothing to send). */
  recipientProfileId: string | null;
  leagueName: string;
  clubName: string;
  /** Which side initiated — phrases the title from the recipient's view. */
  initiatedBy: 'league' | 'club';
  /** The RECIPIENT's own org page, where Accept lives. */
  actionUrl: string;
}

export async function notifyAffiliationInvite(
  admin: Admin,
  n: AffiliationInviteNotification
): Promise<void> {
  try {
    if (!n.recipientProfileId) return;
    const { error } = await admin.from('notifications').insert({
      user_id: n.recipientProfileId,
      type: 'affiliation_invite',
      actor_id: null,
      title: n.initiatedBy === 'league'
        ? `${n.leagueName} wants to affiliate with ${n.clubName}`
        : `${n.clubName} wants to affiliate with ${n.leagueName}`,
      message: null,
      action_url: n.actionUrl,
      is_read: false,
      metadata: { initiated_by: n.initiatedBy },
    });
    if (error) console.error('[AFFILIATION NOTIFY] invite failed:', error);
  } catch (e) {
    console.error('[AFFILIATION NOTIFY] invite failed:', e);
  }
}

export interface AffiliationUpdateNotification {
  /** Usually the original requester; on dissolve, the other side's owner. */
  recipientProfileId: string | null;
  leagueName: string;
  clubName: string;
  outcome: 'accepted' | 'declined' | 'dissolved';
  actionUrl: string;
}

export async function notifyAffiliationUpdate(
  admin: Admin,
  n: AffiliationUpdateNotification
): Promise<void> {
  try {
    if (!n.recipientProfileId) return;
    const titles: Record<AffiliationUpdateNotification['outcome'], string> = {
      accepted: `${n.leagueName} and ${n.clubName} are now affiliated`,
      declined: `The affiliation between ${n.leagueName} and ${n.clubName} was declined`,
      dissolved: `The affiliation between ${n.leagueName} and ${n.clubName} was ended`,
    };
    const { error } = await admin.from('notifications').insert({
      user_id: n.recipientProfileId,
      type: 'affiliation_update',
      actor_id: null,
      title: titles[n.outcome],
      message: null,
      action_url: n.actionUrl,
      is_read: false,
      metadata: { outcome: n.outcome },
    });
    if (error) console.error('[AFFILIATION NOTIFY] update failed:', error);
  } catch (e) {
    console.error('[AFFILIATION NOTIFY] update failed:', e);
  }
}
