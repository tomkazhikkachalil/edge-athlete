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
    // …and in ANY role (Nov 13): who removed themselves is read before the insert.
    expect(server).toContain("const fresh = [...want.entries()].filter(([k, p]) => !have.has(k) && !(p.profile_id && out.has(p.profile_id)))");
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

  it('the Stats tab lists game-film lines as a THIRD list — labelled apart, never in the totals, both shown when an official line exists (Tom, Nov 12)', () => {
    const film = read('src/components/stats/GameFilmLines.tsx');
    expect(film).toContain('/api/videos/tagged?profileId=');
    expect(film).toContain('not counted in the season totals');
    expect(film).toContain('data-game-film-hidden=""');
    // It reads the derived lines only: it never touches the stat-line or rollup routes, so nothing it shows can reach a total or a tile.
    expect(film).not.toMatch(/api\/sports\/stat-lines|api\/performance\/rollups/);
    expect(read('src/components/stats/StatsHub.tsx')).toContain('<GameFilmLines profileId={profileId} sportKey={selectedSport ?? null} />');
    // And the totals' own sources are untouched: no video source feeds the route or the performance table.
    expect(read('src/app/api/sports/stat-lines/route.ts')).not.toMatch(/video_highlight|listTaggedGames/);
    expect(read('src/lib/performance/map.ts')).not.toMatch(/video/i);
  });

  it('a film game attached to a contest that also has the athlete\'s official line is MARKED (round 2 PR 7) — exact match only, never counted together', () => {
    const reader = read('src/lib/videos/video-tagged-server.ts');
    expect(reader).toContain("out.filter(g => g.video.place?.kind === 'contest')");
    expect(reader).toContain(".from('contest_stat_lines').select('contest_id').eq('profile_id', profileId).in('contest_id', [...contestOf.keys()])");
    expect(reader).toContain('g.official_href = `/event/${r.contest_id}`;');
    const list = read('src/components/stats/GameFilmLines.tsx');
    expect(list).toContain('data-game-film-official=""');
    expect(list).toContain('The two are counted apart');
    expect(list).toContain('not counted in the season totals');
  });
});
