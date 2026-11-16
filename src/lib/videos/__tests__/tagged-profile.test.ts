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
    // Each video is still read through the viewer's own gate — side by side now (Nov 14: one after another cost a second a game), the viewer's reach on an organization asked once.
    expect(list).toContain('const reads = await mapBounded(tagged, TAGGED_READ_WIDTH, t => Promise.all([readVideoForViewer(admin, t.videoId, viewer, memo), readGame(admin, t.videoId)]));');
    expect(list).toContain('if (!read) continue; // hidden, private, or gone for this viewer');
    expect(read('src/lib/videos/videos-server.ts')).toContain('memo?.set(row.org_id, asked);');
    expect(list).toContain('if (game.stats_hidden && !read.canManage && !actsForProfile) hidden = true;');
    expect(list).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/); // derived, never stored
  });

  it('the profile\'s Videos tab shows it, and the video page offers the tagged viewer the removal', () => {
    expect(read('src/components/profile/ProfileVideosTab.tsx')).toContain('<TaggedGames profileId={profileId} />');
    const screen = read('src/components/videos/VideoScreen.tsx');
    expect(screen).toContain('allHighlights.some(h => h.people.some(p => p.profile_id === user.id))');
    expect(screen).toContain('data-video-untag-me=""');
  });

  it('the Stats tab lists game-film lines as a THIRD list, labelled apart; since Nov 14 2026 only VERIFIED film counts, through the one rule on the server', () => {
    const film = read('src/components/stats/GameFilmLines.tsx');
    expect(film).toContain('/api/videos/tagged?profileId=');
    expect(film).toContain('data-game-film-hidden=""');
    // The list never adds anything up itself: it asks the route that counts what it decided, per verified game.
    expect(film).toContain("next.filter(g => g.standing === 'verified' && g.sport_key && g.played_on)");
    expect(film).toContain('/api/sports/stat-lines?profileId=');
    expect(film).not.toMatch(/api\/performance\/rollups/);
    expect(film).toContain('data-game-film-counted="yes"');
    expect(film).toContain('data-game-film-counted="no"');
    // Since the Stats breakdown was retired (Nov 2026): the list stays on the All layer and on a sport with no sport profile
    // (golf, track); a sport WITH one shows its film in the sport profile's game log instead.
    const hub = read('src/components/stats/StatsHub.tsx');
    expect(hub).toContain('{!(selectedSport && hasSportProfile(selectedSport)) && <GameFilmLines profileId={profileId} sportKey={selectedSport ?? null} />}');
    expect(read('src/lib/sport-profile/has-profile.ts')).toMatch(/return sportKey === 'golf' \|\| !!getStatSchema\(sportKey as SportKey\);/);
    expect(hub).not.toContain("import StatLineBreakdown from './StatLineBreakdown';");
    // The totals take film ONLY through verifiedFilmGames (a club's or league's, fully tagged, dated) — never the plain tagged list, never stored.
    const route = read('src/app/api/sports/stat-lines/route.ts');
    expect(route).not.toMatch(/video_highlight|listTaggedGames/);
    expect(route).toContain('verifiedFilmGames(supabase, profileId, schema.sport_key, viewer,');
    expect(read('src/lib/performance/map.ts')).not.toMatch(/video/i);
    const reader = read('src/lib/videos/video-tagged-server.ts');
    expect(reader).toContain("admin.from('videos').select('id').in('id', ids).not('org_id', 'is', null)");
    expect(reader).toContain(".eq('sport_key', sportKey).eq('coverage', 'full').not('played_on', 'is', null)");
    expect(reader).toContain('if (!filmCountable(g.view.standing) || !g.stats || !g.view.played_on || g.view.sport_key !== sportKey) continue;');
  });

  it('a film game attached to a contest that also has the athlete\'s official line is MARKED (round 2 PR 7) — and the official line is the one that counts', () => {
    const reader = read('src/lib/videos/video-tagged-server.ts');
    expect(reader).toContain("out.filter(g => g.video.place?.kind === 'contest')");
    expect(reader).toContain(".from('contest_stat_lines').select('contest_id').eq('profile_id', profileId).in('contest_id', [...contestOf.keys()])");
    expect(reader).toContain('g.official_href = `/event/${r.contest_id}`;');
    const list = read('src/components/stats/GameFilmLines.tsx');
    expect(list).toContain('data-game-film-official=""');
    expect(list).toContain('The official line is the one that counts.');
  });
});
