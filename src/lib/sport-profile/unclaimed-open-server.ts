/**
 * Which placeholder pages are OPEN (Sprint 4 PR 6b, migration 312) — the
 * small reads every viewer-facing reader needs. Server only, and on purpose
 * with NO import of the video modules: videos-server.ts reads through this
 * to name an open placeholder in a game's tags, and a cycle there is the
 * kind of thing that crashes at import time.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isUnclaimed, unclaimedName, unclaimedOpen } from './unclaimed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface StubRow { id: string; email: string | null; departed_at: string | null; first_name: string | null; last_name: string | null; full_name: string | null; display_name: string | null }

export async function readStub(admin: Admin, profileId: string): Promise<StubRow | null> {
  const { data } = await admin.from('profiles').select('id, email, departed_at, first_name, last_name, full_name, display_name').eq('id', profileId).maybeSingle();
  const row = data as StubRow | null;
  return row && isUnclaimed(row) ? row : null;
}

/** The organization keeps this placeholder's page private (one row = not open). A database without 312 has no open pages. */
export async function keptPrivate(admin: Admin, profileId: string): Promise<boolean> {
  const { data, error } = await admin.from('unclaimed_page_private').select('profile_id').eq('profile_id', profileId).maybeSingle();
  if (error) return true; // no table (or no answer): nothing is opened that the club could not close
  return !!data;
}

/** May a signed-in visitor read this profile's SPORT profile because it is an open unclaimed page? */
export async function unclaimedPageOpen(admin: Admin, profileId: string): Promise<boolean> {
  const stub = await readStub(admin, profileId);
  if (!stub) return false;
  return unclaimedOpen(stub, await keptPrivate(admin, profileId));
}

/** Which of these profiles are OPEN unclaimed pages, and the short name each shows — for a list of tagged people. */
export async function openUnclaimedNames(admin: Admin, profileIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (profileIds.length === 0) return out;
  const [{ data: rows }, { data: closed, error: closedError }] = await Promise.all([
    admin.from('profiles').select('id, email, departed_at, first_name, last_name, full_name, display_name').in('id', [...profileIds]),
    admin.from('unclaimed_page_private').select('profile_id').in('profile_id', [...profileIds]),
  ]);
  if (closedError) return out; // 312 not here: no page is open
  const off = new Set(((closed ?? []) as Array<{ profile_id: string }>).map(r => r.profile_id));
  for (const r of (rows ?? []) as StubRow[]) if (unclaimedOpen(r, off.has(r.id))) out.set(r.id, unclaimedName(r));
  return out;
}

