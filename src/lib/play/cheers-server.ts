import type { SupabaseClient } from '@supabase/supabase-js';
import { canViewSharedRound } from '@/lib/golf/round-access';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { resolveSportEventAccess } from '@/lib/sport-events/access';
import { isMissingTableError } from '@/lib/orgs/validate';
import { CHEER_KEYS, emptyTotals, parseCheerContext, type CheerEvent, type CheerFeed, type CheerKey } from './cheers';

/**
 * Live cheers — the Play program (244). Server-only; the ONE writer of
 * `live_cheers`.
 *
 * The gate is the CONTEXT's own, re-run on every read and write: a golf
 * shared round through canViewSharedRound (the scorecard route's rule), a
 * stat event's round through readSportEventAccess (the one event gate). A
 * cheer needs the round LIVE (a golf group post 'active', an event round
 * 'live'); reading the count works for anyone who may watch. A refusal is
 * null → the route's 404, never "exists but private".
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface CheerGate {
  live: boolean;
  /** Who plays — a cheer's optional target must be one of them. */
  players: ReadonlySet<string>;
  /** True when ANYONE may watch (a public round / event): the read's payload
   *  is then the same for every viewer and the route may let the CDN hold
   *  one copy (scale round 2, Nov 7 2026). A private round is never cached. */
  publicView: boolean;
}

export async function cheerGate(admin: Admin, contextKey: string, viewerId: string | null): Promise<CheerGate | null> {
  const ctx = parseCheerContext(contextKey);
  if (!ctx) return null;
  if (ctx.kind === 'group_post') {
    const [{ data: gp }, { data: parts }] = await Promise.all([
      admin.from('group_posts').select('id, creator_id, visibility, status, sport_event_round_id').eq('id', ctx.id).maybeSingle(),
      // The roster only — no scores embed: liveness is the STORED status
      // (nothing finishes at read time since the Drafts round), so the newest
      // card write was read for every poll and used by nothing (Nov 7 2026).
      admin.from('group_post_participants').select('profile_id').eq('group_post_id', ctx.id),
    ]);
    if (!gp) return null;
    const ids = ((parts ?? []) as Array<{ profile_id: string }>).map(p => p.profile_id);
    const g = gp as { creator_id: string | null; visibility: string | null; status: string | null; sport_event_round_id: string | null };
    const round = { creatorId: g.creator_id, visibility: g.visibility, participantProfileIds: ids };
    if (!canViewSharedRound({ viewerId, ...round })) return null;
    return { live: await groupPostLive(admin, g), players: new Set(ids), publicView: canViewSharedRound({ viewerId: null, ...round }) };
  }
  const { data: round } = await admin.from('sport_event_rounds').select('id, sport_event_id, status').eq('id', ctx.id).maybeSingle();
  if (!round) return null;
  const r = round as { sport_event_id: string; status: string };
  const access = await readSportEventAccess(admin, r.sport_event_id, viewerId, null);
  if (!access) return null;
  const { data: parts } = await admin.from('sport_event_participants').select('profile_id').eq('sport_event_id', r.sport_event_id).eq('status', 'accepted');
  // Would a stranger with no link see it? The pure rule over the row already in hand — no trip.
  const ev = access.event;
  const publicView = resolveSportEventAccess({
    event: { hostProfileId: ev.host_profile_id, visibility: ev.visibility, status: ev.status, linkToken: ev.link_token },
    viewerId: null,
    presentedToken: null,
    participant: null,
    viewerHoldsAuthority: true,
  }) !== null;
  return { live: r.status === 'live', players: new Set(((parts ?? []) as Array<{ profile_id: string }>).map(p => p.profile_id)), publicView };
}

/** A golf round is live when its EVENT round is (an event's round owns its
 *  lifecycle — its group post stays 'pending' until the first score); a
 *  casual shared round while it is pending or active (the stored status —
 *  nothing finishes at read time since the Drafts round). */
async function groupPostLive(admin: Admin, g: { status: string | null; sport_event_round_id: string | null }): Promise<boolean> {
  if (g.sport_event_round_id) {
    const { data } = await admin.from('sport_event_rounds').select('status').eq('id', g.sport_event_round_id).maybeSingle();
    return (data as { status?: string } | null)?.status === 'live';
  }
  return g.status === 'pending' || g.status === 'active';
}

const RECENT_CAP = 50;
/** The recent list is the last 30 s, for EVERY reader alike (scale round 2,
 *  Nov 7 2026): a per-client `since` split the CDN's copy of a public
 *  round's feed into one per watcher; the client dedupes by id (useCheers'
 *  `seen`), and the poll's 10 s cadence sits well inside the window. */
export const RECENT_WINDOW_MS = 30_000;

/**
 * The counts are ONE grouped query in the database (`live_cheer_totals`,
 * migration 275 — one pass over idx_live_cheers_context) — never the rows: a
 * popular round used to ship up to 5,000 rows to every viewer every 10 s,
 * and its totals silently froze at that cap (the Play review, Sep 29 2026).
 * Until scale fix 5 (Oct 25 2026) it was six head counts, one per cheer key
 * (PostgREST cannot GROUP BY): nine statements per poll per watcher with the
 * gate's two and the recent read; now four.
 */
export async function readCheerFeed(admin: Admin, contextKey: string): Promise<CheerFeed> {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const windowStart = new Date(nowMs - RECENT_WINDOW_MS).toISOString();
  const [grouped, recent] = await Promise.all([
    admin.rpc('live_cheer_totals', { p_context_key: contextKey }),
    admin.from('live_cheers').select('id, cheer, target_profile_id, created_at').eq('context_key', contextKey).gt('created_at', windowStart).order('created_at', { ascending: false }).limit(RECENT_CAP),
  ]);
  const totals = emptyTotals();
  let total = 0;
  if (grouped.error) {
    if (!isMissingTableError(grouped.error.code)) console.warn('[cheers] totals failed:', grouped.error.message);
  } else {
    for (const row of (grouped.data ?? []) as Array<{ cheer: string; n: number | string }>) {
      if (!(CHEER_KEYS as readonly string[]).includes(row.cheer)) continue; // a key the table's CHECK no longer allows
      const n = Number(row.n) || 0;
      totals[row.cheer as CheerKey] = n;
      total += n;
    }
  }
  const events: CheerEvent[] = ((recent.data ?? []) as Array<{ id: string; cheer: CheerKey; target_profile_id: string | null; created_at: string }>).map(r => ({
    id: r.id,
    cheer: r.cheer,
    target: r.target_profile_id,
    at: r.created_at,
  }));
  return { totals, total, recent: events, now };
}

export async function addCheer(admin: Admin, contextKey: string, profileId: string, cheer: CheerKey, targetProfileId: string | null): Promise<{ id: string; at: string } | null> {
  const { data, error } = await admin
    .from('live_cheers')
    .insert({ context_key: contextKey, profile_id: profileId, target_profile_id: targetProfileId, cheer })
    .select('id, created_at')
    .single();
  if (error || !data) {
    console.warn('[cheers] insert failed:', error?.message);
    return null;
  }
  return { id: data.id as string, at: data.created_at as string };
}

/** The daily cron's step: cheers are a live garnish — gone after 30 days. */
export async function purgeOldCheers(admin: Admin, now = new Date()): Promise<{ ok: boolean }> {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const { error } = await admin.from('live_cheers').delete().lt('created_at', cutoff);
  if (error && !isMissingTableError(error.code)) {
    console.warn('[cheers] purge failed:', error.message);
    return { ok: false };
  }
  return { ok: true };
}
