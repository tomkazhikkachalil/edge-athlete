import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { canViewProfile } from '@/lib/privacy';
import { filterBlockedBidirectional } from '@/lib/blocks';
import { partnerName, recentPartnerIds, RECENT_PARTNER_ROUNDS_SCANNED, type QuickAddPerson } from '@/lib/golf/recent-partners';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/golf/partners/recent — the people in the caller's own latest golf
 * rounds, for the Players step's QUICK ADD row (golf part 2, Nov 24 2026).
 *   → { partners: [{ id, name, avatar_url? }] } (≤ 8), private, no-store.
 *
 * Derived, never stored: the caller's newest participant rows (the creator
 * of a round is one of its participants), narrowed to golf rounds, then the
 * OTHER participants of those rounds — newest shared round first, each
 * person once (`recentPartnerIds`). The same two gates a tag passes: nobody
 * blocked in either direction, and nobody the caller may not view. A failed
 * read answers an empty list: the row is a shortcut, and "Add others" is
 * the door that always works.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'recent-partners', { userId: user.id });
    if (limited) return limited;
    const admin = getSupabaseAdmin();
    const empty = () => NextResponse.json({ partners: [] as QuickAddPerson[] }, { headers: NO_STORE });

    const mine = await admin
      .from('group_post_participants')
      .select('group_post_id, created_at')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false })
      .limit(RECENT_PARTNER_ROUNDS_SCANNED);
    if (mine.error) {
      reportRouteError('[GET /api/golf/partners/recent]', mine.error);
      return empty();
    }
    const postIds = (mine.data ?? []).map(r => r.group_post_id as string);
    if (postIds.length === 0) return empty();

    const rounds = await admin.from('group_posts').select('id, created_at').in('id', postIds).eq('type', 'golf_round');
    if (rounds.error) {
      reportRouteError('[GET /api/golf/partners/recent]', rounds.error);
      return empty();
    }
    const roundAt = new Map((rounds.data ?? []).map(r => [r.id as string, r.created_at as string]));
    if (roundAt.size === 0) return empty();

    const others = await admin
      .from('group_post_participants')
      .select('group_post_id, profile_id, status')
      .in('group_post_id', [...roundAt.keys()])
      .neq('profile_id', user.id);
    if (others.error) {
      reportRouteError('[GET /api/golf/partners/recent]', others.error);
      return empty();
    }
    const candidates = recentPartnerIds(
      (others.data ?? []).map(r => ({ profile_id: r.profile_id, status: r.status, at: roundAt.get(r.group_post_id as string) })),
      user.id
    );
    if (candidates.length === 0) return empty();

    const { allowed } = await filterBlockedBidirectional(admin, user.id, candidates);
    const viewable = (
      await Promise.all(allowed.map(async id => ((await canViewProfile(id, user.id)).canView ? id : null)))
    ).filter((id): id is string => id !== null);
    if (viewable.length === 0) return empty();

    const profiles = await admin.from('profiles').select('id, first_name, last_name, full_name, avatar_url').in('id', viewable);
    if (profiles.error) {
      reportRouteError('[GET /api/golf/partners/recent]', profiles.error);
      return empty();
    }
    const byId = new Map((profiles.data ?? []).map(p => [p.id as string, p]));
    // `candidates` holds the order (newest shared round first).
    const partners: QuickAddPerson[] = candidates
      .filter(id => viewable.includes(id) && byId.has(id))
      .map(id => {
        const p = byId.get(id)!;
        return { id, name: partnerName(p), ...(p.avatar_url ? { avatar_url: p.avatar_url as string } : {}) };
      });
    return NextResponse.json({ partners }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/golf/partners/recent]', error);
    return NextResponse.json({ error: 'Could not read recent partners' }, { status: 500, headers: NO_STORE });
  }
}
