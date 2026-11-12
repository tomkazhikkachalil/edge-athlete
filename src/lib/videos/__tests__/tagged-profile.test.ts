import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/**
 * Sprint 3 PR 7 — on the athlete's profile: told once per game, the clips
 * and the line without the athlete doing anything, removable by the tagged
 * person (or a guardian) for good. Pinned at the source; the behaviour is
 * e2e/video-tagged-profile.spec.ts.
 */
describe('tagged by someone else', () => {
  const server = read('src/lib/videos/videos-server.ts');

  it('told ONCE per game, never the tagger, best-effort; a supervised athlete\'s guardians are told', () => {
    expect(server).toContain('if (added.length > 0) await notifyNewlyTagged(admin, videoId, added, userId);');
    expect(server).toContain("const ids = [...new Set(profileIds)].filter(id => id !== actorId);");
    expect(server).toContain('const first = ids.filter(id => (highlightsOf.get(id)?.size ?? 0) <= 1);');
    expect(server).toContain("type: 'tag', actor_id: actorId");
    expect(server).toContain("type: 'tag_alert'");
    expect(server).toContain("p.supervision_state === 'supervised'");
    // The notification types are ones the table allows (259's check) — no DDL.
    const check = read('database/migrations/259_session_reminder.sql');
    expect(check).toContain("'tag'");
    expect(check).toContain("'tag_alert'");
  });

  it('removal marks the rows removed (never deletes them), and a later save never adds the person back', () => {
    expect(server).toContain("update({ status: 'removed', removed_by_user_id: byUserId, removed_at: new Date().toISOString() })");
    expect(server).toContain(".eq('profile_id', profileId).eq('status', 'active')");
    // `have` holds every row of the tag, removed ones included, so a removed person is not "fresh".
    expect(server).toContain("const fresh = [...want.entries()].filter(([k]) => !have.has(k))");
    expect(server).toContain(".select('id, profile_id, name, role, status').eq('highlight_id', highlightId)");
  });

  it('the remove route needs no right over the video — only that it is YOUR name, or your supervised athlete\'s', () => {
    const route = read('src/app/api/videos/[id]/tags/route.ts');
    expect(route).toContain("getServerAuth(request, { limit: 'video-write' })");
    expect(route).toContain('resolveActingProfile(user.id, request.nextUrl.searchParams.get(\'profileId\')');
    expect(route).toContain('removeTagsOf(getSupabaseAdmin(), id, acting.actorId, user.id, highlightId)');
    expect(route).not.toContain('readVideoForViewer');
  });

  it('the profile read: the profile\'s privacy gates who asks, each video\'s own rule gates what answers, and a spoiler-free game holds the line back from strangers', () => {
    const route = read('src/app/api/videos/tagged/route.ts');
    expect(route).toContain('const acts = user ? await profileManages(user.id, profileId) : false;');
    expect(route).toContain('if (!canView) return NOT_FOUND();');
    expect(route).toContain("const PRIVATE = { 'Cache-Control': 'private, no-store' };");
    const list = read('src/lib/videos/video-tagged-server.ts');
    expect(list).toContain('const read = await readVideoForViewer(admin, t.videoId, viewer);');
    expect(list).toContain('if (game.stats_hidden && !read.canManage && !actsForProfile) hidden = true;');
    expect(list).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/); // derived, never stored
  });

  it('the profile\'s Videos tab shows it, and the video page offers the tagged viewer the removal', () => {
    expect(read('src/components/profile/ProfileVideosTab.tsx')).toContain('<TaggedGames profileId={profileId} />');
    const screen = read('src/components/videos/VideoScreen.tsx');
    expect(screen).toContain('allHighlights.some(h => h.people.some(p => p.profile_id === user.id))');
    expect(screen).toContain('data-video-untag-me=""');
  });
});
