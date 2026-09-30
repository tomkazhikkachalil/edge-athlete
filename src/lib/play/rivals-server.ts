import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/orgs/validate';
import { isDeparted, publicDisplayName, publicHandle, type MaskableProfile } from '@/lib/orgs/public-names';
import { OFFICIAL_PROVENANCE } from '@/lib/results/official';
import type { Rival, RivalPerson, RivalsView } from './rivals';
import { foldHeadToHead, type HeadToHead, type VersusRow } from './versus';

/**
 * Rivalries — the Play program (244). Server-only; the ONE reader of
 * head-to-head records and the ONE writer of `athlete_rivalry_display`.
 *
 * A rivalry is one self-join on `athlete_performances.context_key`: the
 * athlete's shared games in a sport, then everyone else's rows in those
 * games, folded per opponent by `versus.ts foldHeadToHead` (every sport —
 * stroke play, matches, games, sides).
 *
 * Tom's rule (plan mode, Sep 28): the athlete CHOOSES what is displayed.
 *  • The athlete (or their guardian) sees every rival, with a Show / Hide
 *    toggle per rival (presence of a display row = shown; none by default).
 *  • Anyone else who may view the profile sees only the SHOWN rivals — and
 *    always their OWN record against the athlete, from their side.
 * Opponent names are the masked public name; only a public profile links.
 */

type Admin = SupabaseClient;

const ROW_COLUMNS = 'profile_id, context_key, sport_key, occurred_on, side, outcome, headline, metrics, provenance, match_unit:context->>match';
const CONTEXT_CAP = 1000;
const KEY_CHUNK = 150;
const RIVAL_CAP = 20;

interface PerfRow {
  profile_id: string | null;
  context_key: string | null;
  sport_key: string;
  occurred_on: string;
  side: 1 | 2 | null;
  outcome: 'win' | 'loss' | 'tie' | null;
  headline: number | string | null;
  metrics: Record<string, number> | null;
  provenance: string | null;
  /** The match a golf match-play row was played in (context.match). */
  match_unit: string | null;
}

const toVersus = (r: PerfRow): VersusRow => ({
  context_key: r.context_key,
  sport_key: r.sport_key,
  occurred_on: r.occurred_on,
  side: r.side === 1 || r.side === 2 ? r.side : null,
  outcome: r.outcome,
  headline: r.headline === null ? null : Number(r.headline),
  holes: typeof r.metrics?.holes === 'number' ? r.metrics.holes : null,
  unit: r.match_unit ?? null,
  verified: !!r.provenance && OFFICIAL_PROVENANCE.has(r.provenance),
});

/** Every shared game of `profileId` in `sportKey`, and everyone else's row in each. */
async function sharedRows(admin: Admin, profileId: string, sportKey: string): Promise<{ mine: PerfRow[]; others: PerfRow[] } | null> {
  const { data, error } = await admin
    .from('athlete_performances')
    .select(ROW_COLUMNS)
    .eq('profile_id', profileId)
    .eq('sport_key', sportKey)
    .not('context_key', 'is', null)
    .order('occurred_on', { ascending: false })
    .limit(CONTEXT_CAP);
  if (error) {
    if (!isMissingTableError(error.code)) console.warn('[rivals] own rows read failed:', error.message);
    return null;
  }
  const mine = (data ?? []) as PerfRow[];
  const keys = [...new Set(mine.map(r => r.context_key!).filter(Boolean))];
  const others: PerfRow[] = [];
  for (let i = 0; i < keys.length; i += KEY_CHUNK) {
    const { data: chunk, error: e2 } = await admin
      .from('athlete_performances')
      .select(ROW_COLUMNS)
      .in('context_key', keys.slice(i, i + KEY_CHUNK))
      .neq('profile_id', profileId)
      .not('profile_id', 'is', null);
    if (e2) {
      console.warn('[rivals] shared rows read failed:', e2.message);
      return null;
    }
    others.push(...((chunk ?? []) as PerfRow[]));
  }
  return { mine, others };
}

