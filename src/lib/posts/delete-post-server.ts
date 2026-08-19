import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The full post-deletion cascade, extracted verbatim from DELETE /api/posts
 * so the round-delete path (src/lib/golf/round-delete-server.ts) can delete a
 * round's feed post through the exact same storage-safe code. AUTHZ IS THE
 * CALLER'S JOB — this runs on the admin client and deletes whatever post id
 * it is handed.
 *
 * Storage: media FILES are removed best-effort, and only when nothing else
 * still references the same URL — shared-workout posts reuse the workout's
 * per-set media URLs, so deleting the post must not strip the clips out of
 * the workout history.
 */
export async function deletePostCascade(
  admin: SupabaseClient,
  postId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: mediaRows } = await admin
    .from('post_media')
    .select('media_url')
    .eq('post_id', postId);
  if (mediaRows && mediaRows.length > 0) {
    const urls = [...new Set(mediaRows.map(r => r.media_url).filter(Boolean))] as string[];
    const referenced = await Promise.all(
      urls.map(async url => {
        const [postRef, setRef] = await Promise.all([
          admin
            .from('post_media')
            .select('id', { count: 'exact', head: true })
            .eq('media_url', url)
            .neq('post_id', postId),
          admin
            .from('workout_sets')
            .select('id', { count: 'exact', head: true })
            // JSON string, NOT an array: supabase-js turns an array arg into
            // a Postgres array literal ({...}), which 22P02s on a jsonb column
            .contains('media', JSON.stringify([{ url }])),
        ]);
        // Can't verify → keep the file rather than break another reference
        if (postRef.error || setRef.error) return true;
        return (postRef.count ?? 0) > 0 || (setRef.count ?? 0) > 0;
      })
    );
    const byBucket = new Map<string, string[]>();
    urls.forEach((url, i) => {
      if (referenced[i]) return;
      const m = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/.exec(url);
      if (m) {
        const paths = byBucket.get(m[1]) || [];
        paths.push(decodeURIComponent(m[2]));
        byBucket.set(m[1], paths);
      }
    });
    for (const [bucket, paths] of byBucket) {
      const { error: storageError } = await admin.storage.from(bucket).remove(paths);
      if (storageError) console.warn('[DELETE] Storage cleanup failed:', storageError);
    }
  }

  // Delete associated media records first (cascade should handle this, but being explicit)
  await admin.from('post_media').delete().eq('post_id', postId);

  // Delete associated likes
  await admin.from('post_likes').delete().eq('post_id', postId);

  // Delete the post
  const { error: deleteError } = await admin.from('posts').delete().eq('id', postId);
  if (deleteError) {
    console.error('[DELETE] Post deletion error:', deleteError);
    return { ok: false, error: 'Failed to delete post' };
  }
  return { ok: true };
}
