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
import { filmCountable, filmStanding, type FilmStanding } from './film-standing';
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

/** A tagged game with the athlete's RAW stats (the sheet's keys) — what a total is built from. Null stats: not a game, or nothing counted. Kept even while the LINE is held back as a spoiler. */
export interface TaggedGameStats { view: TaggedGameView; stats: Record<string, number> | null }

export async function listTaggedGames(admin: Admin, profileId: string, viewer: User | null, actsForProfile: boolean): Promise<TaggedGameView[]> {
  return (await taggedGamesWithStats(admin, profileId, viewer, actsForProfile)).map(g => g.view);
}

/** The one read behind the list and the totals: each game this viewer may see, the athlete's line as cells AND as raw stats. */
export async function taggedGamesWithStats(admin: Admin, profileId: string, viewer: User | null, actsForProfile: boolean, max?: number, only?: (videoIds: string[]) => Promise<Set<string>>): Promise<TaggedGameStats[]> {
  let tagged = await taggedVideoIds(admin, profileId, max);
  if (only && tagged.length > 0) {
    const keep = await only(tagged.map(t => t.videoId));
    tagged = tagged.filter(t => keep.has(t.videoId));
  }
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
        // The raw stats are kept either way: a season total is not a play-by-play (Tom: a club's game is open, "like a pro sports team website").
        statsOf.set(read.view.id, stats);
        if (game.stats_hidden && !read.canManage && !actsForProfile) hidden = true;
        else line = cells;
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

/** The most tagged videos one season's totals look at. */
export const FILM_TOTALS_MAX = 80;

/** A verified film game as the totals take it. */
export interface VerifiedFilmGame { videoId: string; title: string; date: string; contestId: string | null; stats: Record<string, number> }

/**
 * The film that COUNTS for one athlete in one sport (Nov 14 2026): games on a
 * club's or league's video, fully tagged, with the date played, that THIS
 * viewer may open. Only those videos are read in full: the owner and the
 * sport are checked first, in two small reads.
 */
export async function verifiedFilmGames(admin: Admin, profileId: string, sportKey: string, viewer: User | null, actsForProfile: boolean): Promise<VerifiedFilmGame[]> {
  const only = async (ids: string[]): Promise<Set<string>> => {
    const [{ data: owned }, { data: games }] = await Promise.all([
      admin.from('videos').select('id').in('id', ids).not('org_id', 'is', null),
      admin.from('video_games').select('video_id').in('video_id', ids).eq('sport_key', sportKey).eq('coverage', 'full').not('played_on', 'is', null),
    ]);
    const org = new Set(((owned ?? []) as Array<{ id: string }>).map(r => r.id));
    return new Set(((games ?? []) as Array<{ video_id: string }>).map(r => r.video_id).filter(id => org.has(id)));
  };
  const out: VerifiedFilmGame[] = [];
  for (const g of await taggedGamesWithStats(admin, profileId, viewer, actsForProfile, FILM_TOTALS_MAX, only)) {
    if (!filmCountable(g.view.standing) || !g.stats || !g.view.played_on || g.view.sport_key !== sportKey) continue;
    out.push({ videoId: g.view.video.id, title: g.view.game_title ?? g.view.video.title, date: g.view.played_on, contestId: g.view.video.place?.kind === 'contest' ? g.view.video.place.id : null, stats: g.stats });
  }
  return out;
}
