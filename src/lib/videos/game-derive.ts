/**
 * The game, derived from its tags (Sprint 3, Nov 12 2026) — pure; its one
 * import is the sheets. A tagged game stores NO stats: the score, the box
 * score, the team numbers, the scoring summary and the result are computed
 * here from the tags on every read, so tagging a bucket IS the points going
 * up and deleting the tag is them coming back down. `uptoMs` is the
 * spoiler-free view: the same shape, cut at a playhead.
 */
import { rolePrimary, sheetEvent, type GameSheet, type SheetEvent, type Side } from './game-sheets';

export interface TagPerson {
  /** A linked profile, or null for a typed name. */
  profileId: string | null;
  name: string | null;
  role: string;
  /** Set only when the person is NOT where the role puts them; normally derived from the tag's side. */
  side?: Side | null;
}

export interface GameTag {
  id: string;
  startMs: number;
  endMs: number | null;
  eventKey: string | null;
  period: number | null;
  side: Side | null;
  value: number | null;
  label: string;
  people: readonly TagPerson[];
}

export type Stats = Record<string, number>;

export interface PlayerLine {
  /** `p:<profile id>` or `n:<lower-cased name>` — one line per person per side. */
  key: string;
  profileId: string | null;
  name: string | null;
  side: Side | null;
  stats: Stats;
  /** The tags this person is on, in time order. */
  tagIds: string[];
}

export interface SummaryRow {
  tagId: string;
  ms: number;
  period: number | null;
  side: Side | null;
  eventKey: string;
  label: string;
  /** Who, by role, as tagged. */
  people: readonly TagPerson[];
  /** The board after this tag (total mode: points; sets mode: the points of this set). */
  score: Record<Side, number>;
}

export interface RaceResult {
  key: string;
  profileId: string | null;
  name: string | null;
  /** The race / event this result belongs to (the last `start` tag's label before it, or ''). */
  event: string;
  timeMs: number | null;
  mark: number | null;
  tagId: string;
}

export interface DerivedGame {
  family: GameSheet['family'];
  scoreMode: GameSheet['scoreMode'];
  /** total: points. sets: sets won. none: zeros. */
  score: Record<Side, number>;
  /** Points per period, in period order (a set's points in sets mode). */
  periods: Array<{ period: number; score: Record<Side, number> }>;
  players: PlayerLine[];
  team: Record<Side, Stats>;
  /** Every tag that moved the board, in time order. */
  summary: SummaryRow[];
  /** Combat: how it ended. */
  result: { winner: Side | null; method: string; period: number | null; ms: number } | null;
  /** Race family: finishes (fastest first within an event) and field marks (best first). */
  results: RaceResult[];
  /** Golf: strokes by hole per golfer. */
  holes: Array<{ key: string; profileId: string | null; name: string | null; hole: number; strokes: number; tagId: string }>;
  /** Tags that are counted, in time order. */
  tagIds: string[];
}

const other = (s: Side): Side => (s === 1 ? 2 : 1);
const board = (): Record<Side, number> => ({ 1: 0, 2: 0 });

export function personKey(p: Pick<TagPerson, 'profileId' | 'name'>): string | null {
  if (p.profileId) return `p:${p.profileId}`;
  const n = p.name?.trim().toLowerCase();
  return n ? `n:${n}` : null;
}

function add(into: Stats, key: string, n: number): void {
  if (n) into[key] = (into[key] ?? 0) + n;
}

const amount = (v: number | 'value', tagValue: number | null, fallback: number): number => (v === 'value' ? (tagValue ?? fallback) : v);

/** The value a tag carries, falling back to the event's default (a 2-minute minor, a 3-point takedown). */
export function tagValue(event: SheetEvent, value: number | null): number {
  return value ?? event.takesValue?.default ?? 0;
}

