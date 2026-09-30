import type { SupabaseClient } from '@supabase/supabase-js';
import { canViewSharedRound } from '@/lib/golf/round-access';
import { effectiveRoundStatus } from '@/lib/golf/round-status';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
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
}

export async function cheerGate(admin: Admin, contextKey: string, viewerId: string | null): Promise<CheerGate | null> {
  const ctx = parseCheerContext(contextKey);
  if (!ctx) return null;
  if (ctx.kind === 'group_post') {
    const [{ data: gp }, { data: parts }] = await Promise.all([
      admin.from('group_posts').select('id, creator_id, visibility, status, sport_event_round_id').eq('id', ctx.id).maybeSingle(),
      // last_score_activity_at is not a column — it is the newest card write (scorecard-transform's rule).
      admin.from('group_post_participants').select('profile_id, golf_participant_scores(updated_at)').eq('group_post_id', ctx.id),
    ]);
    if (!gp) return null;
    const partRows = (parts ?? []) as Array<{ profile_id: string; golf_participant_scores: Array<{ updated_at: string | null }> | { updated_at: string | null } | null }>;
    const ids = partRows.map(p => p.profile_id);
    let lastActivity: string | null = null;
    for (const p of partRows) {
      const cards = Array.isArray(p.golf_participant_scores) ? p.golf_participant_scores : p.golf_participant_scores ? [p.golf_participant_scores] : [];
      for (const c of cards) if (c.updated_at && (!lastActivity || c.updated_at > lastActivity)) lastActivity = c.updated_at;
    }
    const g = { ...(gp as { creator_id: string | null; visibility: string | null; status: string | null; sport_event_round_id: string | null }), last_score_activity_at: lastActivity };
    if (!canViewSharedRound({ viewerId, creatorId: g.creator_id, visibility: g.visibility, participantProfileIds: ids })) return null;
    return { live: await groupPostLive(admin, g), players: new Set(ids) };
  }
  const { data: round } = await admin.from('sport_event_rounds').select('id, sport_event_id, status').eq('id', ctx.id).maybeSingle();
  if (!round) return null;
  const r = round as { sport_event_id: string; status: string };
  const access = await readSportEventAccess(admin, r.sport_event_id, viewerId, null);
  if (!access) return null;
  const { data: parts } = await admin.from('sport_event_participants').select('profile_id').eq('sport_event_id', r.sport_event_id).eq('status', 'accepted');
  return { live: r.status === 'live', players: new Set(((parts ?? []) as Array<{ profile_id: string }>).map(p => p.profile_id)) };
}

/** A golf round is live when its EVENT round is (an event's round owns its
 *  lifecycle — its group post stays 'pending' until the first score); a
 *  casual shared round while it is pending or active and not gone quiet
 *  (effectiveRoundStatus — the LIVE badge's own rule). */
async function groupPostLive(admin: Admin, g: { status: string | null; last_score_activity_at: string | null; sport_event_round_id: string | null }): Promise<boolean> {
  if (g.sport_event_round_id) {
    const { data } = await admin.from('sport_event_rounds').select('status').eq('id', g.sport_event_round_id).maybeSingle();
    return (data as { status?: string } | null)?.status === 'live';
  }
  const effective = effectiveRoundStatus(g);
  return effective === 'pending' || effective === 'active';
}

const RECENT_CAP = 50;

/**
 * The counts are six head counts in the database (one per cheer key, over
 * idx_live_cheers_context) — never the rows: a popular round used to ship
 * up to 5,000 rows to every viewer every 10 s, and its totals silently
 * froze at that cap (the Play review, Sep 29 2026).
 */
export async function readCheerFeed(admin: Admin, contextKey: string, since: string | null): Promise<CheerFeed> {
  const now = new Date().toISOString();
  const [counts, recent] = await Promise.all([
    Promise.all(
      CHEER_KEYS.map(k => admin.from('live_cheers').select('id', { count: 'exact', head: true }).eq('context_key', contextKey).eq('cheer', k))
    ),
    since
      ? admin.from('live_cheers').select('id, cheer, target_profile_id, created_at').eq('context_key', contextKey).gt('created_at', since).order('created_at', { ascending: false }).limit(RECENT_CAP)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const totals = emptyTotals();
  let total = 0;
  counts.forEach((c, i) => {
    if (c.error) {
      if (!isMissingTableError(c.error.code)) console.warn('[cheers] count failed:', c.error.message);
      return;
    }
    totals[CHEER_KEYS[i]] = c.count ?? 0;
    total += c.count ?? 0;
  });
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
