// ── The ONE reader and writer of activity_connections (mig 247) ─────────────
// A connection is the athlete's standing consent for a watch or an app to
// deliver their workouts. Everything that touches the table goes through
// here, for two reasons:
//
//   • the table holds the two things no response may ever carry — the
//     encrypted provider secret and the upload link's token hash. The reader
//     below selects the five DISPLAY columns by name and nothing else; a
//     route never selects from the table itself.
//   • before 247 has run (it runs on prod by hand) the table does not exist:
//     every function here answers "not supported" instead of failing.
//
// Disconnecting DELETES the row. The activities a connection delivered stay —
// they are the athlete's, and they are removed like any other activity.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/orgs/validate';
import type { ConnectionProvider, ConnectionRow } from './connections';

type Admin = SupabaseClient;

/** The display columns — the ONLY ones a reader for the screen may name. */
export const CONNECTION_DISPLAY_COLUMNS = 'provider, status, connected_at, last_sync_at, last_error';

export type ConnectionsRead =
  | { supported: true; rows: ConnectionRow[] }
  /** 247 has not run in this environment. */
  | { supported: false; rows: [] };

export async function readConnections(admin: Admin, profileId: string): Promise<ConnectionsRead> {
  const { data, error } = await admin
    .from('activity_connections')
    .select(CONNECTION_DISPLAY_COLUMNS)
    .eq('profile_id', profileId);
  if (error) {
    if (isMissingTableError(error.code)) return { supported: false, rows: [] };
    throw new Error(`Failed to read connections: ${error.message}`);
  }
  return { supported: true, rows: (data ?? []) as ConnectionRow[] };
}

export type DisconnectOutcome =
  | { ok: true; removed: boolean }
  | { ok: false; status: 404 | 500; error: string };

/**
 * Remove one connection of one athlete. `removed: false` when there was none
 * (a second tap, another device) — the same success, so the screen settles.
 */
export async function disconnect(admin: Admin, profileId: string, provider: ConnectionProvider): Promise<DisconnectOutcome> {
  const { data, error } = await admin
    .from('activity_connections')
    .delete()
    .eq('profile_id', profileId)
    .eq('provider', provider)
    .select('id');
  if (error) {
    if (isMissingTableError(error.code)) return { ok: false, status: 404, error: 'Connected apps are not available yet.' };
    console.error('[connections] disconnect failed:', error.message);
    return { ok: false, status: 500, error: 'Could not disconnect. Try again.' };
  }
  return { ok: true, removed: (data ?? []).length > 0 };
}

/** A supervised athlete cannot hold a connection (the calendar feed link's
 *  rule): it is a standing delivery nobody in the guardian console can see. */
export async function isSupervisedProfile(admin: Admin, profileId: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('supervision_state').eq('id', profileId).maybeSingle();
  return data?.supervision_state === 'supervised';
}
