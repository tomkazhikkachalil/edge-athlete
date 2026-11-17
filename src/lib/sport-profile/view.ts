/**
 * The sport profile's place in the URL (Sprint 4 PR 3) — pure, no imports.
 * The drill-down is the address: `?season=2025-26` is a season,
 * `&game=film:<id>` a game, `&stat=goals` the clips behind a number,
 * `?view=clips` the browser. Golf's game is a round (`&game=round:<id>`) and
 * goes one level further, `&hole=7`. Each step down is a history entry, so Back
 * walks up a level; every level is a link someone can be sent.
 */
export type SportProfileTab = 'stats' | 'clips';

export interface SportView {
  tab: SportProfileTab;
  season: string | null;
  game: string | null;
  stat: string | null;
  /** The Clips browser's play type — a sheet event (`goal`). */
  event: string | null;
  /** Golf: one hole of a round, 1–18 (`&game=round:<id>&hole=7`). */
  hole: number | null;
  /** A season's games against one opponent (`&opponent=Owls`) — the opponent split's door. */
  opponent: string | null;
  /** A period's clips at a season (`&period=2`) — the period split's door. */
  period: number | null;
}

const SEASON_RE = /^(undated|\d{4}(-\d{2})?)$/;
// `round:` is golf's game (one wave, phase 3): a golf_rounds id.
const GAME_RE = /^(official|film|post|round):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_RE = /^[a-z0-9_]{2,40}$/;

type Query = { get(name: string): string | null };

/** An opponent's name from the address: trimmed, one line, 60 characters at most; it is only ever COMPARED to the games' own opponents and shown as text. */
function cleanOpponent(value: string | null): string | null {
  const v = (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return v ? v : null;
}

/** What the address says, with anything malformed dropped (a bad link opens the career, never an error). */
export function parseSportView(query: Query): SportView {
  const season = query.get('season');
  const game = query.get('game');
  const stat = query.get('stat');
  const event = query.get('event');
  return {
    tab: query.get('view') === 'clips' ? 'clips' : 'stats',
    season: season && SEASON_RE.test(season) ? season : null,
    game: game && GAME_RE.test(game) ? game : null,
    stat: stat && KEY_RE.test(stat) ? stat : null,
    event: event && KEY_RE.test(event) ? event : null,
    hole: /^([1-9]|1[0-8])$/.test(query.get('hole') ?? '') ? Number(query.get('hole')) : null,
    opponent: cleanOpponent(query.get('opponent')),
    period: /^([1-9]|1[0-9]|20)$/.test(query.get('period') ?? '') ? Number(query.get('period')) : null,
  };
}

/** The query string of a view — '' for the career. Keys in one order, so a level has ONE address. */
export function sportViewSearch(view: Partial<SportView>): string {
  const q: string[] = [];
  if (view.tab === 'clips') q.push('view=clips');
  if (view.season) q.push(`season=${encodeURIComponent(view.season)}`);
  if (view.game) q.push(`game=${encodeURIComponent(view.game)}`);
  if (view.stat) q.push(`stat=${encodeURIComponent(view.stat)}`);
  if (view.event) q.push(`event=${encodeURIComponent(view.event)}`);
  if (view.hole) q.push(`hole=${view.hole}`);
  if (view.opponent) q.push(`opponent=${encodeURIComponent(view.opponent)}`);
  if (view.period) q.push(`period=${view.period}`);
  return q.length ? `?${q.join('&')}` : '';
}

/** Which level the address is: the deepest one it names. */
export function sportViewLevel(view: SportView): 'career' | 'season' | 'game' {
  if (view.game) return 'game';
  if (view.season) return 'season';
  return 'career';
}

/** "2025–26" · "2026" · "No date". */
export function seasonTitle(key: string): string {
  return key === 'undated' ? 'No date' : key.replace('-', '–');
}

/**
 * The sports the switcher offers: the athlete's own order, the ones that HAVE a sport profile (track keeps
 * its numbers on the Sports tab — offering them here would be a dead end). A card with no word on it (an older
 * cached one, a placeholder's) is offered. The first is where a bare link lands.
 */
export function switcherSports<T extends { sportKey: string; enabled: boolean; sportProfile?: boolean }>(cards: readonly T[]): T[] {
  return cards.filter(c => c.enabled !== false && c.sportProfile !== false);
}

/** The sport a link opens: the one it names when the athlete has it, else the first in their order, else null (no sport at all). */
export function landingSport<T extends { sportKey: string; enabled: boolean; sportProfile?: boolean }>(cards: readonly T[], asked: string | null | undefined): string | null {
  const list = switcherSports(cards);
  if (asked && list.some(c => c.sportKey === asked)) return asked;
  return list[0]?.sportKey ?? null;
}

/** A stat cell: whole numbers as they are, anything else to one decimal. */
export function statText(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '–';
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1);
}

/** How a column's number reads: a plain number, a race time (11.85, 4:05.30), or a clock (42:10, 1:02:03). */
export type StatFormat = 'number' | 'race_time' | 'clock';

/** A field's format from its own key: `time_*` is a race time; `pace_*` and `*_s` (moving, elapsed) are a clock. */
export function statFormatOf(key: string): StatFormat {
  if (/^time_/.test(key)) return 'race_time';
  if (/^pace_/.test(key) || /_s$/.test(key)) return 'clock';
  return 'number';
}

/** A stat cell in its column's format. */
export function statCell(n: number | undefined, format: StatFormat = 'number'): string {
  if (n === undefined || !Number.isFinite(n)) return '–';
  if (format === 'number' || n <= 0) return statText(n);
  if (format === 'race_time') {
    if (n < 60) return n.toFixed(2);
    const m = Math.floor(n / 60);
    return `${m}:${(n - m * 60).toFixed(2).padStart(5, '0')}`;
  }
  const total = Math.round(n);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * A game's title from who it was against (Nov 16 2026). "vs" belongs to a sport with two sides; a race's
 * "opponent" is its meet or its place, so it reads as its own name — "Spring Open", never "vs Spring Open".
 */
export function gameTitle(sides: boolean, opponent: string | null | undefined, fallback: string): string {
  const name = (opponent ?? '').trim();
  if (!name) return fallback;
  return sides ? `vs ${name}` : name;
}

/**
 * A stat's name on a page. The stat sheet's label is the ENTRY form's ("100m time (s)", "Pace (s /km)"): the
 * seconds are what you type. A race time or a clock is shown formatted (11.85, 4:40), so the "s" goes and
 * what is left of the unit stays — "100m time", "Pace /km". A plain number keeps its unit ("Distance (km)").
 */
export function statTitle(label: string, format: StatFormat): string {
  if (format === 'number') return label;
  return label.replace(/\s*\(s\s*([^)]*)\)\s*$/, (_m, rest: string) => (rest.trim() ? ` ${rest.trim()}` : ''));
}

/** What one entry of a sport is called, lower case: a "game" where there are two sides, else the sheet's own noun (race, run, ride). */
export interface SportNoun { one: string; many: string }
export function sportNoun(sides: boolean, activityNoun: string | null | undefined): SportNoun {
  const one = sides || !activityNoun ? 'game' : activityNoun.trim().toLowerCase();
  return { one, many: /(s|x|ch|sh)$/.test(one) ? `${one}es` : `${one}s` };
}

/** The first letter up: "race" → "Race". */
export const capitalized = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
