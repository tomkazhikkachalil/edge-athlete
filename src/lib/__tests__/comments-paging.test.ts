import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// SCALE_AUDIT hole 12 (Nov 6 2026, the improvements round PR 5b): the
// comments list is a page of THREADS — thirty root comments (pinned, most
// liked, oldest) with every reply of those roots riding along, fetched by
// parent in bounded rounds — and the client really pages it. It used to be a
// flat page of 100 read once: the 101st comment did not exist to a reader,
// and the viewer's mutes thinned the page BEFORE hasMore was computed.
const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('GET /api/comments: a page of threads', () => {
  const route = read('src/app/api/comments/route.ts');
  it('thirty roots a page (max 100), roots only in the page read, limit + 1 for hasMore', () => {
    expect(route).toContain("const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '30', 10) || 30, 1), 100);");
    expect(route).toMatch(/\.eq\('post_id', postId\)\s+\.is\('parent_comment_id', null\)/);
    expect(route).toContain(".range(offset, offset + limit), // limit+1 rows to compute hasMore");
    expect(route).toContain("const hasMore = allRoots.length > limit;");
  });
  it("hasMore is read off the raw page; the viewer's mutes thin the page afterwards", () => {
    const i = route.indexOf('const hasMore = allRoots.length > limit;');
    const j = route.indexOf('.filter(notHidden)');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });
  it('the replies of the page\'s roots come by parent, round by round, each round bounded', () => {
    expect(route).toContain('const REPLY_DEPTH_ROUNDS = 4;');
    expect(route).toContain('const REPLIES_PER_ROUND = 300;');
    expect(route).toMatch(/\.in\('parent_comment_id', parentIds\)/);
    expect(route).toContain('.limit(REPLIES_PER_ROUND);');
    expect(route).toContain('nextOffset: offset + pageRoots.length,');
  });
  it('the sort and the viewer rule are unchanged', () => {
    expect(route).toMatch(/\.order\('is_pinned', \{ ascending: false, nullsFirst: false \}\)\s+\.order\('likes_count', \{ ascending: false \}\)\s+\.order\('created_at', \{ ascending: true \}\)/);
    expect(route).toContain("out.or(`status.eq.published,profile_id.eq.${viewer.id}`)");
    expect(route).toContain("out.eq('comment_likes.profile_id', viewer.id)");
  });
});

describe('CommentSection pages the threads', () => {
  const client = read('src/components/CommentSection.tsx');
  it('keeps hasMore and the next offset from each answer, and offers "Show more comments"', () => {
    expect(client).toContain('setHasMore(!!data.hasMore);');
    expect(client).toContain('const loadMoreComments = async () => {');
    expect(client).toContain('fetch(`/api/comments?postId=${postId}&offset=${nextOffset}`)');
    expect(client).toContain("Show more comments");
    expect(client).toContain('data-comments-more=""');
    // Merged by id — a page never doubles a comment already shown.
    expect(client).toContain('const seen = new Set(prev.map(c => c.id));');
  });
});
