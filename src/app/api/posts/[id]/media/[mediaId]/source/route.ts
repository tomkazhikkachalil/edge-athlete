import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { isOwnPostsUploadUrl } from '@/lib/media/upload-rules';
import { mayManagePostMedia } from '../../authz';
import { reportRouteError } from '@/lib/observability/report';

// ── PATCH /api/posts/[id]/media/[mediaId]/source ──────────────────────────────
// The background original (Oct 4 2026): an edited video's post goes out as
// soon as the RENDER and its poster are up; the untouched original (the
// non-destructive source, migration 120) follows from the device afterwards
// and lands here. Set ONCE — a row that already has a source answers 409 —
// and only as the post owner's own finished upload (`posts/<owner>/…`), so a
// caller can never point a post at another owner's object or an outside URL.
// A tab closed before this lands leaves source_url null: re-edit starts from
// the render, the documented degradation.

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id, mediaId } = await params;
    if (!isUuid(id) || !isUuid(mediaId)) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const supabase = getSupabaseAdmin();

    const { data: row, error } = await supabase
      .from('post_media')
      .select('id, post_id, source_url, posts:post_id (id, profile_id)')
      .eq('id', mediaId)
      .eq('post_id', id)
      .maybeSingle();
    if (error) throw error;
    const post = (Array.isArray(row?.posts) ? row?.posts[0] : row?.posts) as { id: string; profile_id: string } | null | undefined;
    if (!row || !post) return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    if (!(await mayManagePostMedia(user.id, post.profile_id))) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }
    if (!isOwnPostsUploadUrl(body.sourceUrl, post.profile_id)) {
      return NextResponse.json({ error: 'Not an upload of this post' }, { status: 400 });
    }
    if (row.source_url) {
      return NextResponse.json({ error: 'This media already has its original' }, { status: 409 });
    }

    const { error: writeError, count } = await supabase
      .from('post_media')
      .update({ source_url: body.sourceUrl }, { count: 'exact' })
      .eq('id', mediaId)
      .is('source_url', null);
    if (writeError) throw writeError;
    if (!count) return NextResponse.json({ error: 'This media already has its original' }, { status: 409 });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Media source attach error:', error);
    return NextResponse.json({ error: 'Failed to attach the original' }, { status: 500 });
  }
}
