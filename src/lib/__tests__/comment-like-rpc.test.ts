import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The leftovers program PR 3 (Oct 28 2026, migration 288): POST
// /api/comments/like is ONE gated call — comment_like_toggle requires the
// parent post to pass post_like_allowed (287) and the comment to be
// published; the route maps the outcome onto its unchanged wire shape.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('the comment like is one gated call', () => {
  const route = read('src/app/api/comments/like/route.ts');
  it('one comment_like_toggle call, requireAuth with the like bucket, no table read of its own', () => {
    expect(route.match(/\.rpc\('comment_like_toggle', \{ p_viewer: user\.id, p_comment_id: commentId \}\)/g)?.length).toBe(1);
    expect(route).toMatch(/requireAuth\(request, \{ limit: 'like' \}\)/);
    expect(route).not.toMatch(/getServerAuth/);
    expect(route).not.toMatch(/\.from\('/);
    expect(route).toMatch(/if \(error instanceof Response\) return error;/);
  });
  it('the wire shape is the one it always had; a refusal is the 404 a missing comment answers; 503 ahead of 288', () => {
    expect(route).toMatch(/\{ error: 'Comment ID is required' \}, \{ status: 400 \}/);
    expect(route).toMatch(/case 'unliked':\s*return NextResponse\.json\(\{ isLiked: false, likes_count \}\);/);
    expect(route).toMatch(/case 'liked':\s*case 'already_liked':\s*return NextResponse\.json\(\{ isLiked: true, likes_count \}\);/);
    expect(route).toMatch(/default:\s*return NextResponse\.json\(\{ error: 'Comment not found' \}, \{ status: 404 \}\);/);
    expect(route).toMatch(/error\.code === 'PGRST202'[\s\S]*?\{ error: 'Like service updating' \}, \{ status: 503, headers: \{ 'Cache-Control': 'no-store' \} \}/);
  });
});

describe('migration 288', () => {
  const m = read('database/migrations/288_comment_like_toggle.sql');
  it('the parent post\'s gate (287) + a published comment, remove-or-insert, the column read; service_role only', () => {
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION public\.comment_like_toggle\(p_viewer uuid, p_comment_id uuid\)\s*RETURNS jsonb\s*LANGUAGE plpgsql VOLATILE SECURITY INVOKER\s*SET search_path = public/);
    expect(m).toMatch(/IF NOT FOUND\s*OR COALESCE\(v_status, 'published'\) <> 'published'\s*OR NOT public\.post_like_allowed\(p_viewer, v_post_id\) THEN\s*RETURN jsonb_build_object\('outcome', 'not_found'\);/);
    expect(m).toMatch(/DELETE FROM public\.comment_likes WHERE comment_id = p_comment_id AND profile_id = p_viewer;\s*IF FOUND THEN\s*v_outcome := 'unliked';/);
    expect(m).toMatch(/ON CONFLICT \(comment_id, profile_id\) DO NOTHING;\s*v_outcome := CASE WHEN FOUND THEN 'liked' ELSE 'already_liked' END;/);
    expect(m).toMatch(/SELECT COALESCE\(likes_count, 0\) INTO v_count FROM public\.post_comments WHERE id = p_comment_id;/);
    expect(m).not.toMatch(/UPDATE public\.post_comments/);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.comment_like_toggle\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.comment_like_toggle\(uuid, uuid\) TO service_role;/);
    expect(m).toMatch(/VALUES \(288, '288_comment_like_toggle\.sql'\)/);
  });
});
