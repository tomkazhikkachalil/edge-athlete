/**
 * The athlete's sport profile — the reads (Sprint 4 PR 2). Server only.
 *
 * readAthleteFilm is the set-based reader: the athlete's tags, their videos,
 * the games and the people on those tags, each in ONE query (the ids in
 * chunks), instead of a full read per video. It reads only the tags the
 * athlete is on — their line needs no other — and decides who may open a
 * video once per owner. The rules are the same ones every video read uses
 * (videoFactsFor → viewRight / manageRight); nothing about film is stored.
 *
 * readSportProfile puts the three sources side by side — official lines,
 * film, the athlete's own posts — and lets same-game.ts say which count.
 * The numbers are the Stats tab's numbers.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { chunk } from '@/lib/chunk';
import { distinctSet, readDistinctPairs } from '@/lib/performance/game-distinct-server';
import { seasonKey } from '@/lib/performance/rollups';
import { countGames, gameKey } from '@/lib/performance/same-game';
import { fetchOfficialStatLines } from '@/lib/sports/server/official-stats';
import { computeProfileTile, getStatSchema, isStatLineData, type StatLineData } from '@/lib/sports/stat-schemas';
import { filmCountable, filmStanding } from '@/lib/videos/film-standing';
import { deriveGame, statTagsForPerson, type GameTag } from '@/lib/videos/game-derive';
import { gameHasSides, gameTitleLine, sideLabel } from '@/lib/videos/game-rules';
import { gameSheetFor, type GameSheet } from '@/lib/videos/game-sheets';
import { manageRight, viewRight, type VideoRightFacts } from '@/lib/videos/rules';
import type { VideoRow } from '@/lib/videos/types';
import { GAME_COLUMNS, projectGame } from '@/lib/videos/video-games-server';
import { anonymousProfileCanView, profileManages, VIDEO_COLUMNS, videoFactsFor, type OrgAccessMemo } from '@/lib/videos/videos-server';
import { canViewProfile } from '@/lib/privacy';
import { filterBlockedBidirectional } from '@/lib/blocks';
import { careerOf, clipCounts, cutHeld, seasonsOf, type ProfileClip, type ProfileGame, type Stats } from './rules';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the admin client is untyped across the app
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[SPORT PROFILE]';
/** The most tag rows of one athlete a read looks at, and the most videos. */
export const FILM_TAG_ROWS_MAX = 6000;
export const FILM_VIDEOS_MAX = 300;
const IN_CHUNK = 150;

/** A block in either direction: the profile's film and numbers are not this viewer's to read (never says who blocked whom — the caller answers 404). */
export async function blockedFromProfile(admin: Admin, viewerId: string | null, profileId: string): Promise<boolean> {
  if (!viewerId || viewerId === profileId) return false;
  const { allowed } = await filterBlockedBidirectional(admin, viewerId, [profileId]);
  return allowed.length === 0;
}

export interface SportProfileViewer { user: User | null; isOwner: boolean; actsForProfile: boolean }

/**
 * Who is asking, or null (the caller answers 404 — never why): the athlete
 * or their guardian; a viewer the profile's own privacy lets in; a stranger
 * only on a public, present profile. A block in either direction closes it.
 */
export async function sportProfileViewer(admin: Admin, user: User | null, profileId: string): Promise<SportProfileViewer | null> {
  const acts = user ? await profileManages(user.id, profileId) : false;
  if (!acts) {
    const canView = user ? (await canViewProfile(profileId, user.id)).canView : await anonymousProfileCanView(admin, profileId);
    if (!canView) return null;
    if (await blockedFromProfile(admin, user?.id ?? null, profileId)) return null;
  }
  return { user, isOwner: user?.id === profileId, actsForProfile: acts };
}

