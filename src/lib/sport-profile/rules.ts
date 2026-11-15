/**
 * The athlete's sport profile (Sprint 4, Nov 2026) — the pure rules. No
 * imports. Career → Season → Game → Play for ONE athlete in ONE sport:
 * every number is the sum of counted games, and every number opens the
 * clips behind it.
 *
 * The games arrive already judged (src/lib/performance/same-game.ts: an
 * official line > a club's or league's verified film > the athlete's own
 * post; one game counted once). Nothing here decides what counts — it
 * groups, sums and finds the clips.
 *
 *   Level 1  career    careerOf, seasonsOf
 *   Level 2  season    seasonOf — totals, splits, the game log
 *   Level 3  game      a ProfileGame — its line, its clips
 *   Level 4  play      reelOf — the clips behind a stat, in order
 *
 * A game whose stats the viewer has not chosen to see (a spoiler-free
 * game) still counts in every total — a season total is not a
 * play-by-play — but its own line and its clips are cut by cutHeld.
 */

export type Stats = Record<string, number>;
export type GameSourceKind = 'official' | 'film' | 'post';
export type FilmStandingKind = 'verified' | 'verified_highlights' | 'recreational';

export interface ProfileClip {
  /** The highlight. */
  id: string;
  videoId: string;
  /** The provider's id of the video the clip plays in. */
  youtubeId: string;
  startMs: number;
  endMs: number | null;
  eventKey: string | null;
  period: number | null;
  label: string;
  /** The athlete's stats this tag produced (`goals`, `shots`) — empty for a clip with no stat. */
  statKeys: string[];
  /** The athlete hid this clip from their page (311). Only the athlete and their guardian are ever sent one. */
  hidden?: boolean;
}

export interface ProfileGame {
  /** `official:<contest>` · `film:<video>` · `post:<post>` — the same-game rule's own name. */
  key: string;
  source: GameSourceKind;
  /** YYYY-MM-DD, or null when nobody said. */
  date: string | null;
  title: string;
  opponent: string | null;
  stats: Stats;
  /** In the totals. */
  counted: boolean;
  /** The game that took its place (it is the same game), or null. */
  sameAs: string | null;
  /** Film only. */
  standing: FilmStandingKind | null;
  /** Film: its video. */
  videoId: string | null;
  href: string | null;
  /** The viewer has not chosen to see this game's line (spoiler-free). */
  held: boolean;
  clips: ProfileClip[];
  /** The athlete's stats by period, where the tags say the period. */
  byPeriod: Record<number, Stats>;
  /** An official line: the rung it was entered at (`league_verified`, `club_recorded`, …). */
  provenance?: string | null;
  /** An official line under an open dispute: unconfirmed — on the log, out of the totals until resolved. */
  disputed?: boolean;
  /** The athlete's own post: the result as they wrote it ("W 4–2"). */
  result?: string | null;
  /** Not counted because it shares its DATE with the game that took its place (never a contest): the athlete may say they are two games (309). */
  canSplit?: boolean;
  /** The athlete said this game and that one are two different games (309): the other game's key, so it can be taken back. */
  splitFrom?: string | null;
  /** The athlete hid this whole game from their page (311) — still in the totals. */
  hidden?: boolean;
  /** Hidden, and this viewer is not the athlete: it counts, and nothing else about it is sent (forViewer). */
  concealed?: boolean;
}

export interface Totals { games: number; totals: Stats }
export interface SeasonSummary extends Totals { key: string; from: string | null; to: string | null }