/** A set is won at its target, by two (volleyball 25 / 15; tennis 6 — a 7-5 or a tie-break 7-6 is tagged game by game and closes at seven). */
export function setWinner(sheet: GameSheet, set: number, score: Record<Side, number>): Side | null {
  const target = sheet.setTarget?.(set) ?? 0;
  if (!target) return null;
  const [a, b] = [score[1], score[2]];
  const top = Math.max(a, b);
  if (top < target) return null;
  if (Math.abs(a - b) >= 2 || (sheet.sportKey === 'tennis' && top >= 7)) return a > b ? 1 : 2;
  return null;
}

/**
 * When a tag stops being a spoiler: at the END of its clip (the lead-in to a
 * basket must not show the basket), or at its start when it has no end.
 */
export function revealMs(tag: Pick<GameTag, 'startMs' | 'endMs'>): number {
  return tag.endMs !== null && tag.endMs > tag.startMs ? tag.endMs : tag.startMs;
}

export function deriveGame(sheet: GameSheet, tags: readonly GameTag[], uptoMs: number = Number.POSITIVE_INFINITY): DerivedGame {
  const counted = tags.filter(t => revealMs(t) <= uptoMs).slice().sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
  const out: DerivedGame = {
    family: sheet.family, scoreMode: sheet.scoreMode, score: board(), periods: [], players: [], team: { 1: {}, 2: {} },
    summary: [], result: null, results: [], holes: [], tagIds: [],
  };
  const players = new Map<string, PlayerLine>();
  const periodScore = new Map<number, Record<Side, number>>();
  const total = board();
  let raceEvent = '';

  const lineFor = (p: TagPerson, side: Side | null): PlayerLine | null => {
    const k = personKey(p);
    if (!k) return null;
    const key = `${k}|${side ?? 0}`;
    let line = players.get(key);
    if (!line) {
      line = { key: k, profileId: p.profileId, name: p.name?.trim() || null, side, stats: {}, tagIds: [] };
      players.set(key, line);
    }
    return line;
  };

  for (const tag of counted) {
    const event = sheetEvent(sheet, tag.eventKey);
    if (!event) continue; // a plain marker: a highlight, not a stat
    out.tagIds.push(tag.id);
    const value = tagValue(event, tag.value);

    if (event.key === 'start' && sheet.family === 'race') raceEvent = tag.label.trim();

    // Who gains what. A primary role counts for the side even with nobody named; any other role only for a named person.
    for (const r of event.roles) {
      const holders = tag.people.filter(p => p.role === r.key).slice(0, r.max ?? 1);
      const roleSide = (p?: TagPerson): Side | null => p?.side ?? (tag.side ? (r.other ? other(tag.side) : tag.side) : null);
      const gains = Object.entries(r.stats).map(([k, v]) => [k, amount(v, tag.value, value)] as const);
      if (holders.length === 0) {
        const side = roleSide();
        if (side && rolePrimary(event, r)) for (const [k, n] of gains) add(out.team[side], k, n);
        continue;
      }
      for (const p of holders) {
        const side = roleSide(p);
        const line = lineFor(p, side);
        if (line) {
          for (const [k, n] of gains) add(line.stats, k, n);
          if (!line.tagIds.includes(tag.id)) line.tagIds.push(tag.id);
        }
        if (side) for (const [k, n] of gains) add(out.team[side], k, n);
      }
    }
    // People tagged in a role the sheet does not name still get the clip (never a stat).
    for (const p of tag.people) {
      if (event.roles.some(r => r.key === p.role)) continue;
      const line = lineFor(p, p.side ?? tag.side);
      if (line && !line.tagIds.includes(tag.id)) line.tagIds.push(tag.id);
    }
    if (tag.side && event.team) for (const [k, n] of Object.entries(event.team)) add(out.team[tag.side], k, n);

    // The board.
    if (event.score && tag.side && sheet.scoreMode !== 'none') {
      const to = event.score.to === 'own' ? tag.side : other(tag.side);
      const points = amount(event.score.points, tag.value, value);
      const period = tag.period ?? 1;
      const p = periodScore.get(period) ?? board();
      p[to] += points;
      periodScore.set(period, p);
      total[to] += points;
      out.summary.push({ tagId: tag.id, ms: tag.startMs, period: tag.period, side: to, eventKey: event.key, label: event.label, people: tag.people, score: sheet.scoreMode === 'sets' ? { ...p } : { ...total } });
    }

    if (event.finish && !out.result) out.result = { winner: tag.side, method: event.finish, period: tag.period, ms: tag.startMs };

    if (sheet.family === 'race' && (event.key === 'finish' || event.key === 'attempt')) {
      for (const p of tag.people) {
        const k = personKey(p);
        if (!k) continue;
        out.results.push({ key: k, profileId: p.profileId, name: p.name?.trim() || null, event: raceEvent, timeMs: event.key === 'finish' ? tag.value : null, mark: event.key === 'attempt' ? tag.value : null, tagId: tag.id });
      }
    }
    if (sheet.family === 'golf' && event.key === 'hole_score' && tag.period && tag.value) {
      for (const p of tag.people) {
        const k = personKey(p);
        if (k) out.holes.push({ key: k, profileId: p.profileId, name: p.name?.trim() || null, hole: tag.period, strokes: tag.value, tagId: tag.id });
      }
    }
  }

  out.periods = [...periodScore.entries()].sort((a, b) => a[0] - b[0]).map(([period, score]) => ({ period, score }));
  if (sheet.scoreMode === 'total') out.score = total;
  else if (sheet.scoreMode === 'sets') {
    for (const p of out.periods) {
      const w = setWinner(sheet, p.period, p.score);
      if (w) out.score[w] += 1;
    }
  }
  out.players = [...players.values()].sort((a, b) => (a.side ?? 3) - (b.side ?? 3) || (a.name ?? a.key).localeCompare(b.name ?? b.key));
  // Fastest first, then the best mark; grouped by the event they were tagged under.
  out.results.sort((a, b) => a.event.localeCompare(b.event) || (a.timeMs ?? Infinity) - (b.timeMs ?? Infinity) || (b.mark ?? -Infinity) - (a.mark ?? -Infinity));
  out.holes.sort((a, b) => a.key.localeCompare(b.key) || a.hole - b.hole);
  return out;
}