interface PersonRow { highlight_id: string; video_id: string; profile_id: string | null; name: string | null; role: string; side: 1 | 2 | null }
interface TagRow { id: string; video_id: string; start_ms: number; end_ms: number | null; label: string; event_key: string | null; period: number | null; side: 1 | 2 | null; value: number | null }

/** One film game as the athlete's profile reads it. */
export interface FilmGame {
  videoId: string;
  youtubeId: string;
  title: string;
  date: string | null;
  opponent: string | null;
  contestId: string | null;
  standing: ReturnType<typeof filmStanding>;
  /** The game is spoiler-free and this viewer is not the athlete, their guardian or a manager of the video. */
  held: boolean;
  stats: Stats;
  byPeriod: Record<number, Stats>;
  clips: ProfileClip[];
}

async function inChunks<T>(ids: readonly string[], read: (part: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T[]> {
  const parts = await Promise.all(chunk([...ids], IN_CHUNK).map(part => read(part)));
  const out: T[] = [];
  for (const { data, error } of parts) {
    if (error) { console.error(`${TAG} ${what} read failed:`, error.message); continue; }
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

const mergeStats = (lines: ReadonlyArray<{ stats: Stats }>): Stats => {
  const out: Stats = {};
  for (const l of lines) for (const [k, n] of Object.entries(l.stats)) out[k] = (out[k] ?? 0) + n;
  return out;
};

/** The athlete's film in one sport that THIS viewer may open — every standing, the athlete's line and the tags behind it. */
export async function readAthleteFilm(admin: Admin, profileId: string, sportKey: string, viewer: User | null, actsForProfile: boolean): Promise<FilmGame[]> {
  const sheet: GameSheet | null = gameSheetFor(sportKey);
  if (!sheet) return [];
  // 1. The tags the athlete is on.
  const { data: mineRows, error: mineError } = await admin
    .from('video_highlight_people')
    .select('highlight_id, video_id')
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(FILM_TAG_ROWS_MAX);
  if (mineError) {
    // 307 not here yet = nobody is tagged.
    if (mineError.code !== '42P01' && mineError.code !== 'PGRST205') console.error(`${TAG} tags read failed:`, mineError.message);
    return [];
  }
  const mine = (mineRows ?? []) as Array<{ highlight_id: string; video_id: string }>;
  const videoIds = [...new Set(mine.map(r => r.video_id))].slice(0, FILM_VIDEOS_MAX);
  if (videoIds.length === 0) return [];

  // 2. The games of this sport among them, and their videos — side by side.
  const [gameRows, videoRows] = await Promise.all([
    inChunks<Parameters<typeof projectGame>[0]>(videoIds, part => admin.from('video_games').select(GAME_COLUMNS).in('video_id', part).eq('sport_key', sportKey), 'games'),
    inChunks<VideoRow>(videoIds, part => admin.from('videos').select(VIDEO_COLUMNS).in('id', part), 'videos'),
  ]);
  const games = new Map(gameRows.map(r => [r.video_id, projectGame(r)]));
  const videos = videoRows.filter(v => games.has(v.id));
  if (videos.length === 0) return [];

  // 3. Who may open each video: the video's own rule, asked once per owner.
  const orgMemo: OrgAccessMemo = new Map();
  const profileMemo = new Map<string, Promise<VideoRightFacts>>();
  const factsOf = (row: VideoRow): Promise<VideoRightFacts> => {
    if (row.org_id || !row.profile_id) return videoFactsFor(admin, row, viewer, orgMemo);
    let asked = profileMemo.get(row.profile_id);
    if (!asked) {
      asked = videoFactsFor(admin, row, viewer, orgMemo);
      profileMemo.set(row.profile_id, asked);
    }
    // The owner's facts are the same for all of their videos; the status is each video's own.
    return asked.then(f => ({ ...f, status: row.status }));
  };
  const rights = await Promise.all(videos.map(async row => {
    const facts = await factsOf(row);
    return { row, visible: viewRight(facts).allowed, canManage: manageRight(facts).allowed };
  }));
  const open = rights.filter(r => r.visible);
  if (open.length === 0) return [];
  const openIds = new Set(open.map(r => r.row.id));

  // 4. Those tags, and everyone on them (a role's holders are the first people in it, so the others decide who holds it).
  const tagIds = [...new Set(mine.filter(r => openIds.has(r.video_id)).map(r => r.highlight_id))];
  const [tagRows, peopleRows] = await Promise.all([
    inChunks<TagRow>(tagIds, part => admin.from('video_highlights').select('id, video_id, start_ms, end_ms, label, event_key, period, side, value').in('id', part), 'highlights'),
    inChunks<PersonRow>(tagIds, part => admin.from('video_highlight_people').select('highlight_id, video_id, profile_id, name, role, side').in('highlight_id', part).eq('status', 'active').order('created_at', { ascending: true }), 'people'),
  ]);
  const peopleOf = new Map<string, PersonRow[]>();
  for (const p of peopleRows) {
    const list = peopleOf.get(p.highlight_id);
    if (list) list.push(p);
    else peopleOf.set(p.highlight_id, [p]);
  }
  const tagsOf = new Map<string, GameTag[]>();
  for (const t of tagRows) {
    const tag: GameTag = {
      id: t.id, startMs: t.start_ms, endMs: t.end_ms, eventKey: t.event_key, period: t.period, side: t.side, value: t.value, label: t.label,
      people: (peopleOf.get(t.id) ?? []).map(p => ({ profileId: p.profile_id, name: p.name, role: p.role, side: p.side })),
    };
    const list = tagsOf.get(t.video_id);
    if (list) list.push(tag);
    else tagsOf.set(t.video_id, [tag]);
  }

  // 5. Each game: the athlete's line, by period, and the tags behind each stat.
  const me = `p:${profileId}`;
  const out: FilmGame[] = [];
  for (const { row, canManage } of open) {
    const game = games.get(row.id);
    const tags = tagsOf.get(row.id) ?? [];
    if (!game || tags.length === 0) continue;
    const lines = deriveGame(sheet, tags).players.filter(p => p.key === me);
    const stats = mergeStats(lines);
    const side = lines.find(l => l.side)?.side ?? null;
    const behind = statTagsForPerson(sheet, tags, me);
    const statKeysOf = (tagId: string): string[] => Object.entries(behind).filter(([, ids]) => ids.includes(tagId)).map(([k]) => k);
    const byPeriod: Record<number, Stats> = {};
    for (const period of [...new Set(tags.map(t => t.period).filter((p): p is number => p !== null))]) {
      const s = mergeStats(deriveGame(sheet, tags.filter(t => t.period === period)).players.filter(p => p.key === me));
      if (Object.keys(s).length > 0) byPeriod[period] = s;
    }
    out.push({
      videoId: row.id,
      youtubeId: row.provider_video_id,
      title: gameHasSides(sportKey) ? gameTitleLine(game) : row.title,
      date: game.played_on,
      opponent: side && gameHasSides(sportKey) ? sideLabel(game, side === 1 ? 2 : 1) : null,
      contestId: row.contest_id,
      standing: filmStanding(row.org_id ? 'org' : 'profile', game.coverage),
      held: game.stats_hidden && !canManage && !actsForProfile,
      stats,
      byPeriod,
      clips: tags
        .slice()
        .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
        .map(t => ({ id: t.id, videoId: row.id, youtubeId: row.provider_video_id, startMs: t.startMs, endMs: t.endMs, eventKey: t.eventKey, period: t.period, label: t.label, statKeys: statKeysOf(t.id) })),
    });
  }
  return out;
}

export interface SportProfileRead {
  sportKey: string;
  /** Every game, judged: official lines, film of every standing, the athlete's own posts. Nothing cut. */
  games: ProfileGame[];
  /** The sport's stat fields — the only keys a total sums. */
  statKeys: string[];
  seasonKeyOf: (date: string) => string;
}

/** The whole sport, judged, for one viewer — or null when the sport has no stat sheet here (golf keeps its own tables). */
export async function readSportProfile(admin: Admin, profileId: string, sportKey: string, viewer: User | null, opts: { isOwner: boolean; actsForProfile: boolean }): Promise<SportProfileRead | null> {
  const schema = getStatSchema(sportKey);
  if (!schema) return null;
  let postsQuery = admin
    .from('posts')
    .select('id, created_at, stats_data, visibility')
    .eq('profile_id', profileId)
    .eq('sport_key', sportKey)
    .not('stats_data', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);
  // The Stats tab's own rule: a viewer sees the profile's PUBLIC stat-line posts only.
  if (!opts.isOwner) postsQuery = postsQuery.eq('visibility', 'public');

  const [officialAll, film, postsRes, pairs] = await Promise.all([
    fetchOfficialStatLines(admin, profileId),
    readAthleteFilm(admin, profileId, sportKey, viewer, opts.actsForProfile),
    postsQuery,
    readDistinctPairs(admin, profileId, sportKey),
  ]);
  if (postsRes.error) console.error(`${TAG} posts read failed:`, postsRes.error.message);
  const posts: Array<{ id: string; date: string; line: StatLineData }> = [];
  for (const p of (postsRes.data ?? []) as Array<{ id: string; created_at: string; stats_data: unknown }>) {
    if (isStatLineData(p.stats_data)) posts.push({ id: p.id, date: (p.stats_data.date || p.created_at).slice(0, 10), line: p.stats_data });
  }
  const official = officialAll.filter(l => l.sportKey === sportKey);
  const confirmed = official.filter(l => !l.disputed);
  // Film that can count: a club's or league's, fully tagged, with the date played, and something on the athlete's line.
  const countable = film.filter(f => filmCountable(f.standing) && !!f.date && Object.keys(f.stats).length > 0);

  const verdicts = countGames(
    [
      ...confirmed.map(l => ({ id: gameKey.official(l.contestId), source: 'official' as const, date: l.date ? l.date.slice(0, 10) : null, contestId: l.contestId, opponent: l.opponentName })),
      ...countable.map(f => ({ id: gameKey.film(f.videoId), source: 'film' as const, date: f.date, contestId: f.contestId })),
      ...posts.map(p => ({ id: gameKey.post(p.id), source: 'post' as const, date: p.date, opponent: p.line.opponent ?? null })),
    ],
    { matchByDate: gameHasSides(sportKey), distinct: distinctSet(pairs) }
  );
  const verdictOf = (key: string, canCount: boolean): { counted: boolean; sameAs: string | null } => {
    const v = verdicts.get(key);
    if (!canCount || !v) return { counted: false, sameAs: null };
    return { counted: v.counted, sameAs: v.counted ? null : v.beatenBy };
  };
  const empty = { clips: [] as ProfileClip[], byPeriod: {} as Record<number, Stats>, held: false, standing: null, videoId: null };

  const games: ProfileGame[] = [
    ...official.map(l => ({
      key: gameKey.official(l.contestId), source: 'official' as const, date: l.date ? l.date.slice(0, 10) : null,
      title: l.competitionName, opponent: l.opponentName, stats: l.stats, href: l.href, ...empty,
      ...verdictOf(gameKey.official(l.contestId), !l.disputed),
    })),
    ...film.map(f => ({
      key: gameKey.film(f.videoId), source: 'film' as const, date: f.date, title: f.title, opponent: f.opponent, stats: f.stats,
      href: `/videos/${f.videoId}`, standing: f.standing, videoId: f.videoId, held: f.held, clips: f.clips, byPeriod: f.byPeriod,
      ...verdictOf(gameKey.film(f.videoId), countable.includes(f)),
    })),
    ...posts.map(p => ({
      key: gameKey.post(p.id), source: 'post' as const, date: p.date, title: p.line.opponent ? `vs ${p.line.opponent}` : schema.activityNoun,
      opponent: p.line.opponent ?? null, stats: p.line.stats as Stats, href: null, ...empty,
      ...verdictOf(gameKey.post(p.id), true),
    })),
  ];
  return { sportKey, games, statKeys: schema.fields.map(f => f.key), seasonKeyOf: (date: string) => seasonKey(date, sportKey) };
}

export interface SportProfileGameRow {
  key: string;
  source: ProfileGame['source'];
  date: string | null;
  season: string | null;
  title: string;
  opponent: string | null;
  stats: Stats;
  counted: boolean;
  sameAs: string | null;
  standing: ProfileGame['standing'];
  videoId: string | null;
  href: string | null;
  held: boolean;
  /** How many clips of the athlete this game has for THIS viewer. */
  clips: number;
  byPeriod: Record<number, Stats>;
}

export interface SportProfilePayload {
  sport: string;
  columns: Array<{ key: string; label: string; short: string }>;
  period: { noun: string; short: string } | null;
  career: { games: number; totals: Stats; tiles: Array<{ label: string; value: string | null }>; clips: Stats };
  seasons: Array<{ key: string; games: number; totals: Stats; from: string | null; to: string | null; tiles: Array<{ label: string; value: string | null }>; clips: Stats }>;
  games: SportProfileGameRow[];
  /** Games in the totals whose own line this viewer has not chosen to see. */
  held: number;
}

/** The page's payload: levels 1–3 without the clips themselves (the reel is its own, paged read). `showHeld` is the viewer's choice to see spoiler-free games. */
export function sportProfilePayload(read: SportProfileRead, showHeld: boolean): SportProfilePayload {
  const schema = getStatSchema(read.sportKey)!;
  const sheet = gameSheetFor(read.sportKey);
  // The totals are built from everything; what the viewer has not chosen to see is cut from the ROWS and the reels only.
  const shown = read.games.map(g => (showHeld ? { ...g, held: false } : g));
  const linesOf = (list: readonly ProfileGame[]): StatLineData[] => list.filter(g => g.counted).map(g => ({ type: 'stat_line' as const, sport_key: schema.sport_key, stats: g.stats }));
  const tilesOf = (list: readonly ProfileGame[]) => {
    const lines = linesOf(list);
    return schema.profileTiles.map(t => ({ label: t.label, value: lines.length === 0 ? null : computeProfileTile(t, lines) }));
  };
  const seasonOf = (g: ProfileGame): string | null => (g.date ? read.seasonKeyOf(g.date) : null);
  const career = careerOf(read.games, read.statKeys);
  const used = new Set(Object.keys(career.totals));
  return {
    sport: read.sportKey,
    columns: schema.fields.filter(f => used.has(f.key)).map(f => ({ key: f.key, label: f.label, short: f.shortLabel })),
    period: sheet ? { noun: sheet.period.noun, short: sheet.period.short } : null,
    career: { ...career, tiles: tilesOf(read.games), clips: clipCounts(shown) },
    seasons: seasonsOf(read.games, read.seasonKeyOf, read.statKeys).map(s => {
      const inSeason = (g: ProfileGame) => (seasonOf(g) ?? 'undated') === s.key;
      return { ...s, tiles: tilesOf(read.games.filter(inSeason)), clips: clipCounts(shown.filter(inSeason)) };
    }),
    games: shown.map(cutHeld).map((g, i) => ({
      key: g.key, source: g.source, date: g.date, season: seasonOf(g), title: g.title, opponent: g.opponent, stats: g.stats, counted: g.counted,
      sameAs: g.sameAs, standing: g.standing, videoId: g.videoId, href: g.href, held: shown[i].held, clips: g.clips.length, byPeriod: g.byPeriod,
    })),
    held: shown.filter(g => g.held && g.counted).length,
  };
}
