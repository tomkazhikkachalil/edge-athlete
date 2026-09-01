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
  type QueueRiskRow,
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
      .select('profiles!profile_access_profile_id_fkey(id, first_name, last_name, full_name, handle, avatar_url, supervision_state, deletion_requested_at, visibility, messaging_permission, comment_moderation, dob, jurisdiction)')
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

    const [postsQ, commentsQ, followsQ, consentQ, supervisedQ, transferQ, invitesQ, heldQ, riskQ] = await Promise.all([
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
        .select('id, profile_id, state, created_at, age_preset_prompt, handover_prompted_at')
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
      // Unacknowledged risk signals (Wave 7, mig 137) — metadata-only rows;
      // the pure shaper turns them into calm "worth a look" items.
      admin
        .from('risk_signals')
        .select('id, profile_id, kind, created_at')
        .in('profile_id', ids)
        .is('acknowledged_at', null)
        .order('created_at', { ascending: true })
        .limit(20),
    ]);
    // Pending roster offers (0.10) — flag-gated like calendar invites; the
    // org-name batch below is the only follow-up query (constant count).
    const rosterOffersQ = FEATURE_FLAGS.FEATURE_ROSTER_GUARDIAN_GATE
      ? await admin
          .from('memberships')
          .select('id, profile_id, league_id, club_id, joined_at')
          .in('profile_id', ids)
          .eq('kind', 'roster')
          .eq('status', 'pending')
          .eq('scope_type', 'org')
          .order('joined_at', { ascending: true })
      : { data: [], error: null };
    // Photo-consent asks (phase 4 R4): ACTIVE org-roster rows never
    // answered. Selecting photo_consent 42703s pre-159 — degrade to none
    // rather than failing the whole queue (kept OUT of the throw loop).
    const photoConsentQ = FEATURE_FLAGS.FEATURE_ROSTER_GUARDIAN_GATE
      ? await admin
          .from('memberships')
          .select('id, profile_id, league_id, club_id, joined_at, photo_consent')
          .in('profile_id', ids)
          .eq('kind', 'roster')
          .eq('status', 'active')
          .eq('scope_type', 'org')
          .is('photo_consent', null)
          .order('joined_at', { ascending: true })
      : { data: [], error: null };
    for (const q of [postsQ, commentsQ, followsQ, consentQ, supervisedQ, transferQ, invitesQ, heldQ, riskQ, rosterOffersQ]) {
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

    // Org names for the roster offers — one batched lookup per side.
    const rosterRows = (rosterOffersQ.data ?? []) as Array<{
      id: string;
      profile_id: string;
      league_id: string | null;
      club_id: string | null;
      joined_at: string;
    }>;
    const consentRows = (photoConsentQ.error ? [] : (photoConsentQ.data ?? [])) as Array<{
      id: string;
      profile_id: string;
      league_id: string | null;
      club_id: string | null;
      joined_at: string;
    }>;
    const offerLeagueIds = [
      ...new Set([...rosterRows, ...consentRows].map(r => r.league_id).filter(Boolean)),
    ] as string[];
    const offerClubIds = [
      ...new Set([...rosterRows, ...consentRows].map(r => r.club_id).filter(Boolean)),
    ] as string[];
    const orgNames = new Map<string, string>();
    if (offerLeagueIds.length > 0 || offerClubIds.length > 0) {
      const [leagueNames, clubNames] = await Promise.all([
        offerLeagueIds.length > 0
          ? admin.from('leagues').select('id, name').in('id', offerLeagueIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        offerClubIds.length > 0
          ? admin.from('clubs').select('id, name').in('id', offerClubIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);
      for (const r of [...(leagueNames.data ?? []), ...(clubNames.data ?? [])]) {
        orgNames.set(r.id as string, r.name as string);
      }
    }
    const rosterOffers = rosterRows.map(r => ({
      ...r,
      orgName: orgNames.get((r.league_id ?? r.club_id) as string) ?? 'An organization',
    }));
    const photoConsentAsks = consentRows.map(r => ({
      ...r,
      orgName: orgNames.get((r.league_id ?? r.club_id) as string) ?? 'An organization',
    }));

    // Household policy (Wave 4): one constant query — age-preset prompt
    // items derive only when the CALLER's own older overrides differ.
    const { parseHouseholdPolicy } = await import('@/lib/household-policy');
    const { data: guardianRow } = await admin
      .from('profiles')
      .select('household_policy')
      .eq('id', user.id)
      .maybeSingle();

    const items = buildQueueItems(
      roster,
      posts,
      commentsQ.data ?? [],
      followsQ.data ?? [],
      consentQ.data ?? [],
      supervisedQ.data ?? [],
      transferQ.data ?? [],
      flattenInviteRows((invitesQ.data ?? []) as unknown as RawInviteRow[], Date.now()),
      buildHeldContactRows(heldRows, counterpartRows),
      parseHouseholdPolicy(guardianRow?.household_policy),
      (riskQ.data ?? []) as QueueRiskRow[],
      rosterOffers,
      photoConsentAsks
    );
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] queue error:', error);
    return NextResponse.json({ error: 'Could not load the action queue' }, { status: 500 });
  }
}
