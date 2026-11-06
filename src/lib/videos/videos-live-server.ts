// ── Live (Videos program Phase 4a, Nov 5 2026) — the one writer of a video's
// live state. SERVER ONLY. Never imports videos-server.ts (it is called from
// the routes after a list or a read, so the videos writer stays acyclic).
//
// Reader-driven: a state is read from YouTube when someone is about to look
// at a row whose TTL has passed (live-rules.ts), and the read is CLAIMED by a
// conditional UPDATE on live_checked_at — zero rows means another request got
// there first. No cron, no in-process lock (honest under shared instances).
// The owner's connection reads first (a private broadcast), else the
// server-only Data API key (any public video); neither → nothing happens and
// the app keeps Phase 1's behaviour. A quotaExceeded answer parks the row for
// QUOTA_BACKOFF_MS by dating the claim forward; the state shown stays the last
// truth. A read that happens to see the duration fills `duration_ms` when it
// is still null — every new link gets its badge the moment it is saved.

import type { SupabaseClient } from '@supabase/supabase-js';
import { secretBoxReady } from '@/lib/crypto/secret-box-server';
import { isOrgKind } from '@/lib/orgs/org-ref';
import { durationToRecord, liveRefreshDue, liveRefreshTtlMs, liveStateFromApi, QUOTA_BACKOFF_MS, type LiveStatus } from './live-rules';
import type { ConnectionOwner } from './youtube-connection';
import { withAccessToken } from './youtube-connections-server';
import { youtubeConfig, youtubeLiveDetails, youtubeReadConfig, type LiveRead } from './google-youtube-server';

type Admin = SupabaseClient;
const TAG = '[videos/live]';

export interface LiveRow {
  id: string;
  provider_video_id: string;
  profile_id: string | null;
  org_id: string | null;
  duration_ms: number | null;
  live_status: LiveStatus;
  scheduled_start_at: string | null;
  live_started_at: string | null;
  live_ended_at: string | null;
  live_checked_at: string | null;
}

export const LIVE_ROW_COLUMNS = 'id, provider_video_id, profile_id, org_id, duration_ms, live_status, scheduled_start_at, live_started_at, live_ended_at, live_checked_at';

/** Is there any way to ask YouTube? (the key, or the connection's token) */
export function liveReadsAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return !!youtubeReadConfig(env) || !!youtubeConfig(env);
}

async function ownerOf(admin: Admin, row: LiveRow): Promise<ConnectionOwner | null> {
  if (row.org_id) {
    const { data } = await admin.from('organizations').select('kind').eq('id', row.org_id).maybeSingle();
    return { kind: 'org', side: isOrgKind(data?.kind) ? data.kind : 'club', orgId: row.org_id };
  }
  return row.profile_id ? { kind: 'profile', profileId: row.profile_id } : null;
}

/** The owner's connection first (it sees a private broadcast), then the key. Null = no way to ask. */
async function readFor(admin: Admin, row: LiveRow): Promise<LiveRead | null> {
  const cfg = youtubeConfig();
  if (cfg && secretBoxReady()) {
    const owner = await ownerOf(admin, row);
    const token = owner ? await withAccessToken(admin, cfg, owner) : null;
    if (token?.ok) {
      const viaToken = await youtubeLiveDetails({ apiBase: cfg.apiBase, accessToken: token.accessToken }, row.provider_video_id);
      if (viaToken.ok || !viaToken.unauthorized) return viaToken;
    }
  }
  const key = youtubeReadConfig();
  if (!key) return null;
  return youtubeLiveDetails({ apiBase: key.apiBase, apiKey: key.apiKey }, row.provider_video_id);
}

export interface RefreshResult { changed: boolean; row: LiveRow }

/**
 * Read the live state when it is due (or `force`: the first read after a
 * link). Claims the read through live_checked_at so concurrent viewers cost
 * one unit. Never throws; an unreadable answer leaves the row as it was.
 */
