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
    // 286: the like bucket rides requireAuth's round trip; the route's own check reads the memo
    expect(route).toMatch(/const user = await requireAuth\(request, \{ limit: 'like' \}\);[^\n]*\n\s*const limited = await enforceRateLimit\(request, 'like', \{ userId: user\.id \}\);/);
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

describe('migration 287 (the gate) over 282 (the toggle)', () => {
  const m = read('database/migrations/287_post_like_allowed.sql');
  it('post_like_allowed = the read gate minus blocks: owner / guardian always; else published, owner present, public+public or an accepted follow; never across a block', () => {
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION public\.post_like_allowed\(p_viewer uuid, p_post_id uuid\)\s*RETURNS boolean\s*LANGUAGE sql STABLE SECURITY INVOKER\s*SET search_path = public/);
    expect(m).toMatch(/p\.profile_id = p_viewer\s*OR EXISTS \(SELECT 1 FROM public\.profile_access a WHERE a\.user_id = p_viewer AND a\.profile_id = p\.profile_id\)/);
    expect(m).toMatch(/COALESCE\(p\.status, 'published'\) = 'published'\s*AND o\.departed_at IS NULL/);
    expect(m).toMatch(/\(COALESCE\(p\.visibility, ''\) = 'public' AND COALESCE\(o\.visibility, ''\) = 'public'\)\s*OR EXISTS \(SELECT 1 FROM public\.follows f\s*WHERE f\.follower_id = p_viewer AND f\.following_id = p\.profile_id AND f\.status = 'accepted'\)/);
    expect(m).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.user_blocks b\s*WHERE \(b\.blocker_id = p_viewer AND b\.blocked_id = p\.profile_id\)\s*OR \(b\.blocker_id = p\.profile_id AND b\.blocked_id = p_viewer\)\)/);
    expect(m).not.toMatch(/user_mutes/); // a mute never refuses a like
  });
  it('the toggle is 282\'s, calling the gate; service_role only; the ledger', () => {
    expect(m).toMatch(/IF NOT public\.post_like_allowed\(p_viewer, p_post_id\) THEN\s*RETURN jsonb_build_object\('outcome', 'not_found'\);/);
    expect(m).toMatch(/DELETE FROM public\.post_likes WHERE post_id = p_post_id AND profile_id = p_viewer;\s*IF FOUND THEN\s*v_outcome := 'unliked';/);
    expect(m).toMatch(/ON CONFLICT \(post_id, profile_id\) DO NOTHING;\s*v_outcome := CASE WHEN FOUND THEN 'liked' ELSE 'already_liked' END;/);
    expect(m).toMatch(/SELECT COALESCE\(likes_count, 0\) INTO v_count FROM public\.posts WHERE id = p_post_id;/);
    expect(m).not.toMatch(/UPDATE public\.posts/);
    for (const fn of ['post_like_allowed', 'post_like_toggle']) {
      expect(m).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(uuid, uuid\\) FROM PUBLIC, anon, authenticated;`));
      expect(m).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(uuid, uuid\\) TO service_role;`));
    }
    expect(m).toMatch(/VALUES \(287, '287_post_like_allowed\.sql'\)/);
  });
});
