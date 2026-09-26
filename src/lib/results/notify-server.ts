// ── Tell a person their official result changed (results-kept round, 241) ──
// Tom: "Make sure individuals know if they've been untagged from an official
// result. This is to ensure that both sides stay accountable and there is
// not funny business." Every path that takes a person OFF an official record
// — an org's staff deleting their stat line, untagging them from competition
// media, correcting a disputed result — bells that person and writes the
// change to the org's authority log. Never throws (the caller's write already
// happened).

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuthority } from '@/lib/authority/audit-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-agnostic helper (the authz.ts Admin alias)
type Admin = SupabaseClient<any, 'public', any>;

export interface OfficialChange {
  /** The person the record was about. */
  profileId: string;
  /** The org that owns the record (the competition's org). */
  orgId: string;
  /** Who did it (org staff); null when unknown (then a system act). */
  actorProfileId: string | null;
  action: 'official_tag_removed' | 'result_corrected';
  /** Plain words: "your stat line in Spring League". */
  what: string;
  orgName: string | null;
  actionUrl: string;
}

export async function tellOfficialChange(admin: Admin, c: OfficialChange): Promise<void> {
  try {
    const by = c.orgName ?? 'The organization';
    const title = c.action === 'official_tag_removed' ? `${by} removed you from an official record` : `${by} corrected an official result`;
    const message = `${by} changed ${c.what}. If this looks wrong, reply to support under Settings → Support.`;
    const { error } = await admin.from('notifications').insert({
      user_id: c.profileId,
      type: 'authority_notice',
      actor_id: null,
      title,
      message,
      action_url: c.actionUrl,
      is_read: false,
      metadata: { org_id: c.orgId },
    });
    if (error) console.error('[results notify] bell failed:', error.message);
    await recordAuthority(admin, {
      subject: { type: 'org', id: c.orgId },
      actor: c.actorProfileId ? { kind: 'member', profileId: c.actorProfileId } : { kind: 'system' },
      action: c.action,
      targetProfileId: c.profileId,
      detail: { note: c.what },
    });
  } catch (e) {
    console.error('[results notify] failed:', e);
  }
}
