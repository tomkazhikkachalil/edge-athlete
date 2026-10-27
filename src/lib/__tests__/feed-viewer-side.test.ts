import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Trip-count program PR 2 (Oct 27 2026): the viewer's side of a feed page —
// hidden authors, accepted follows among the page's authors, the viewer's
// saves and likes among the page's posts — is ONE call (migration 281,
// feed_viewer_side). The posts page stays the route's PostgREST select and
// every rule stays in TypeScript. hiddenAuthorsFor (every other caller) is
// one call too, with the three reads kept only for a database ahead of 281.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('the feed reads its viewer side once', () => {
  const route = read('src/app/api/posts/route.ts');
  it('one feed_viewer_side call; the six reads it replaced are gone', () => {
    expect(route.match(/\.rpc\('feed_viewer_side'/g)?.length).toBe(1);
    expect(route).not.toMatch(/hiddenAuthorsFor/);
    expect(route).not.toMatch(/from\('saved_posts'\)/);
    expect(route).not.toMatch(/\.in\('post_id', pageIds\)/); // the saved_posts + post_likes pair keyed on the visible page
    expect(route).not.toMatch(/\.in\('following_id', pageAuthorIds\)/);
  });
  it('the quoted originals\' owners are still a bounded follows read; the other follows reads stay', () => {
    expect(route).toMatch(/\.in\('following_id', ownerIds\)/);
    expect(route.match(/\.from\('follows'\)/g)?.length).toBe(5);
  });
  it('the following lens sends no authors; anonymous skips the call; a database ahead of 281 answers 503, a read error fails open', () => {
    expect(route).toMatch(/p_author_ids: followScope \? \[\] : pageAuthorIds/);
    expect(route).toMatch(/if \(currentUserId\) \{\s*const \{ data: side, error: sideError \} = await supabase\.rpc\('feed_viewer_side'/);
    expect(route).toMatch(/sideError\?\.code === 'PGRST202'/);
    expect(route).toMatch(/\{ error: 'Feed service updating' \}, \{ status: 503, headers: \{ 'Cache-Control': 'no-store' \} \}/);
    expect(route).toMatch(/reportRouteError\('Feed viewer-side read error:', sideError\);\s*\} else \{/);
  });
  it('the rules did not move: the hidden-author arm, rule 3, the per-post saved_posts / likes arrays', () => {
    expect(route).toMatch(/if \(hiddenAuthors\.has\(post\.profile_id\) && currentUserId !== post\.profile_id\) return false;/);
    expect(route).toMatch(/if \(currentUserId && followingIds\.has\(post\.profile_id\)\) \{/);
    expect(route).toMatch(/saved_posts: currentUserId && savedPostIds\.has\(post\.id\) \? \[\{ profile_id: currentUserId \}\] : \[\],/);
    expect(route).toMatch(/likes: currentUserId && likedPostIds\.has\(post\.id\) \? \[\{ profile_id: currentUserId \}\] : \[\],/);
  });
});

describe('hiddenAuthorsFor is one call', () => {
  const mutes = read('src/lib/mutes.ts');
  it('calls hidden_authors_for and falls back to the three reads only on PGRST202', () => {
    expect(mutes.match(/\.rpc\('hidden_authors_for', \{ p_viewer: viewerId \}\)/g)?.length).toBe(1);
    expect(mutes).toMatch(/if \(error\?\.code === 'PGRST202'\) return hiddenAuthorsThreeReads\(admin, viewerId\);/);
    expect(mutes.match(/\.limit\(2000\)/g)?.length).toBe(3);
  });
});

describe('migration 281', () => {
  const m = read('database/migrations/281_feed_viewer_side.sql');
  it('two service_role-only functions, the three 2,000 caps, the accepted predicate, the ledger', () => {
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION public\.hidden_authors_for\(p_viewer uuid\)\s*RETURNS uuid\[\]/);
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION public\.feed_viewer_side\(p_viewer uuid, p_author_ids uuid\[\], p_post_ids uuid\[\]\)\s*RETURNS jsonb/);
    expect(m.match(/LIMIT 2000/g)?.length).toBe(3);
    expect(m).toMatch(/f\.follower_id = p_viewer AND f\.status = 'accepted' AND f\.following_id = ANY\(p_author_ids\)/);
    expect(m).toMatch(/s\.profile_id = p_viewer AND s\.post_id = ANY\(p_post_ids\)/);
    expect(m).toMatch(/l\.profile_id = p_viewer AND l\.post_id = ANY\(p_post_ids\)/);
    expect(m.match(/LANGUAGE sql STABLE SECURITY INVOKER\s*SET search_path = public/g)?.length).toBe(2);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.hidden_authors_for\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.hidden_authors_for\(uuid\) TO service_role;/);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.feed_viewer_side\(uuid, uuid\[\], uuid\[\]\) FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.feed_viewer_side\(uuid, uuid\[\], uuid\[\]\) TO service_role;/);
    expect(m).toMatch(/VALUES \(281, '281_feed_viewer_side\.sql'\)/);
  });
});
