// ── Hide a result from a profile — THE one writer (results-kept round, 241) ──
// A person controls how their profile LOOKS; the backend keeps what was
// recorded. `setResultHidden` stamps a round (golf_rounds.profile_hidden_at)
// or a result post (status 'profile_hidden' + profile_hidden_at) and NEVER
// touches the handicap, the leaderboards or athlete_performances (pinned).
// Idempotent. A post a MODERATOR hid ('hidden') is not the owner's to show
// again (409). An official result's hide / show is recorded in the authority
// log against its event (Tom: both sides accountable).

import type { SupabaseClient } from '@supabase/supabase-js';
import { pairHiddenResults, type HiddenPostRow, type HiddenResultsList, type HiddenRoundRow } from './hidden-list';
import { recordAuthority } from '@/lib/authority/audit-server';
import { resolveResultOrigin } from './origin-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-agnostic helper (the authz.ts Admin alias)
type Admin = SupabaseClient<any, 'public', any>;

export type HideTarget = { kind: 'post'; id: string } | { kind: 'golf_round'; id: string };

export type HideOutcome =
  | { ok: true; hidden: boolean; official: boolean }
  | { ok: false; status: 404 | 409 | 500; error: string };

const TAG = '[results hide]';

export async function setResultHidden(admin: Admin, target: HideTarget, hidden: boolean, actorProfileId: string): Promise<HideOutcome> {
  const now = new Date().toISOString();
  if (target.kind === 'golf_round') {
    const { data, error } = await admin
      .from('golf_rounds')
      .update({ profile_hidden_at: hidden ? now : null })
      .eq('id', target.id)
      .select('id');
    if (error) {
      console.error(`${TAG} round write failed:`, error.message);
      return { ok: false, status: error.code === '42703' ? 409 : 500, error: error.code === '42703' ? 'Hiding needs a database update (241).' : 'Could not update the round.' };
    }
    if (!data || data.length === 0) return { ok: false, status: 404, error: 'Round not found' };
  } else {
    const { data: post } = await admin.from('posts').select('id, status').eq('id', target.id).maybeSingle();
    const row = post as { id: string; status: string | null } | null;
    if (!row) return { ok: false, status: 404, error: 'Post not found' };
    if (row.status === 'hidden') return { ok: false, status: 409, error: 'Edge Athlete support hid this post — reply on your support request to discuss it.' };
    const from = hidden ? 'published' : 'profile_hidden';
    const to = hidden ? 'profile_hidden' : 'published';
    if (row.status === to) return { ok: true, hidden, official: false };
    if ((row.status ?? 'published') !== from) return { ok: false, status: 409, error: 'This post is waiting for review — it can’t be hidden or shown yet.' };
    const { error } = await admin.from('posts').update({ status: to, profile_hidden_at: hidden ? now : null }).eq('id', row.id).eq('status', from);
    if (error) {
      console.error(`${TAG} post write failed:`, error.message);
      return { ok: false, status: error.code === '23514' ? 409 : 500, error: error.code === '23514' ? 'Hiding needs a database update (241).' : 'Could not update the post.' };
    }
  }

  const origin = await resolveResultOrigin(admin, target.kind === 'post' ? { kind: 'post', id: target.id } : { kind: 'golf_round', id: target.id });
  if (origin.official && origin.eventId) {
    await recordAuthority(admin, {
      subject: { type: 'sport_event', id: origin.eventId },
      actor: { kind: 'member', profileId: actorProfileId },
      action: hidden ? 'result_hidden' : 'result_unhidden',
      targetProfileId: actorProfileId,
      detail: { fields: [target.kind], via: target.id },
    });
  }
  return { ok: true, hidden, official: origin.official };
}

/**
 * Hide or show the WHOLE result (fix round, Oct 2026). A round is two rows to
 * the people looking at it — its feed post and the owner's stats row — and
 * hiding one left the other in plain sight: "Hide" on the round page kept the
 * post published for everyone, and Settings listed the pair as two things to
 * show again. Every door goes through here; `setResultHidden` stays the one
 * row writer underneath.
 *
 * The named row must succeed. Its partner is the same owner's row only (a
 * playing partner hiding THEIR round never touches the creator's post) and
 * follows best-effort: a post waiting for a guardian cannot change status,
 * and that must not undo the hide the person asked for.
 */
export async function setWholeResultHidden(admin: Admin, target: HideTarget, hidden: boolean, ownerId: string): Promise<HideOutcome> {
  const first = await setResultHidden(admin, target, hidden, ownerId);
  if (!first.ok) return first;
  try {
    if (target.kind === 'post') {
      const { data: post } = await admin.from('posts').select('group_post_id, round_id').eq('id', target.id).maybeSingle();
      const p = post as { group_post_id: string | null; round_id: string | null } | null;
      const roundIds = new Set<string>();
      if (p?.group_post_id) {
        const { data: mirrors } = await admin.from('golf_rounds').select('id').eq('group_post_id', p.group_post_id).eq('profile_id', ownerId);
        for (const r of (mirrors ?? []) as { id: string }[]) roundIds.add(r.id);
      }
      if (p?.round_id) {
        const { data: own } = await admin.from('golf_rounds').select('id').eq('id', p.round_id).eq('profile_id', ownerId).maybeSingle();
        if (own) roundIds.add((own as { id: string }).id);
      }
      for (const id of roundIds) await setResultHidden(admin, { kind: 'golf_round', id }, hidden, ownerId);
    } else {
      const { data: round } = await admin.from('golf_rounds').select('group_post_id').eq('id', target.id).maybeSingle();
      const groupPostId = (round as { group_post_id: string | null } | null)?.group_post_id ?? null;
      const postIds = new Set<string>();
      if (groupPostId) {
        const { data: posts } = await admin.from('posts').select('id').eq('group_post_id', groupPostId).eq('profile_id', ownerId);
        for (const row of (posts ?? []) as { id: string }[]) postIds.add(row.id);
      }
      const { data: legacy } = await admin.from('posts').select('id').eq('round_id', target.id).eq('profile_id', ownerId);
      for (const row of (legacy ?? []) as { id: string }[]) postIds.add(row.id);
      for (const id of postIds) await setResultHidden(admin, { kind: 'post', id }, hidden, ownerId);
    }
  } catch (error) {
    console.error(`${TAG} pairing failed:`, error instanceof Error ? error.message : error);
  }
  return first;
}

/**
 * The owner's hidden results (Settings → Privacy), newest first — ONE row per
 * result: a round whose post is hidden too is listed as that post (carrying
 * the course and the score), never as a second thing to show again.
 */
export async function readHiddenResults(admin: Admin, profileId: string): Promise<HiddenResultsList> {
  const [rounds, posts] = await Promise.all([
    admin.from('golf_rounds').select('id, date, course, gross_score, profile_hidden_at, group_post_id').eq('profile_id', profileId).not('profile_hidden_at', 'is', null).order('profile_hidden_at', { ascending: false }).limit(100),
    admin.from('posts').select('id, caption, sport_key, created_at, profile_hidden_at, group_post_id, round_id').eq('profile_id', profileId).eq('status', 'profile_hidden').order('profile_hidden_at', { ascending: false }).limit(100),
  ]);
  return pairHiddenResults(
    (rounds.data ?? []) as HiddenRoundRow[],
    (posts.data ?? []) as HiddenPostRow[],
  );
}
