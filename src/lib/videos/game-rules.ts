/**
 * The game on a linked video (Sprint 3 PR 2, migration 307) — pure rules.
 * One runtime import: the sheets (themselves zero-import). A video becomes a
 * GAME when it says its sport, its two sides and its day; from then on its
 * tags are read by that sport's sheet (Convention 60). Pinned by
 * src/lib/videos/__tests__/game-rules.test.ts.
 */
import { gameSheetFor } from './game-sheets';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
export type GameCoverage = 'highlights' | 'full';
export const GAME_COVERAGES: readonly GameCoverage[] = ['highlights', 'full'];
export const GAME_SIDE_NAME_MAX = 80;

export const COVERAGE_COPY: Record<GameCoverage, { label: string; note: string }> = {
  highlights: { label: 'Highlights only', note: 'Clips and who was in them. No score is shown — a few highlights are not the final score.' },
  full: { label: 'Every scoring play is tagged', note: 'The score, the box score and the recap are built from the tags, and unlock for viewers as the video plays.' },
};

export interface GameSide { name: string | null; team_id: string | null }

export interface GameInput {
  sport_key: string;
  played_on: string | null;
  side1: GameSide;
  side2: GameSide;
  coverage: GameCoverage;
  stats_hidden: boolean;
}

/** What a reader gets: the row, in the screen's shape. */
export interface GameView extends GameInput {
  video_id: string;
  updated_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = ['sport_key', 'played_on', 'side1', 'side2', 'coverage', 'stats_hidden'] as const;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A real calendar day (2026-02-30 is not one), no earlier than 1900 and no later than a year ahead of `today`. */
export function parseGameDay(v: unknown, today: string): Parsed<string | null> {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v !== 'string' || !DAY.test(v)) return { ok: false, error: 'The date must be a day (YYYY-MM-DD)' };
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return { ok: false, error: 'That date does not exist' };
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCFullYear(limit.getUTCFullYear() + 1);
  if (v < '1900-01-01' || v > limit.toISOString().slice(0, 10)) return { ok: false, error: 'That date is out of range' };
  return { ok: true, value: v };
}

function parseSide(v: unknown, which: string): Parsed<GameSide> {
  if (v === null || v === undefined) return { ok: true, value: { name: null, team_id: null } };
  if (!isObject(v)) return { ok: false, error: `${which} must be an object` };
  for (const k of Object.keys(v)) if (k !== 'name' && k !== 'team_id') return { ok: false, error: `Unknown field ${which}.${k}` };
  let name: string | null = null;
  if (v.name !== null && v.name !== undefined) {
    if (typeof v.name !== 'string') return { ok: false, error: `${which}.name must be text` };
    const t = v.name.trim().replace(/\s+/g, ' ');
    if (t.length > GAME_SIDE_NAME_MAX) return { ok: false, error: `${which}.name is ${GAME_SIDE_NAME_MAX} characters at most` };
    name = t || null;
  }
  let team_id: string | null = null;
  if (v.team_id !== null && v.team_id !== undefined) {
    if (typeof v.team_id !== 'string' || !UUID.test(v.team_id)) return { ok: false, error: `${which}.team_id must be a team id` };
    team_id = v.team_id;
  }
  return { ok: true, value: { name, team_id } };
}

/** PUT /api/videos/[id]/game — the whole game, every time (one small object; no partial writes to cross on the wire). */
export function parseGameBody(body: unknown, today: string): Parsed<GameInput> {
  if (!isObject(body)) return { ok: false, error: 'A game is required' };
  for (const k of Object.keys(body)) if (!(KEYS as readonly string[]).includes(k)) return { ok: false, error: `Unknown field ${k}` };
  if (typeof body.sport_key !== 'string' || !gameSheetFor(body.sport_key)) return { ok: false, error: 'Choose the sport' };
  const day = parseGameDay(body.played_on, today);
  if (!day.ok) return day;
  const side1 = parseSide(body.side1, 'side1');
  if (!side1.ok) return side1;
  const side2 = parseSide(body.side2, 'side2');
  if (!side2.ok) return side2;
  if (side1.value.team_id && side1.value.team_id === side2.value.team_id) return { ok: false, error: 'The two sides cannot be the same team' };
  const coverage = body.coverage ?? 'highlights';
  if (coverage !== 'highlights' && coverage !== 'full') return { ok: false, error: 'coverage must be highlights or full' };
  const hidden = body.stats_hidden ?? true;
  if (typeof hidden !== 'boolean') return { ok: false, error: 'stats_hidden must be true or false' };
  return { ok: true, value: { sport_key: body.sport_key, played_on: day.value, side1: side1.value, side2: side2.value, coverage, stats_hidden: hidden } };
}

/** The name a side shows: what was typed, else "<noun> 1". Races and golf have no sides. */
export function sideLabel(game: Pick<GameInput, 'sport_key' | 'side1' | 'side2'>, side: 1 | 2): string {
  const typed = (side === 1 ? game.side1 : game.side2).name;
  if (typed) return typed;
  return `${gameSheetFor(game.sport_key)?.sideNoun ?? 'Side'} ${side}`;
}

/** Does this sport's game have two sides to name? (A race has a field of athletes; golf has golfers.) */
export function gameHasSides(sportKey: string): boolean {
  const family = gameSheetFor(sportKey)?.family;
  return family === 'team' || family === 'combat';
}

/** Does a score make sense to claim? Only when the sheet keeps a board AND every scoring play is tagged. */
export function gameShowsScore(game: Pick<GameInput, 'sport_key' | 'coverage'>): boolean {
  return game.coverage === 'full' && (gameSheetFor(game.sport_key)?.scoreMode ?? 'none') !== 'none';
}

/** "Lakers vs Celtics" · "Race" for a sport without sides. */
export function gameTitleLine(game: Pick<GameInput, 'sport_key' | 'side1' | 'side2'>): string {
  if (!gameHasSides(game.sport_key)) return gameSheetFor(game.sport_key)?.period.noun ?? 'Game';
  return `${sideLabel(game, 1)} vs ${sideLabel(game, 2)}`;
}
