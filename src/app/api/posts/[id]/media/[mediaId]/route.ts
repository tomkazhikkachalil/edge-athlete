import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { recipeEnvelope, parseRecipeEnvelope } from '@/lib/media/recipes';
import { mayManagePostMedia } from '../authz';

// ── PATCH /api/posts/[id]/media/[mediaId] ─────────────────────────────────────
// Re-edit after publish (non-destructive round, migration 120): replace the
// RENDER on the same row — media_url/thumbnail_url/edit_recipe/metadata —
// so post_tags.media_id and display_order survive. The untouched original
// is preserved: a pre-120 row (source_url null ⇒ media_url IS the original)
// gets its old media_url moved INTO source_url on first re-edit. The
// replaced render is never deleted here — the storage sweep collects it
// after the 48h grace, which also protects a just-uploaded render if this
// PATCH fails between upload and write.
//
// SAFETY: a supervised author's media replacement changes what guardians
// approved, so their post flips back to pending_approval + guardian bell
// (mirrors the create path). A guardian editing via write_content is the
// guardian's own action — never re-held, same doctrine as comments.

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id, mediaId } = await params;
    const admin = getSupabaseAdmin();

    const body = await request.json().catch(() => ({}));
    const mediaUrl = typeof body.mediaUrl === 'string' ? body.mediaUrl.trim() : '';
    if (!mediaUrl) {
      return NextResponse.json({ error: 'mediaUrl is required' }, { status: 400 });
    }

    const { data: row } = await admin
      .from('post_media')
      .select('id, post_id, media_url, source_url, posts:post_id (id, profile_id, status)')
      .eq('id', mediaId)
      .eq('post_id', id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    const post = (Array.isArray(row.posts) ? row.posts[0] : row.posts) as {
      id: string;
      profile_id: string;
      status?: string | null;
    } | null;
    if (!post) return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    if (!(await mayManagePostMedia(user.id, post.profile_id))) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }

    // Recipes are validated, never trusted; malformed → stored null.
    const recipe = parseRecipeEnvelope(body.editRecipe);
    const dim = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null;

    const { data: updated, error } = await admin
      .from('post_media')
      .update({
        media_url: mediaUrl,
        thumbnail_url:
          typeof body.thumbnailUrl === 'string' && body.thumbnailUrl ? body.thumbnailUrl : null,
        edit_recipe: recipe ? recipeEnvelope(recipe) : null,
        width: dim(body.width),
        height: dim(body.height),
        duration: dim(body.duration),
        // First re-edit of a pre-120 row: the old media_url IS the original —
        // move it into source_url before it gets overwritten, or the sweep
        // collects it and re-editability is lost for good.
        ...(row.source_url === null && mediaUrl !== row.media_url
          ? { source_url: row.media_url }
          : {}),
      })
      .eq('id', mediaId)
      .select('id, media_url, media_type, thumbnail_url, display_order, source_url, edit_recipe')
      .single();
    if (error || !updated) {
      console.error('[POST MEDIA] update failed:', error);
      return NextResponse.json({ error: 'Could not update the media' }, { status: 500 });
    }

    // Supervised author replacing their own media → back through the
    // approval queue (best-effort bell; the media update itself stands).
    let statusChanged = false;
    if (
      FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES &&
      user.id === post.profile_id &&
      post.status === 'published'
    ) {
      const { getProfileRole } = await import('@/lib/auth-server');
      if ((await getProfileRole(user.id, user.id)) === 'supervised') {
        const { error: statusError } = await admin
          .from('posts')
          .update({ status: 'pending_approval' })
          .eq('id', post.id);
        if (!statusError) {
          statusChanged = true;
          try {
            const { notifyGuardians, profileFirstName } = await import('@/lib/guardian-notify');
            const childName = await profileFirstName(admin, user.id);
            await notifyGuardians(admin, user.id, {
              type: 'post_pending_approval',
              title: `${childName} changed a post's media — it needs your review again`,
              actionUrl: '/app/guardian/approvals',
              actorId: user.id,
              metadata: { post_id: post.id },
            });
          } catch (e) {
            console.error('[POST MEDIA] guardian notify failed:', e);
          }
        }
      }
    }

    return NextResponse.json({ media: updated, pending_approval: statusChanged });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[POST MEDIA] update error:', error);
    return NextResponse.json({ error: 'Could not update the media' }, { status: 500 });
  }
}
