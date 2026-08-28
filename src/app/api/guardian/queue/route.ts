import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { toProxyUrl } from '@/lib/media/proxy-url';
import { ACTIVE_TRANSFER_STATES } from '@/lib/transfers';
import {
  buildHeldContactRows,
  buildQueueItems,
  flattenInviteRows,
  type QueuePostRow,
  type RawCounterpartRow,
  type RawHeldRow,
  type RawInviteRow,
  type RosterRow,
} from '@/lib/guardian-queue';

// ── /api/guardian/queue ──────────────────────────────────────────────────────
// The unified guardian action queue (Family Console Wave 2): every item that
// needs a guardian's attention across their whole roster, typed and ordered.
// One roster query + batched IN-queries, reduced by the pure shaper in
// guardian-queue.ts — constant query count however many athletes the guardian
// manages. Authorization is the profile_access guardian row; the inline
// actions the console fires (posts/comments PATCH, followers POST) each
// re-verify it server-side, so listing here never over-grants.

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ items: [] });
    }
    const admin = getSupabaseAdmin();

    const { data: accessRows, error: accessError } = await admin
      .from('profile_access')
      .select('profiles!profile_access_profile_id_fkey(id, first_name, last_name, full_name, handle, avatar_url, supervision_state, deletion_requested_at)')
      .eq('user_id', user.id)
      .eq('role', 'guardian')
      .order('granted_at', { ascending: true });
    if (accessError) throw accessError;

    // Parked athletes (30-day soft delete) have exactly one action — restore —
    // which lives in its own hub section, not the queue.
    const roster = (accessRows ?? [])
      .map(r => r.profiles as unknown as RosterRow & { deletion_requested_at: string | null })
      .filter(p => p && !p.deletion_requested_at);
    const ids = roster.map(p => p.id);
    if (ids.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const [postsQ, commentsQ, followsQ, consentQ, supervisedQ, transferQ, invitesQ, heldQ] = await Promise.all([
      // changes_requested rows (mig 129) ride along as the muted
      // "waiting on their edit" rows — the shaper splits them out.
      admin
        .from('posts')
        .select('id, profile_id, caption, created_at, status, post_media (media_url, thumbnail_url, media_type, display_order)')
        .in('profile_id', ids)
        .in('status', ['pending_approval', 'changes_requested'])
        .order('created_at', { ascending: true }),
      admin
        .from('post_comments')
        .select('id, profile_id, content, created_at, status')
        .in('profile_id', ids)
        .in('status', ['pending_approval', 'changes_requested'])
        .order('created_at', { ascending: true }),
      admin
        .from('follows')
        .select('id, following_id, message, created_at, follower:follower_id (id, first_name, last_name, full_name, handle, avatar_url)')
        .in('following_id', ids)
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
      admin
        .from('consent_records')
        .select('profile_id, action')
        .in('profile_id', ids)
        .order('created_at', { ascending: false }),
      admin
        .from('profile_access')
        .select('user_id, profile_id')
        .in('profile_id', ids)
        .eq('role', 'supervised'),
      admin
        .from('profile_transfers')
        .select('profile_id, state')
        .in('profile_id', ids)
        .in('state', [...ACTIVE_TRANSFER_STATES]),
      // Pending event invites (guest status 'invited') — flag-gated with the
      // calendar feature; future/cancelled filtering happens in the pure
      // flattener (embed shape guarded there too).
      FEATURE_FLAGS.FEATURE_CALENDAR
        ? admin
            .from('event_guests')
            .select('id, profile_id, created_at, events!inner(id, title, starts_at, ends_at, all_day, timezone, status)')
            .in('profile_id', ids)
            .eq('status', 'invited')
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      // First-contact holds (mig 131): the children's held rows. The
      // counterpart batch below is the only follow-up query — still constant
      // count regardless of roster size.
      admin
        .from('conversation_participants')
        .select('conversation_id, profile_id, held_at, conversations!inner(type)')
        .in('profile_id', ids)
        .not('held_at', 'is', null)
        .order('held_at', { ascending: true }),
    ]);
    for (const q of [postsQ, commentsQ, followsQ, consentQ, supervisedQ, transferQ, invitesQ, heldQ]) {
      if (q.error) throw q.error;
    }

    // Counterpart batch for the held conversations (one query, however many).
    const heldRows = (heldQ.data ?? []) as unknown as RawHeldRow[];
    const heldConvIds = [...new Set(heldRows.map(r => r.conversation_id))];
    let counterpartRows: RawCounterpartRow[] = [];
    if (heldConvIds.length > 0) {
      const { data: counterparts, error: counterpartError } = await admin
        .from('conversation_participants')
        .select('conversation_id, profile_id, profiles:profile_id (id, first_name, last_name, full_name, handle, avatar_url)')
        .in('conversation_id', heldConvIds)
        .not('profile_id', 'in', `(${ids.join(',')})`);
      if (counterpartError) throw counterpartError;
      counterpartRows = (counterparts ?? []) as unknown as RawCounterpartRow[];
    }

    // Flatten each post's media to a count + first proxied thumbnail — the
    // queue row is a glance, the approvals page is the full review surface.
    const posts: QueuePostRow[] = (postsQ.data ?? []).map(p => {
      const row = p as {
        id: string;
        profile_id: string;
        caption: string | null;
        created_at: string;
        status: string;
        post_media?: Array<{ media_url: string; thumbnail_url: string | null; display_order: number }>;
      };
      const media = [...(row.post_media ?? [])].sort((a, b) => a.display_order - b.display_order);
      const first = media[0] ?? null;
      return {
        id: row.id,
        profile_id: row.profile_id,
        caption: row.caption,
        created_at: row.created_at,
        status: row.status,
        mediaCount: media.length,
        thumbnailUrl: first
          ? toProxyUrl(first.thumbnail_url ?? first.media_url, { type: 'post', id: row.id }) ??
            (first.thumbnail_url ?? first.media_url)
          : null,
      };
    });

    const items = buildQueueItems(
      roster,
      posts,
      commentsQ.data ?? [],
      followsQ.data ?? [],
      consentQ.data ?? [],
      supervisedQ.data ?? [],
      transferQ.data ?? [],
      flattenInviteRows((invitesQ.data ?? []) as unknown as RawInviteRow[], Date.now()),
      buildHeldContactRows(heldRows, counterpartRows)
    );
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] queue error:', error);
    return NextResponse.json({ error: 'Could not load the action queue' }, { status: 500 });
  }
}