const add = (into: Stats, from: Stats, keys?: readonly string[]): void => {
  for (const [k, v] of Object.entries(from)) {
    if (keys && !keys.includes(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) into[k] = (into[k] ?? 0) + v;
  }
};

/** The sum of the COUNTED games. `keys` narrows to the sport's stat fields (a sheet's extra keys never reach a total). */
export function totalsOf(games: readonly ProfileGame[], keys?: readonly string[]): Totals {
  const totals: Stats = {};
  let n = 0;
  for (const g of games) {
    if (!g.counted) continue;
    n += 1;
    add(totals, g.stats, keys);
  }
  return { games: n, totals };
}

/** Level 1: the career line. */
export function careerOf(games: readonly ProfileGame[], keys?: readonly string[]): Totals {
  return totalsOf(games, keys);
}

/** A game with no date belongs to no season; it is still in the career. */
export const NO_SEASON = 'undated';

/** Level 1: one row per season, newest first; the undated games last. `seasonKeyOf` is the sport's own season rule (rollups.ts). */
export function seasonsOf(games: readonly ProfileGame[], seasonKeyOf: (date: string) => string, keys?: readonly string[]): SeasonSummary[] {
  const by = new Map<string, ProfileGame[]>();
  for (const g of games) {
    const key = g.date ? seasonKeyOf(g.date) : NO_SEASON;
    const list = by.get(key);
    if (list) list.push(g);
    else by.set(key, [g]);
  }
  const out: SeasonSummary[] = [];
  for (const [key, list] of by) {
    const sum = totalsOf(list, keys);
    if (sum.games === 0 && !list.some(g => g.source === 'film')) continue; // nothing counted and nothing to watch
    const dates = list.map(g => g.date).filter((d): d is string => !!d).sort();
    out.push({ key, ...sum, from: dates[0] ?? null, to: dates[dates.length - 1] ?? null });
  }
  return out.sort((a, b) => (a.key === NO_SEASON ? 1 : b.key === NO_SEASON ? -1 : a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/** The games of one season, newest first (undated last). */
export function gamesOfSeason(games: readonly ProfileGame[], season: string, seasonKeyOf: (date: string) => string): ProfileGame[] {
  return games
    .filter(g => (g.date ? seasonKeyOf(g.date) : NO_SEASON) === season)
    .slice()
    .sort((a, b) => ((b.date ?? '') < (a.date ?? '') ? -1 : (b.date ?? '') > (a.date ?? '') ? 1 : a.key < b.key ? -1 : 1));
}

export interface SplitRow extends Totals { label: string }

const normName = (s: string | null): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * By opponent: the counted games, grouped by who they were against (case
 * and spacing aside), most games first. A held game is never under its
 * opponent — one row would be its line — it is in `rest`.
 */
export function splitByOpponent(games: readonly ProfileGame[], keys?: readonly string[]): { rows: SplitRow[]; rest: Totals } {
  const by = new Map<string, { label: string; games: ProfileGame[] }>();
  const rest: ProfileGame[] = [];
  for (const g of games) {
    if (!g.counted) continue;
    const k = normName(g.opponent);
    if (!k || g.held || g.concealed) { rest.push(g); continue; }
    const label = (g.opponent ?? '').trim();
    const row = by.get(k);
    if (!row) { by.set(k, { label, games: [g] }); continue; }
    row.games.push(g);
    // The name as somebody wrote it with capitals, when one spelling has them.
    if (row.label === row.label.toLowerCase() && label !== label.toLowerCase()) row.label = label;
  }
  const rows = [...by.values()].map(r => ({ label: r.label, ...totalsOf(r.games, keys) })).sort((a, b) => b.games - a.games || a.label.localeCompare(b.label));
  return { rows, rest: totalsOf(rest, keys) };
}

/**
 * By period: only what the film says — a stat with a period on its tag.
 * The counted film games that are not held; an official line or a post has
 * no periods and is not in it, so the rows need not add up to the season.
 */
export function splitByPeriod(games: readonly ProfileGame[], keys?: readonly string[]): Array<{ period: number; games: number; totals: Stats }> {
  const by = new Map<number, { games: number; totals: Stats }>();
  for (const g of filmBehind(games)) {
    if (g.held) continue;
    for (const [p, stats] of Object.entries(g.byPeriod)) {
      const period = Number(p);
      const row = by.get(period) ?? { games: 0, totals: {} };
      row.games += 1;
      add(row.totals, stats, keys);
      by.set(period, row);
    }
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([period, r]) => ({ period, ...r }));
}

/**
 * The film behind the numbers: every verified film game that is counted OR
 * is the same game as a counted one (the official line of a filmed game
 * counts, and its plays are that film's). Recreational film is behind no
 * number.
 */
export function filmBehind(games: readonly ProfileGame[]): ProfileGame[] {
  const counted = new Set(games.filter(g => g.counted).map(g => g.key));
  return games.filter(g => g.source === 'film' && g.standing !== 'recreational' && (g.counted || (g.sameAs !== null && counted.has(g.sameAs))));
}

/** The film of a game: its own video, or — for an official line or a post — the film that is the same game. */
export function filmOfGame(games: readonly ProfileGame[], key: string): ProfileGame | null {
  const g = games.find(x => x.key === key);
  if (!g) return null;
  if (g.source === 'film') return g.concealed ? null : g;
  return games.find(x => x.source === 'film' && x.sameAs === key && !x.concealed) ?? null;
}

export interface ReelFilter {
  /** One game (its key) — the game's own film or the film that is the same game. */
  game?: string | null;
  /** The athlete's stat (`goals`). */
  stat?: string | null;
  /** The sheet's event (`goal`). */
  event?: string | null;
  period?: number | null;
  /** The Clips browser: every film game the viewer may watch, recreational included. A number's reel never does. */
  everyFilm?: boolean;
}

export interface ReelClip extends ProfileClip {
  gameKey: string;
  gameTitle: string;
  gameDate: string | null;
  standing: FilmStandingKind | null;
}

/**
 * Level 4: the clips, oldest game first and in game order within it — a
 * reel plays the season the way it happened. Held games give no clips.
 */
export function reelOf(games: readonly ProfileGame[], filter: ReelFilter = {}): ReelClip[] {
  let film: ProfileGame[];
  if (filter.game) {
    const f = filmOfGame(games, filter.game);
    film = f ? [f] : [];
  } else {
    film = filter.everyFilm ? games.filter(g => g.source === 'film') : filmBehind(games);
  }
  const out: ReelClip[] = [];
  const ordered = film.filter(g => !g.held).slice().sort((a, b) => ((a.date ?? '9999') < (b.date ?? '9999') ? -1 : (a.date ?? '9999') > (b.date ?? '9999') ? 1 : a.key < b.key ? -1 : 1));
  for (const g of ordered) {
    const clips = g.clips
      .filter(c => !filter.stat || c.statKeys.includes(filter.stat))
      .filter(c => !filter.event || c.eventKey === filter.event)
      .filter(c => filter.period == null || c.period === filter.period)
      .slice()
      .sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : 1));
    for (const c of clips) out.push({ ...c, gameKey: g.key, gameTitle: g.title, gameDate: g.date, standing: g.standing });
  }
  return out;
}

/** How many clips are behind each stat at a scope — what makes a number a door. */
export function clipCounts(games: readonly ProfileGame[]): Stats {
  const out: Stats = {};
  for (const g of filmBehind(games)) {
    if (g.held) continue;
    for (const c of g.clips) for (const k of c.statKeys) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** How many clips are behind each stat of ONE game — its own film, or the film that is the same game. Nothing for a held game. */
export function clipCountsOfGame(games: readonly ProfileGame[], key: string): Stats {
  const film = filmOfGame(games, key);
  const out: Stats = {};
  if (!film || film.held || film.standing === 'recreational' && film.key !== key) return out;
  for (const c of film.clips) for (const k of c.statKeys) out[k] = (out[k] ?? 0) + 1;
  return out;
}

export interface ReelItem { id: string; youtubeId: string; startMs: number; endMs: number }

/** The reel as the player walks it: every clip with a definite end (an open clip plays `openMs`). The order is the reel's. */
export function reelPlaylist(clips: ReadonlyArray<Pick<ProfileClip, 'id' | 'youtubeId' | 'startMs' | 'endMs'>>, openMs: number): ReelItem[] {
  return clips.map(c => ({ id: c.id, youtubeId: c.youtubeId, startMs: c.startMs, endMs: c.endMs !== null && c.endMs > c.startMs ? c.endMs : c.startMs + openMs }));
}

/**
 * While item `index` plays with the playhead at `currentMs`: stay, step to
 * the next, or done. A playhead BEFORE the clip's start is the player still
 * arriving (a new video starts at zero for a moment) — stay.
 */
export function reelStep(list: readonly ReelItem[], index: number, currentMs: number): { action: 'stay' } | { action: 'next'; index: number } | { action: 'done' } {
  const cur = list[index];
  if (!cur) return { action: 'done' };
  if (currentMs < cur.endMs) return { action: 'stay' };
  return index + 1 < list.length ? { action: 'next', index: index + 1 } : { action: 'done' };
}

/**
 * What the athlete hid from their page (Tom, Nov 15 2026: the stat still
 * counts). The athlete and their guardian see everything, marked. Anyone
 * else: a hidden GAME keeps only what a total needs — no clips, no periods,
 * `concealed` so the caller drops its row — and a hidden CLIP is gone from
 * every game's clips. Totals are built before or after this; they agree.
 */
export function forViewer(games: readonly ProfileGame[], seesHidden: boolean): ProfileGame[] {
  if (seesHidden) return [...games];
  return games.map(g => {
    if (g.hidden) return { ...g, clips: [], byPeriod: {}, concealed: true };
    return g.clips.some(c => c.hidden) ? { ...g, clips: g.clips.filter(c => !c.hidden) } : g;
  });
}

/**
 * What leaves the server for a viewer who has not chosen to see a held
 * game: the row stays (the game happened, and it is in the totals), its
 * line, its periods and its clips do not.
 */
export function cutHeld(game: ProfileGame): ProfileGame {
  return game.held ? { ...game, stats: {}, byPeriod: {}, clips: [] } : game;
}

export const CLIPS_PAGE = 60;
export const CLIPS_PAGE_MAX = 200;

/** One page of a reel: `cursor` is how many were already taken. */
export function pageOf<T>(items: readonly T[], cursor: number, limit: number = CLIPS_PAGE): { items: T[]; next: number | null } {
  const from = Number.isFinite(cursor) && cursor > 0 ? Math.floor(cursor) : 0;
  const size = Math.min(Math.max(1, Math.floor(limit) || CLIPS_PAGE), CLIPS_PAGE_MAX);
  const page = items.slice(from, from + size);
  return { items: page, next: from + size < items.length ? from + size : null };
}
