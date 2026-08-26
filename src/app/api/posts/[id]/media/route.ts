import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { toProxyUrl } from '@/lib/media/proxy-url';
import { mayManagePostMedia } from './authz';

// ── GET /api/posts/[id]/media ─────────────────────────────────────────────────
// The EDIT surface's media list — includes source_url + edit_recipe (120),
// which the public post payloads deliberately never carry. Owner (or a
// guardian with write_content) only; everyone else 404s, mirroring the
// posts API's never-reveal rule.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid post ID' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();

    const { data: post } = await admin
      .from('posts')
      .select('id, profile_id')
      .eq('id', id)
      .maybeSingle();
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    if (!(await mayManagePostMedia(user.id, post.profile_id))) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    const { data: media, error } = await admin
      .from('post_media')
      .select('id, media_url, media_type, thumbnail_url, display_order, source_url, edit_recipe')
      .eq('post_id', id)
      .order('display_order', { ascending: true });
    if (error) throw error;

    // Proxy every URL column so the media manager / editor re-edit fetch stays
    // same-origin (owner-only route → the post resolver grants the owner).
    const proxied = (media ?? []).map(m => ({
      ...m,
      media_url: toProxyUrl(m.media_url, { type: 'post', id }) ?? m.media_url,
      thumbnail_url: toProxyUrl(m.thumbnail_url, { type: 'post', id }),
      source_url: toProxyUrl(m.source_url, { type: 'post', id }),
    }));
    return NextResponse.json({ media: proxied });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[POST MEDIA] list error:', error);
    return NextResponse.json({ error: 'Could not load media' }, { status: 500 });
  }
}