/** The spoiler-free cut: only what the playhead has passed. */
export function revealAt(sheet: GameSheet, tags: readonly GameTag[], playheadMs: number): DerivedGame {
  return deriveGame(sheet, tags, playheadMs);
}

/** The furthest point watched only ever moves forward: skipping ahead reveals up to there, skipping back hides nothing. */
export function nextHighWater(previousMs: number | null | undefined, playheadMs: number): number {
  const prev = Number.isFinite(previousMs) ? (previousMs as number) : 0;
  return Number.isFinite(playheadMs) ? Math.max(prev, Math.max(0, playheadMs)) : prev;
}

/** A box-score cell: a number, or made–attempted. */
export function cellText(stats: Stats, key: string | readonly [string, string]): string {
  if (typeof key === 'string') return String(stats[key] ?? 0);
  return `${stats[key[0]] ?? 0}-${stats[key[1]] ?? 0}`;
}

/** One athlete's tags in a game, optionally narrowed: by event type, by period, or to the plays that moved the board. */
export interface DrillFilter { eventKeys?: readonly string[]; periods?: readonly number[]; scoringOnly?: boolean }

export function tagsForPerson(sheet: GameSheet, tags: readonly GameTag[], key: string, filter: DrillFilter = {}): GameTag[] {
  return tags
    .filter(t => t.people.some(p => personKey(p) === key))
    .filter(t => !filter.eventKeys?.length || (t.eventKey !== null && filter.eventKeys.includes(t.eventKey)))
    .filter(t => !filter.periods?.length || (t.period !== null && filter.periods.includes(t.period)))
    .filter(t => !filter.scoringOnly || !!sheetEvent(sheet, t.eventKey)?.score)
    .slice()
    .sort((a, b) => a.startMs - b.startMs);
}
