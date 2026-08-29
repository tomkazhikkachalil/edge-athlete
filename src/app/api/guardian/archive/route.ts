import { NextRequest, NextResponse } from 'next/server';
import { requireGuardianAccount, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { toProxyUrl } from '@/lib/media/proxy-url';

// ── GET /api/guardian/archive ────────────────────────────────────────────────
// The household archive (Wave 9): every post across the caller's household,
// newest first — a family's shared history in one place. A DEDICATED route,
// deliberately NOT a multi-profile mode on posts GET: that is the app's most
// privacy-sensitive query surface and a guardian-only feature has no business
// widening it. View-only seats read too (requireGuardianAccount opt-in,
// Wave 8) — following the kids' journey is exactly what a viewer is for.
//
// Unpublished work (pending_approval / changes_requested / rejected) is
// INCLUDED with its status — guardians seeing the whole pipeline is the
// point of the surface, and nothing here publishes anything. Media URLs are
// the same proxy tokens every other surface serves; the proxy re-authorizes
// per request (and admits household viewers since Wave 9).

const MAX_LIMIT = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/;

export async function GET(request: NextRequest) {
  try {
    const { athleteIds } = await requireGuardianAccount(request, ['guardian', 'viewer']);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const child = searchParams.get('child');
    if (child && !UUID_RE.test(child)) {
      return NextResponse.json({ error: 'Invalid child id' }, { status: 400 });
    }
    // The scoping IS the authorization (household doctrine): a child filter
    // outside the caller's roster yields nothing, never someone else's data.
    const targets = child ? athleteIds.filter(id => id === child) : athleteIds;
    if (targets.length === 0) {
      return NextResponse.json({ items: [], nextCursor: null });
    }
    const rawLimit = Number(searchParams.get('limit'));
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : 30;
    const cursor = searchParams.get('cursor');
    if (cursor && !ISO_RE.test(cursor)) {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    let query = admin
      .from('posts')
      .select('id, profile_id, caption, status, created_at, post_media (media_url, thumbnail_url, media_type, display_order)')
      .in('profile_id', targets)
      .order('created_at', { ascending: false })
      .limit(limit + 1);
    if (cursor) query = query.lt('created_at', cursor);
    const { data: rows, error } = await query;
    if (error) throw error;

    const page = (rows ?? []).slice(0, limit);
    const items = page.map(p => {
      const media = [...(p.post_media ?? [])]
        .sort((a, b) => a.display_order - b.display_order)
        .map(m => ({
          type: m.media_type === 'video' ? 'video' : 'image',
          url: toProxyUrl(m.media_url, { type: 'post', id: p.id }) ?? m.media_url,
          thumbnailUrl: m.thumbnail_url
            ? toProxyUrl(m.thumbnail_url, { type: 'post', id: p.id }) ?? m.thumbnail_url
            : null,
        }));
      return {
        id: p.id,
        profileId: p.profile_id,
        caption: p.caption,
        status: p.status,
        createdAt: p.created_at,
        media,
      };
    });

    return NextResponse.json({
      items,
      nextCursor: (rows ?? []).length > limit ? page[page.length - 1].created_at : null,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] archive error:', error);
    return NextResponse.json({ error: 'Could not load the archive' }, { status: 500 });
  }
}
