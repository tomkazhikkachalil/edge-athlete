import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Scale round 2 leftovers (Nov 7 2026, SCALE_AUDIT §1.3): the message list
// read every shared post and every shared profile ONE AT A TIME inside the
// page's map, and the owner's visibility + the viewer's follow once per owner
// — a page of 30 shares was 30–90 trips. Now the page's shared posts, shared
// profiles, owners and follows are four batched `.in()` reads at most, and
// the map that builds the payload makes no read at all.
const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/messages/[conversationId]/route.ts'), 'utf8');

describe('GET /api/messages/[conversationId]: the shared content of a page is batched', () => {
  const block = route.slice(route.indexOf('const live = messages.filter(m => !m.deleted_at);'), route.indexOf('// Enrich with emoji reactions'));
  it('four batched reads: shared posts, shared profiles, owners, follows', () => {
    expect(block).toMatch(/\.in\('id', sharedPostIds\)/);
    expect(block).toMatch(/\.in\('id', sharedProfileIds\)/);
    expect(block).toMatch(/\.in\('id', missing\)/);
    expect(block).toMatch(/\.in\('following_id', missing\)/);
    // The reply previews' shared posts join the same owner lookup (one more pair at most), then the same sync rule.
    expect(route).toContain('await loadOwnerAccess(((parentPostsResult.data || []) as SharedPostRow[]).map(ownerOf));');
    expect(route).not.toContain('filterViewableSharedPost');
    expect(block.match(/\.from\('/g)?.length).toBe(4);
  });
  it('the map over the page makes no read', () => {
    const map = block.slice(block.indexOf('const enrichedMessages = messages.map('));
    expect(map).not.toContain('.from(');
    expect(map).not.toContain('await ');
    expect(map).toContain('viewableSharedPost(sharedPosts.get(msg.shared_post_id))');
    expect(map).toContain("sharedProfiles.get(msg.shared_profile_id) ?? null");
  });
  it('the privacy rule is unchanged: owner visible (public or followed) AND (post public or followed); your own always', () => {
    expect(block).toContain('if (ownerId === user.id) return post;');
    expect(block).toContain('const profileOk = (ownerPublic.get(ownerId) ?? true) || isFollower;');
    expect(block).toContain("const postOk = post.visibility !== 'private' || isFollower;");
    expect(block).toContain("eq('status', 'accepted')");
  });
});
