// ── The owner's authority log read (Authority PR 5) ─────────────────────────
// Newest first, keyset-paged on created_at, names through publicDisplayName
// (the platform actor never needs one — the projection names it). Pre-240: an
// empty, supported:false answer.
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import { AUTHORITY_LOG_PAGE, projectAuthorityEntry, type OwnerAuthorityEntry, type StoredAuthorityEntry } from './projection';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export async function readOwnerAuthorityLog(admin: Admin, orgId: string, before: string | null): Promise<{ supported: boolean; entries: OwnerAuthorityEntry[]; next: string | null }> {
  let q = admin
    .from('authority_audit')
    .select('id, action, actor_kind, actor_profile_id, target_profile_id, detail, created_at')
    .eq('subject_type', 'org')
    .eq('subject_id', orgId)
    .order('created_at', { ascending: false })
    .limit(AUTHORITY_LOG_PAGE + 1);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) {
    if (error.code !== '42P01') console.error('[authority log] read failed:', error.message);
    return { supported: false, entries: [], next: null };
  }
  const rows = (data ?? []) as StoredAuthorityEntry[];
  const page = rows.slice(0, AUTHORITY_LOG_PAGE);
  // Only MEMBER actors and targets are named (a platform actor's id is never looked up).
  const ids = [...new Set(page.flatMap(r => [r.actor_kind === 'member' ? r.actor_profile_id : null, r.target_profile_id]).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: people } = await admin.from('profiles').select('id, first_name, middle_name, last_name, full_name, email, visibility, supervision_state, departed_at').in('id', ids);
    for (const p of (people ?? []) as (MaskableProfile & { id: string })[]) names.set(p.id, publicDisplayName(p));
  }
  return {
    supported: true,
    entries: page.map(r => projectAuthorityEntry(r, names)),
    next: rows.length > AUTHORITY_LOG_PAGE ? page[page.length - 1].created_at : null,
  };
}
