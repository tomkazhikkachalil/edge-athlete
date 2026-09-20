/**
 * Mutes and the READ-side hiding (Support & Reporting, Spec 2; migration 223).
 *
 * A mute is silent and one-directional: the muted person's posts leave the
 * muter's feed, their comments leave the muter's view of a thread, their
 * activity leaves the muter's bell. Blocks are two-directional and already
 * sever follows and shared DMs (src/lib/blocks.ts) — but until Spec 2 the
 * FEED READ did not filter them; the one helper below applies both.
 *
 * `hiddenAuthorsFor(viewerId)` = everyone the viewer muted ∪ everyone the
 * viewer blocked ∪ everyone who blocked the viewer. Fails OPEN on a read
 * error (nothing hidden, a log) — availability over strictness, the house
 * rule. Pre-223 (no user_mutes) the mute half is empty.
 */
import type { getSupabaseAdmin } from '@/lib/auth-server';

type Admin = ReturnType<typeof getSupabaseAdmin>;
const TAG = '[mutes]';

export async function hiddenAuthorsFor(admin: Admin, viewerId: string | null): Promise<Set<string>> {
  const out = new Set<string>();
  if (!viewerId) return out;
  const [mutes, blocksOut, blocksIn] = await Promise.all([
    admin.from('user_mutes').select('muted_id').eq('muter_id', viewerId).limit(2000),
    admin.from('user_blocks').select('blocked_id').eq('blocker_id', viewerId).limit(2000),
    admin.from('user_blocks').select('blocker_id').eq('blocked_id', viewerId).limit(2000),
  ]);
  if (mutes.error && mutes.error.code !== '42P01' && mutes.error.code !== 'PGRST205') console.error(`${TAG} mutes read failed:`, mutes.error.message);
  if (blocksOut.error) console.error(`${TAG} blocks read failed:`, blocksOut.error.message);
  if (blocksIn.error) console.error(`${TAG} blocks read failed:`, blocksIn.error.message);
  for (const r of mutes.data ?? []) out.add(r.muted_id as string);
  for (const r of blocksOut.data ?? []) out.add(r.blocked_id as string);
  for (const r of blocksIn.data ?? []) out.add(r.blocker_id as string);
  return out;
}

export async function applyMute(admin: Admin, muterId: string, mutedId: string): Promise<{ ok: boolean; notLive?: boolean }> {
  if (muterId === mutedId) return { ok: false };
  const { error } = await admin.from('user_mutes').upsert({ muter_id: muterId, muted_id: mutedId }, { onConflict: 'muter_id,muted_id', ignoreDuplicates: true });
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return { ok: false, notLive: true };
    console.error(`${TAG} mute failed:`, error.message);
    return { ok: false };
  }
  return { ok: true };
}

export async function removeMute(admin: Admin, muterId: string, mutedId: string): Promise<{ ok: boolean }> {
  const { error } = await admin.from('user_mutes').delete().eq('muter_id', muterId).eq('muted_id', mutedId);
  if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
    console.error(`${TAG} unmute failed:`, error.message);
    return { ok: false };
  }
  return { ok: true };
}

export async function listMutes(admin: Admin, muterId: string): Promise<{ supported: boolean; mutedIds: string[] }> {
  const { data, error } = await admin.from('user_mutes').select('muted_id').eq('muter_id', muterId).order('created_at', { ascending: false }).limit(500);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return { supported: false, mutedIds: [] };
    console.error(`${TAG} list failed:`, error.message);
    return { supported: true, mutedIds: [] };
  }
  return { supported: true, mutedIds: (data ?? []).map(r => r.muted_id as string) };
}