export async function refreshLiveState(admin: Admin, row: LiveRow, opts: { force?: boolean; now?: number } = {}): Promise<RefreshResult> {
  const now = opts.now ?? Date.now();
  const unchanged: RefreshResult = { changed: false, row };
  if (!opts.force && !liveRefreshDue(row, now)) return unchanged;
  if (!liveReadsAvailable()) return unchanged;
  const nowIso = new Date(now).toISOString();

  // The claim: a conditional UPDATE — zero rows means another request is reading.
  let claim = admin.from('videos').update({ live_checked_at: nowIso }).eq('id', row.id);
  if (!opts.force) {
    const ttl = liveRefreshTtlMs(row.live_status, row.scheduled_start_at, now) ?? 0;
    claim = claim.or(`live_checked_at.is.null,live_checked_at.lt.${new Date(now - ttl).toISOString()}`); // hardening-ok: the interpolated value is a server-made ISO timestamp, never input
  }
  const { data: claimed, error: claimError } = await claim.select('id');
  if (claimError) {
    console.error(`${TAG} claim failed:`, claimError.message);
    return unchanged;
  }
  if (!claimed || claimed.length === 0) return unchanged;

  const read = await readFor(admin, row);
  if (!read) return unchanged;
  if (!read.ok) {
    if (read.quota) {
      // Park it: nobody asks again until the backoff passes.
      await admin.from('videos').update({ live_checked_at: new Date(now + QUOTA_BACKOFF_MS).toISOString() }).eq('id', row.id);
      console.warn(`${TAG} quota exceeded — parked ${row.id} for ${QUOTA_BACKOFF_MS / 60_000} min`);
    }
    return unchanged;
  }
  if (!read.value) return unchanged; // YouTube has no such video (deleted / private to the key) — the row keeps its last truth.

  const state = liveStateFromApi(read.value);
  const patch: Record<string, unknown> = { ...state, live_checked_at: nowIso };
  const duration = durationToRecord(row, state, read.value.durationMs);
  if (duration !== null) patch.duration_ms = duration;
  const changed =
    state.live_status !== row.live_status ||
    state.scheduled_start_at !== row.scheduled_start_at ||
    state.live_started_at !== row.live_started_at ||
    state.live_ended_at !== row.live_ended_at ||
    patch.duration_ms !== undefined;
  if (changed) {
    const { error } = await admin.from('videos').update(patch).eq('id', row.id);
    if (error) {
      console.error(`${TAG} update failed:`, error.message);
      return unchanged;
    }
  }
  return { changed, row: { ...row, ...state, live_checked_at: nowIso, ...(patch.duration_ms !== undefined ? { duration_ms: patch.duration_ms as number } : {}) } };
}

/** At most this many YouTube reads per request, newest-live first. */
export const LIVE_REFRESH_MAX_PER_REQUEST = 5;

/**
 * For a list (or one) of projected views: refresh the rows that can be due
 * (only `upcoming` and `live` ever are), at most a few per request. True when
 * anything changed — the caller re-reads its list, the cheap way to keep one
 * projection.
 */
export async function refreshLiveViews(admin: Admin, views: ReadonlyArray<{ id: string; live_status: LiveStatus }>, now = Date.now()): Promise<boolean> {
  const candidates = views.filter(v => v.live_status === 'live' || v.live_status === 'upcoming').map(v => v.id);
  if (candidates.length === 0 || !liveReadsAvailable()) return false;
  const { data, error } = await admin.from('videos').select(LIVE_ROW_COLUMNS).in('id', candidates.slice(0, 50));
  if (error) {
    console.error(`${TAG} rows read failed:`, error.message);
    return false;
  }
  const rows = ((data ?? []) as unknown as LiveRow[]).filter(r => liveRefreshDue(r, now)).slice(0, LIVE_REFRESH_MAX_PER_REQUEST);
  let changed = false;
  for (const row of rows) {
    const out = await refreshLiveState(admin, row, { now });
    changed = changed || out.changed;
  }
  return changed;
}