async function people(admin: Admin, ids: readonly string[]): Promise<Map<string, RivalPerson>> {
  const out = new Map<string, RivalPerson>();
  if (ids.length === 0) return out;
  const { data } = await admin
    .from('profiles')
    .select('id, first_name, last_name, full_name, visibility, email, supervision_state, departed_at, handle, avatar_url')
    .in('id', [...ids]);
  for (const p of (data ?? []) as Array<MaskableProfile & { id: string; handle: string | null; avatar_url: string | null }>) {
    const handle = publicHandle(p);
    out.set(p.id, {
      profileId: p.id,
      name: publicDisplayName(p),
      handle,
      // Only a public (linkable) profile shows its face; a masked name never does.
      avatarUrl: handle && !isDeparted(p) ? p.avatar_url : null,
    });
  }
  return out;
}

export async function readRivals(
  admin: Admin,
  profileId: string,
  sportKey: string,
  viewer: { id: string | null; selfView: boolean; canManage: boolean }
): Promise<RivalsView> {
  const empty: RivalsView = { selfView: viewer.selfView, canManage: viewer.canManage, rivals: [], yours: null };
  const shared = await sharedRows(admin, profileId, sportKey);
  if (!shared) return empty;

  const mine = shared.mine.map(toVersus);
  const byOpponent = new Map<string, VersusRow[]>();
  for (const r of shared.others) {
    const list = byOpponent.get(r.profile_id!);
    if (list) list.push(toVersus(r));
    else byOpponent.set(r.profile_id!, [toVersus(r)]);
  }

  // The viewer's own record, from THEIR side (always theirs to see).
  let yours: HeadToHead | null = null;
  if (viewer.id && viewer.id !== profileId && byOpponent.has(viewer.id)) {
    yours = foldHeadToHead(byOpponent.get(viewer.id)!, mine).find(h => h.sportKey === sportKey) ?? null;
  }

  const records: Array<{ id: string; record: HeadToHead }> = [];
  for (const [id, theirs] of byOpponent) {
    const record = foldHeadToHead(mine, theirs).find(h => h.sportKey === sportKey);
    if (record) records.push({ id, record });
  }

  const { data: displayRows, error: displayErr } = await admin
    .from('athlete_rivalry_display')
    .select('opponent_id, position')
    .eq('profile_id', profileId)
    .eq('sport_key', sportKey);
  if (displayErr && !isMissingTableError(displayErr.code)) console.warn('[rivals] display read failed:', displayErr.message);
  const shownAt = new Map(((displayRows ?? []) as Array<{ opponent_id: string; position: number }>).map(d => [d.opponent_id, d.position]));

  // A visitor never sees themselves in the list — their record is `yours`, from their side.
  const visible = viewer.selfView ? records : records.filter(r => shownAt.has(r.id) && r.id !== viewer.id);
  visible.sort((a, b) =>
    (viewer.selfView ? 0 : (shownAt.get(a.id) ?? 0) - (shownAt.get(b.id) ?? 0)) ||
    b.record.encounters - a.record.encounters ||
    (b.record.lastPlayed ?? '').localeCompare(a.record.lastPlayed ?? ''));
  const top = visible.slice(0, RIVAL_CAP);
  const who = await people(admin, top.map(r => r.id));
  const rivals: Rival[] = [];
  for (const r of top) {
    const person = who.get(r.id);
    if (person) rivals.push({ person, record: r.record, shown: shownAt.has(r.id) });
  }
  return { ...empty, rivals, yours };
}

/** Show or hide one rival on the athlete's stats (owner or guardian; the route gates). */
export async function setRivalDisplay(admin: Admin, profileId: string, opponentId: string, sportKey: string, shown: boolean): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (shown) {
    const { count } = await admin.from('athlete_rivalry_display').select('opponent_id', { count: 'exact', head: true }).eq('profile_id', profileId).eq('sport_key', sportKey);
    const { error } = await admin
      .from('athlete_rivalry_display')
      .upsert({ profile_id: profileId, opponent_id: opponentId, sport_key: sportKey, position: count ?? 0 }, { onConflict: 'profile_id,opponent_id,sport_key', ignoreDuplicates: true });
    if (error) {
      console.warn('[rivals] show failed:', error.message);
      return { ok: false, status: error.code === '23503' ? 404 : 500, error: 'Could not update your rivals.' };
    }
    return { ok: true };
  }
  const { error } = await admin.from('athlete_rivalry_display').delete().eq('profile_id', profileId).eq('opponent_id', opponentId).eq('sport_key', sportKey);
  if (error) {
    console.warn('[rivals] hide failed:', error.message);
    return { ok: false, status: 500, error: 'Could not update your rivals.' };
  }
  return { ok: true };
}
