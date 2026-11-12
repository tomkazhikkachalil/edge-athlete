/**
 * What a viewer of a game sees, and when (Sprint 3 PR 4) — pure. The
 * spoiler-free view: while a game's stats are hidden, a viewer is shown only
 * what the video has already played past — the score, the box score and the
 * highlight list fill in as the playhead moves, and the furthest point
 * watched is kept on the device (skipping back hides nothing). "Show full
 * stats" unlocks everything after a confirm. A manager, and a game whose
 * owner turned spoilers off, see everything at once.
 * Pinned by src/lib/videos/__tests__/game-view.test.ts.
 */
import { nextHighWater, revealMs, type GameTag } from './game-derive';
import type { GameView } from './game-rules';
import { sheetEvent, type GameSheet } from './game-sheets';
import type { HighlightRow } from './types';

/** A highlight as the engine reads it. */
export function gameTagOf(h: HighlightRow): GameTag {
  return {
    id: h.id,
    startMs: h.start_ms,
    endMs: h.end_ms,
    eventKey: h.event_key,
    period: h.period,
    side: h.side,
    value: h.value,
    label: h.label,
    people: h.people.map(p => ({ profileId: p.profile_id, name: p.name, role: p.role, side: p.side })),
  };
}

export type RevealMode = 'all' | 'progressive';

/** Everything at once for a manager, an unlocked viewer, or a game without the spoiler switch; otherwise as the video plays. */
export function revealMode(game: Pick<GameView, 'stats_hidden'> | null, canManage: boolean, unlocked: boolean): RevealMode {
  if (!game || canManage || unlocked || !game.stats_hidden) return 'all';
  return 'progressive';
}

/** The highlights a viewer may be shown: all of them, or only those the video has played past. */
export function visibleHighlights(highlights: readonly HighlightRow[], mode: RevealMode, highWaterMs: number): HighlightRow[] {
  if (mode === 'all') return [...highlights];
  return highlights.filter(h => revealMs({ startMs: h.start_ms, endMs: h.end_ms }) <= highWaterMs);
}

/** How many are still ahead — the only thing said about them ("12 more as you watch"). */
export function hiddenCount(highlights: readonly HighlightRow[], mode: RevealMode, highWaterMs: number): number {
  return highlights.length - visibleHighlights(highlights, mode, highWaterMs).length;
}

// ── What the device remembers per video ─────────────────────────────────────

export interface GameWatch { highWaterMs: number; unlocked: boolean }
export const EMPTY_WATCH: GameWatch = { highWaterMs: 0, unlocked: false };
const WATCH_MAX_MS = 24 * 3600 * 1000;

/** One key per video id (the YouTube id is not secret; nothing personal is stored). */
export function gameWatchKey(videoId: string): string {
  return `ea:game-watch:v1:${videoId}`;
}

export function parseGameWatch(raw: string | null | undefined): GameWatch {
  if (!raw) return EMPTY_WATCH;
  try {
    const v = JSON.parse(raw) as { h?: unknown; u?: unknown };
    const h = typeof v.h === 'number' && Number.isFinite(v.h) ? Math.min(WATCH_MAX_MS, Math.max(0, Math.round(v.h))) : 0;
    return { highWaterMs: h, unlocked: v.u === true };
  } catch {
    return EMPTY_WATCH;
  }
}

export function serializeGameWatch(w: GameWatch): string {
  return JSON.stringify({ h: Math.round(w.highWaterMs), u: w.unlocked });
}

/** The playhead moved: the furthest point only goes forward. Returns the SAME object when nothing changed (no re-render, no write). */
export function advanceWatch(w: GameWatch, playheadMs: number): GameWatch {
  const next = nextHighWater(w.highWaterMs, playheadMs);
  return next === w.highWaterMs ? w : { ...w, highWaterMs: next };
}

/** The sentence under hidden stats. */
export function hiddenNote(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '1 more highlight shows as you watch.' : `${count} more highlights show as you watch.`;
}

// ── The recap ───────────────────────────────────────────────────────────────

export type VideoPageView = 'watch' | 'recap';

/** `?view=recap` opens the recap; anything else is the video. */
export function videoPageView(raw: string | string[] | null | undefined): VideoPageView {
  return (Array.isArray(raw) ? raw[0] : raw) === 'recap' ? 'recap' : 'watch';
}

/** The link a club shares after the game. */
export function recapPath(videoId: string): string {
  return `/videos/${encodeURIComponent(videoId)}?view=recap`;
}

export const TOP_HIGHLIGHTS_MAX = 6;

/**
 * The recap's top highlights: the plays that moved the board or ended it
 * first (in time order), then plain highlights the tagger named, up to `max`.
 * A recap is never a second list of every tag.
 */
export function topHighlights(sheet: GameSheet | null, highlights: readonly HighlightRow[], max: number = TOP_HIGHLIGHTS_MAX): HighlightRow[] {
  const byTime = [...highlights].sort((a, b) => a.start_ms - b.start_ms);
  const big = byTime.filter(h => {
    const e = sheet ? sheetEvent(sheet, h.event_key) : null;
    return !!e && (!!e.score || !!e.finish || e.group === 'result');
  });
  const plain = byTime.filter(h => !h.event_key);
  const rest = byTime.filter(h => !big.includes(h) && !plain.includes(h));
  // Too many scoring plays to list (a basketball game): the named highlights lead, then the scoring plays fill what is left.
  const ordered = big.length > max ? [...plain, ...big, ...rest] : [...big, ...plain, ...rest];
  return ordered.slice(0, Math.max(0, max)).sort((a, b) => a.start_ms - b.start_ms);
}
