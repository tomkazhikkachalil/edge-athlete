import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchHandicapComputation } from '@/lib/golf/handicap-server';
import { notifyGuardians } from '@/lib/guardian-notify';
import { isMissingTableError } from '@/lib/orgs/validate';
import type { PerformanceRow } from '@/lib/performance/types';
import { badgeDef } from './badges/catalog';
import { evaluateBadges, type Award, type EvalRow } from './badges/evaluate';

/**
 * The ONE writer of `badge_awards` — the Play program (244). Server-only.
 *
 *  • `awardBadgesAfterWrite` — the post-write hook's half (after-write.ts):
 *    evaluates the rows just written, per profile, against the catalog and
 *    inserts what is NEW (ON CONFLICT DO NOTHING — two writes racing award
 *    once). `notify` bells the athlete (their `achievements_enabled`
 *    preference) and a supervised athlete's guardians; the backfill passes
 *    `notify: false` (history earns silently — never a flood of bells).
 *  • `rescanBadges` — support's corrections (a moved, corrected or removed
 *    result): the profile's WHOLE record re-decides the row-based badges;
 *    one no longer earned by any row is revoked, one now earned is awarded
 *    silently. A handicap badge is never revoked (the index was reached;
 *    a later rise does not un-reach it).
 *
 * Like the performance writer: NEVER throws, never fails the caller's
 * write, a missing table (pre-244) is a quiet skip. Always await.
 */

type Admin = SupabaseClient;
const TAG = '[badges]';
const ROW_CAP = 5000;

const warn = (what: string, e: unknown) => console.warn(`${TAG} ${what}:`, e instanceof Error ? e.message : (e as { message?: string })?.message ?? e);

interface HeldRow { badge_key: string; source_key: string | null }

async function readHeld(admin: Admin, profileId: string): Promise<HeldRow[] | null> {
  const { data, error } = await admin.from('badge_awards').select('badge_key, source_key').eq('profile_id', profileId);
  if (error) {
    if (!isMissingTableError(error.code)) warn('held read failed', error);
    return null;
  }
  return (data ?? []) as HeldRow[];
}

async function readProfileRows(admin: Admin, profileId: string): Promise<EvalRow[] | null> {
  const { data, error } = await admin
    .from('athlete_performances')
    .select('natural_key, sport_key, occurred_on, metrics, outcome, context, provenance')
    .eq('profile_id', profileId)
    .order('occurred_on', { ascending: false })
    .limit(ROW_CAP);
  if (error) {
    warn('record read failed', error);
    return null;
  }
  return (data ?? []) as EvalRow[];
}

function countsOf(rows: ReadonlyArray<{ sport_key: string }>): { resultCounts: Record<string, number>; sportsPlayed: number } {
  const resultCounts: Record<string, number> = {};
  for (const r of rows) resultCounts[r.sport_key] = (resultCounts[r.sport_key] ?? 0) + 1;
  return { resultCounts, sportsPlayed: Object.keys(resultCounts).length };
}

/** The golf index after a write — only a non-provisional index earns a handicap badge. */
async function currentHandicap(admin: Admin, profileId: string): Promise<number | null> {
  try {
    const hc = await fetchHandicapComputation(profileId, admin);
    return hc.current && !hc.current.provisional ? hc.current.index : null;
  } catch (e) {
    warn('handicap read failed', e);
    return null;
  }
}

async function insertAwards(admin: Admin, profileId: string, awards: readonly Award[]): Promise<string[]> {
  if (awards.length === 0) return [];
  const { data, error } = await admin
    .from('badge_awards')
    .upsert(
      awards.map(a => ({
        profile_id: profileId,
        badge_key: a.badgeKey,
        sport_key: a.sportKey,
        earned_on: a.earnedOn,
        source_key: a.sourceKey,
        verified: a.verified,
        detail: a.detail,
      })),
      { onConflict: 'profile_id,badge_key', ignoreDuplicates: true }
    )
    .select('badge_key');
  if (error) {
    if (!isMissingTableError(error.code)) warn('award insert failed', error);
    return [];
  }
  return ((data ?? []) as Array<{ badge_key: string }>).map(r => r.badge_key);
}

