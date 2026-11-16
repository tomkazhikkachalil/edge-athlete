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
}

const SEASON_RE = /^(undated|\d{4}(-\d{2})?)$/;
// `round:` is golf's game (one wave, phase 3): a golf_rounds id.
const GAME_RE = /^(official|film|post|round):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_RE = /^[a-z0-9_]{2,40}$/;

type Query = { get(name: string): string | null };

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
