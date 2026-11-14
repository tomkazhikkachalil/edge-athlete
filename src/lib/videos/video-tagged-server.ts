/**
 * "Tagged in" — the games a profile was tagged in, for its profile page
 * (Sprint 3 PR 7). Server only. Tom: when a league or a club tags a player
 * in a long YouTube video, the clips and the stats show on the athlete's
 * profile — the athlete does nothing — with a link back to the full game.
 *
 * Each video is read through readVideoForViewer, so a game the VIEWER may
 * not see is simply not listed; the athlete's line is derived from the tags
 * (never stored) and is held back on a game whose stats are hidden — except
 * from the athlete, their guardian and the game's managers (the profile
 * page must not be the spoiler).
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { filmStanding, type FilmStanding } from './film-standing';
import { cellText, deriveGame } from './game-derive';
import { gameTitleLine } from './game-rules';
import { gameSheetFor } from './game-sheets';
import { gameTagOf } from './game-view';
import type { VideoView } from './types';
import { readGame } from './video-games-server';
import { readVideoForViewer, taggedVideoIds } from './videos-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the admin client is untyped across the app
type Admin = SupabaseClient<any, 'public', any>;

export interface TaggedGameView {
  video: VideoView;
  /** "Hawks vs Owls", or null when the video is not a game. */
  game_title: string | null;
  sport_key: string | null;
  played_on: string | null;
  /** How many highlights this athlete is in. */
  clips: number;
  /** Their line for the game in the sport's box-score columns, or null: not a game, nothing counted, or held back (see `stats_hidden`). */
  line: Array<{ label: string; value: string }> | null;
  /** The line exists but is not shown to THIS viewer — the game unlocks as it is watched. */
  stats_hidden: boolean;
  /** Round 2 PR 7: the video is attached to a contest that ALSO has this athlete's official stat line — the link to it, so the two are read together. Null otherwise. */
  official_href: string | null;
  /** Nov 14 2026: a club's or league's game is verified film (counted only when fully tagged); anyone else's is recreational. Null when the video is not a game. */
  standing: FilmStanding | null;
}

/** A tagged game with the athlete's RAW stats (the sheet's keys) — what a total is built from. Null stats: not a game, nothing counted, or held back from this viewer. */
export interface TaggedGameStats { view: TaggedGameView; stats: Record<string, number> | null }

export async function listTaggedGames(admin: Admin, profileId: string, viewer: User | null, actsForProfile: boolean): Promise<TaggedGameView[]> {
  return (await taggedGamesWithStats(admin, profileId, viewer, actsForProfile)).map(g => g.view);
}

/** The one read behind the list and the totals: each game this viewer may see, the athlete's line as cells AND as raw stats. */
export async function taggedGamesWithStats(admin: Admin, profileId: string, viewer: User | null, actsForProfile: boolean, max?: number): Promise<TaggedGameStats[]> {
  const tagged = await taggedVideoIds(admin, profileId, max);
  const out: TaggedGameView[] = [];
  const statsOf = new Map<string, Record<string, number>>();
  for (const t of tagged) {
    const read = await readVideoForViewer(admin, t.videoId, viewer);
    if (!read) continue; // hidden, private, or gone for this viewer
    const game = await readGame(admin, t.videoId);
    const sheet = game ? gameSheetFor(game.sport_key) : null;
    const mine = read.highlights.filter(h => h.people.some(p => p.profile_id === profileId));
    if (mine.length === 0) continue; // the viewer may not see this profile's name on it
    let line: TaggedGameView['line'] = null;
    let hidden = false;
    if (game && sheet) {
      const stats: Record<string, number> = {};
      for (const p of deriveGame(sheet, read.highlights.map(gameTagOf)).players) {
        if (p.key !== `p:${profileId}`) continue;
        for (const [k, n] of Object.entries(p.stats)) stats[k] = (stats[k] ?? 0) + n;
      }
      const cells = sheet.box
        .filter(c => (typeof c.key === 'string' ? [c.key] : [...c.key]).some(k => (stats[k] ?? 0) > 0))
        .map(c => ({ label: c.label, value: cellText(stats, c.key) }));
      if (cells.length > 0) {
        if (game.stats_hidden && !read.canManage && !actsForProfile) hidden = true;
        else {
          line = cells;
          statsOf.set(read.view.id, stats);
        }
      }
    }
    out.push({ video: read.view, game_title: game ? gameTitleLine(game) : null, sport_key: game?.sport_key ?? null, played_on: game?.played_on ?? null, clips: mine.length, line, stats_hidden: hidden, official_href: null, standing: game ? filmStanding(read.view.owner.kind, game.coverage) : null });
  }
  // Which of these games ALSO have an official line for this athlete? Exact only: the video is attached to the contest. One read.
  const contestOf = new Map(out.filter(g => g.video.place?.kind === 'contest').map(g => [g.video.place!.id, g]));
  if (contestOf.size > 0) {
    const { data, error } = await admin.from('contest_stat_lines').select('contest_id').eq('profile_id', profileId).in('contest_id', [...contestOf.keys()]);
    if (error) console.error('[VIDEOS tagged] official lines read failed:', error.message);
    for (const r of (data ?? []) as Array<{ contest_id: string }>) {
      const g = contestOf.get(r.contest_id);
      if (g) g.official_href = `/event/${r.contest_id}`;
    }
  }
  return out.map(view => ({ view, stats: statsOf.get(view.video.id) ?? null }));
}