/** "Badge earned: Broke 80" / "3 badges earned" — the one bell per write (pure; exported for the test). */
export function badgeBellCopy(keys: readonly string[]): { title: string; message: string } | null {
  const labels = keys.map(k => badgeDef(k)?.label).filter((l): l is string => !!l);
  if (labels.length === 0) return null;
  if (labels.length === 1) return { title: `Badge earned: ${labels[0]}`, message: badgeDef(keys[0])?.description ?? '' };
  return { title: `${labels.length} badges earned`, message: labels.join(' · ') };
}

async function bellFor(admin: Admin, profileId: string, keys: readonly string[]): Promise<void> {
  const copy = badgeBellCopy(keys);
  if (!copy) return;
  const actionUrl = `/athlete/${profileId}?tab=achievements`;
  const metadata = { badge_keys: [...keys] };
  try {
    const { data: pref } = await admin.from('notification_preferences').select('achievements_enabled').eq('user_id', profileId).maybeSingle();
    if ((pref as { achievements_enabled?: boolean | null } | null)?.achievements_enabled !== false) {
      const { error } = await admin.from('notifications').insert({
        user_id: profileId, type: 'achievement', actor_id: null, title: copy.title, message: copy.message, action_url: actionUrl, is_read: false, metadata,
      });
      if (error) warn('bell failed', error);
    }
    // A supervised athlete's guardians hear too (no guardian rows = nobody).
    await notifyGuardians(admin, profileId, { type: 'achievement', title: copy.title, message: copy.message, actionUrl, metadata });
  } catch (e) {
    warn('bell threw', e);
  }
}

/** The post-write hook's badge half. `rows` are the rows just upserted (any profiles). */
export async function awardBadgesAfterWrite(admin: Admin, rows: readonly PerformanceRow[], opts: { notify: boolean }): Promise<void> {
  try {
    const byProfile = new Map<string, PerformanceRow[]>();
    for (const r of rows) {
      if (!r.profile_id) continue;
      const list = byProfile.get(r.profile_id);
      if (list) list.push(r);
      else byProfile.set(r.profile_id, [r]);
    }
    for (const [profileId, mine] of byProfile) {
      const [held, record] = await Promise.all([
        readHeld(admin, profileId),
        admin.from('athlete_performances').select('sport_key').eq('profile_id', profileId).limit(ROW_CAP),
      ]);
      if (!held) continue; // pre-244, or a read error — nothing is awarded blind
      if (record.error) { warn('count read failed', record.error); continue; }
      const { resultCounts, sportsPlayed } = countsOf((record.data ?? []) as Array<{ sport_key: string }>);
      const wroteRatedGolf = mine.some(r => r.sport_key === 'golf' && typeof r.metrics.differential === 'number');
      const handicapIndex = wroteRatedGolf ? await currentHandicap(admin, profileId) : null;
      const awards = evaluateBadges({
        rows: mine.map(r => ({ natural_key: r.natural_key, sport_key: r.sport_key, occurred_on: r.occurred_on, metrics: r.metrics, outcome: r.outcome ?? null, context: r.context, provenance: r.provenance ?? null })),
        resultCounts,
        sportsPlayed,
        handicapIndex,
        held: new Set(held.map(h => h.badge_key)),
      });
      const inserted = await insertAwards(admin, profileId, awards);
      if (opts.notify && inserted.length > 0) await bellFor(admin, profileId, inserted);
    }
  } catch (e) {
    warn('award pass threw', e);
  }
}

/** Support's corrections: the profile's whole record re-decides the row-based badges (silently). */
export async function rescanBadges(admin: Admin, profileId: string): Promise<void> {
  try {
    const [held, rows] = await Promise.all([readHeld(admin, profileId), readProfileRows(admin, profileId)]);
    if (!held || !rows) return;
    const earned = evaluateBadges({ rows, ...countsOf(rows), handicapIndex: null, held: new Set() });
    const earnedKeys = new Set(earned.map(a => a.badgeKey));
    const revoke = held
      .filter(h => {
        const def = badgeDef(h.badge_key);
        return !!def && def.rule.kind !== 'handicap' && !earnedKeys.has(h.badge_key);
      })
      .map(h => h.badge_key);
    if (revoke.length > 0) {
      const { error } = await admin.from('badge_awards').delete().eq('profile_id', profileId).in('badge_key', revoke);
      if (error) warn('revoke failed', error);
    }
    const heldKeys = new Set(held.map(h => h.badge_key));
    await insertAwards(admin, profileId, earned.filter(a => !heldKeys.has(a.badgeKey)));
  } catch (e) {
    warn('rescan threw', e);
  }
}
