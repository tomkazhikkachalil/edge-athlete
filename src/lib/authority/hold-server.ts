// ── The site hold (Authority PR 4; migration 240) ───────────────────────────
// `org_sites.held_at` is the Edge Athlete team's "paused": the site is taken
// offline and 240's CHECK (held ⇒ unpublished) refuses going live from ANY
// path. The app refuses first, in words: going live, publishing the draft
// and the token preview all answer as paused while the hold stands. Nothing
// is pruned from the history while held (the only publish is the team's own
// restore, which skips the prune). Pre-240 (no column) nothing is held.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export const HELD_MESSAGE = 'This site is paused by Edge Athlete support. Reply on your support request to continue.';

/** The hold stamp, or null (not held, pre-240, or a failed read — a read error never locks a site). */
export async function readSiteHold(admin: Admin, siteId: string): Promise<string | null> {
  const { data, error } = await admin.from('org_sites').select('held_at').eq('id', siteId).maybeSingle();
  if (error) {
    if (error.code !== '42703') console.error('[authority hold] read failed:', error.message);
    return null;
  }
  return ((data as { held_at?: string | null } | null)?.held_at) ?? null;
}
