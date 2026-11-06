import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// SCALE_AUDIT hole 10 (Nov 6 2026, the improvements round PR 3): the profile
// media grid's GET used to make up to fourteen reads one after another. The
// page's independent reads now run together in two stages, the three reads
// of `posts` for the same ids (the shared-round link, the repost link, the
// owner's hidden rows) are ONE read, the Photos / Videos filter reads the
// attachments it needs anyway, and the viewer-dependent answer says so.
const ROOT = process.cwd();
const route = fs.readFileSync(path.join(ROOT, 'src/app/api/profile/[profileId]/media/route.ts'), 'utf8');
const get = route.slice(route.indexOf('export async function GET('), route.indexOf('// GET counts for tab badges'));

describe('the profile media grid: one pass in stages', () => {
  it('two Promise.all stages: the page ids decide stage 2; the links decide stage 3', () => {
    expect(get.match(/await Promise\.all\(\[/g)?.length).toBe(2);
    const stage2 = get.slice(get.indexOf('const [mediaRes, linksRes, profilesRes, roundsRes] = await Promise.all(['), get.indexOf('const media = (mediaRes.data ?? [])'));
    expect(stage2).toContain(".from('post_media')");
    expect(stage2).toContain(".from('posts').select('id, group_post_id, shared_post_id, status').in('id', postIds)");
    expect(stage2).toContain(".from('profiles')");
    expect(stage2).toContain(".from('golf_rounds')");
    const stage3 = get.slice(get.indexOf('const [groupRes, originalsRes] = await Promise.all(['), get.indexOf('if (groupRes.error)'));
    expect(stage3).toContain(".from('group_posts')");
    expect(stage3).toContain(".from('posts')");
  });
  it("reads `posts` for the page once — no separate link, repost-link or hidden-rows reads", () => {
    expect(get.match(/\.from\('posts'\)/g)?.length).toBe(2); // the one links read + the originals
    expect(get).not.toContain(".not('group_post_id', 'is', null)");
    expect(get).not.toContain(".not('shared_post_id', 'is', null)");
    expect(get).not.toContain(".eq('status', 'profile_hidden')");
    expect(get).toContain("links.filter(l => l.status === 'profile_hidden')");
  });
  it('the media-type filter reads no extra rows; the attachments read is the one post_media read', () => {
    expect(get.match(/\.from\('post_media'\)/g)?.length).toBe(1);
    expect(get).not.toContain(".select('post_id, media_type')");
  });
  it('the follows read for reposts stays bounded by the originals\' owners', () => {
    expect(get).toMatch(/\.from\('follows'\)\s+\.select\('following_id'\)\s+\.eq\('follower_id', viewerId\)\s+\.in\('following_id', ownerIds\)/);
  });
  it('the answer is viewer-dependent: private, no-store', () => {
    expect(get).toContain("{ headers: { 'Cache-Control': 'private, no-store' } }");
  });
});
