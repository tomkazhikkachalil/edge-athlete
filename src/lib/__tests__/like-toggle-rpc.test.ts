import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Trip-count program PR 3 (Oct 27 2026): POST /api/posts/like is ONE call —
// migration 282's post_like_toggle applies the route's visibility gate,
// removes or inserts the like and reads the trigger-written count; the route
// maps the outcome onto the wire shape it always had.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('the like toggle is one call', () => {
  const route = read('src/app/api/posts/like/route.ts');
  it('one post_like_toggle call and no table read of its own', () => {
    expect(route.match(/\.rpc\('post_like_toggle', \{ p_viewer: user\.id, p_post_id: postId \}\)/g)?.length).toBe(1);
    expect(route).not.toMatch(/\.from\('/);
    expect(route).not.toMatch(/readLikesCount/);
  });
  it('the wire contract is unchanged: the gates before the call, the four outcomes, the exact bodies', () => {
    expect(route).toMatch(/const user = await requireAuth\(request\);\s*const limited = await enforceRateLimit\(request, 'like', \{ userId: user\.id \}\);/);
    // bad id → 404 BEFORE the missing-id 400, as before 282
    expect(route.indexOf("if (postId && !isUuid(postId))")).toBeLessThan(route.indexOf("if (!postId)"));
    expect(route).toMatch(/\{ error: 'Post ID is required' \}, \{ status: 400 \}/);
    expect(route).toMatch(/case 'unliked':\s*return NextResponse\.json\(\{ action: 'unliked', message: 'Post unliked successfully', likesCount \}\);/);
    expect(route).toMatch(/case 'liked':\s*return NextResponse\.json\(\{ action: 'liked', message: 'Post liked successfully', likesCount \}\);/);
    expect(route).toMatch(/case 'already_liked':[\s\S]*?return NextResponse\.json\(\{ action: 'liked', message: 'Post already liked', likesCount \}\);/);
    expect(route).toMatch(/default:\s*return NextResponse\.json\(\{ error: 'Post not found' \}, \{ status: 404 \}\);/);
    expect(route).toMatch(/error\.code === 'PGRST202'[\s\S]*?\{ error: 'Like service updating' \}, \{ status: 503, headers: \{ 'Cache-Control': 'no-store' \} \}/);
    expect(route).toMatch(/if \(error instanceof Response\) return error;/);
  });
});

describe('migration 282', () => {
  const m = read('database/migrations/282_post_like_toggle.sql');
  it('a service_role-only VOLATILE INVOKER writer with the route\'s gate, remove-or-insert, and the column read', () => {
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION public\.post_like_toggle\(p_viewer uuid, p_post_id uuid\)\s*RETURNS jsonb\s*LANGUAGE plpgsql VOLATILE SECURITY INVOKER\s*SET search_path = public/);
    expect(m).toMatch(/IF v_owner IS DISTINCT FROM p_viewer\s*AND NOT \(COALESCE\(v_post_visibility, ''\) = 'public' AND COALESCE\(v_owner_visibility, ''\) = 'public'\)/);
    expect(m).toMatch(/f\.follower_id = p_viewer AND f\.following_id = v_owner AND f\.status = 'accepted'/);
    expect(m).toMatch(/DELETE FROM public\.post_likes WHERE post_id = p_post_id AND profile_id = p_viewer;\s*IF FOUND THEN\s*v_outcome := 'unliked';/);
    expect(m).toMatch(/ON CONFLICT \(post_id, profile_id\) DO NOTHING;\s*v_outcome := CASE WHEN FOUND THEN 'liked' ELSE 'already_liked' END;/);
    expect(m).toMatch(/SELECT COALESCE\(likes_count, 0\) INTO v_count FROM public\.posts WHERE id = p_post_id;/);
    expect(m).not.toMatch(/UPDATE public\.posts/);
    expect(m).not.toMatch(/INSERT INTO public\.notifications/);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.post_like_toggle\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.post_like_toggle\(uuid, uuid\) TO service_role;/);
    expect(m).toMatch(/VALUES \(282, '282_post_like_toggle\.sql'\)/);
  });
});
