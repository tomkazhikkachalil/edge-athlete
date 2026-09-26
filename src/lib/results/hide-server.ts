// ── Hide a result from a profile — THE one writer (results-kept round, 241) ──
// A person controls how their profile LOOKS; the backend keeps what was
// recorded. `setResultHidden` stamps a round (golf_rounds.profile_hidden_at)
// or a result post (status 'profile_hidden' + profile_hidden_at) and NEVER
// touches the handicap, the leaderboards or athlete_performances (pinned).
// Idempotent. A post a MODERATOR hid ('hidden') is not the owner's to show
// again (409). An official result's hide / show is recorded in the authority
// log against its event (Tom: both sides accountable).

import type { SupabaseClient } from '@supabase/supabase-js';
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

/** The owner's hidden results (Settings → Privacy): rounds and result posts, newest first. */
export async function readHiddenResults(admin: Admin, profileId: string): Promise<{ rounds: Array<{ id: string; date: string; course: string | null; gross_score: number | null; hidden_at: string }>; posts: Array<{ id: string; caption: string | null; sport_key: string | null; created_at: string; hidden_at: string }> }> {
  const [rounds, posts] = await Promise.all([
    admin.from('golf_rounds').select('id, date, course, gross_score, profile_hidden_at').eq('profile_id', profileId).not('profile_hidden_at', 'is', null).order('profile_hidden_at', { ascending: false }).limit(100),
    admin.from('posts').select('id, caption, sport_key, created_at, profile_hidden_at').eq('profile_id', profileId).eq('status', 'profile_hidden').order('profile_hidden_at', { ascending: false }).limit(100),
  ]);
  return {
    rounds: ((rounds.data ?? []) as Array<{ id: string; date: string; course: string | null; gross_score: number | null; profile_hidden_at: string }>).map(r => ({ id: r.id, date: r.date, course: r.course, gross_score: r.gross_score, hidden_at: r.profile_hidden_at })),
    posts: ((posts.data ?? []) as Array<{ id: string; caption: string | null; sport_key: string | null; created_at: string; profile_hidden_at: string }>).map(p => ({ id: p.id, caption: p.caption, sport_key: p.sport_key, created_at: p.created_at, hidden_at: p.profile_hidden_at })),
  };
}
