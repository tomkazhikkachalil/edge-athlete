import { describe, it, expect } from 'vitest';
import { advanceWatch, EMPTY_WATCH, gameTagOf, gameWatchKey, hiddenCount, hiddenNote, parseGameWatch, revealMode, serializeGameWatch, visibleHighlights } from '../game-view';
import type { HighlightRow } from '../types';

/** The spoiler-free view (Sprint 3 PR 4): a viewer sees only what the video has played past. */
const h = (id: string, start: number, end: number | null = null, more: Partial<HighlightRow> = {}): HighlightRow => ({
  id, video_id: 'v', start_ms: start, end_ms: end, label: id, meta: {}, created_by_user_id: null, created_at: '', updated_at: '', event_key: null, period: null, side: null, value: null, people: [], ...more,
});

describe('revealMode', () => {
  const hidden = { stats_hidden: true };
  it('a viewer of a hidden game watches it unfold; a manager, an unlock, or spoilers off show everything', () => {
    expect(revealMode(hidden, false, false)).toBe('progressive');
    expect(revealMode(hidden, true, false)).toBe('all');
    expect(revealMode(hidden, false, true)).toBe('all');
    expect(revealMode({ stats_hidden: false }, false, false)).toBe('all');
    expect(revealMode(null, false, false)).toBe('all'); // not a game: nothing to spoil
  });
});

describe('what is shown', () => {
  const list = [h('a', 10_000), h('b', 22_000, 34_000), h('c', 90_000)];
  it('progressive: only what the furthest point has passed — a clip at its END', () => {
    expect(visibleHighlights(list, 'progressive', 0)).toEqual([]);
    expect(visibleHighlights(list, 'progressive', 10_000).map(x => x.id)).toEqual(['a']);
    expect(visibleHighlights(list, 'progressive', 30_000).map(x => x.id)).toEqual(['a']);
    expect(visibleHighlights(list, 'progressive', 34_000).map(x => x.id)).toEqual(['a', 'b']);
    expect(hiddenCount(list, 'progressive', 34_000)).toBe(1);
  });
  it('all: everything, and nothing is counted as hidden', () => {
    expect(visibleHighlights(list, 'all', 0)).toHaveLength(3);
    expect(hiddenCount(list, 'all', 0)).toBe(0);
  });
  it('the note says only how many are ahead', () => {
    expect(hiddenNote(0)).toBe('');
    expect(hiddenNote(1)).toBe('1 more highlight shows as you watch.');
    expect(hiddenNote(12)).toBe('12 more highlights show as you watch.');
  });
});

describe('what the device remembers', () => {
  it('the furthest point only moves forward, and an unchanged watch is the same object', () => {
    const w = advanceWatch(EMPTY_WATCH, 30_000);
    expect(w).toEqual({ highWaterMs: 30_000, unlocked: false });
    expect(advanceWatch(w, 5_000)).toBe(w); // skipped back: nothing hides, nothing is written
    expect(advanceWatch(w, 90_000).highWaterMs).toBe(90_000); // skipped ahead: revealed up to there
  });
  it('round-trips; junk, nothing and out-of-range values are the empty watch or clamped', () => {
    expect(parseGameWatch(serializeGameWatch({ highWaterMs: 61_234.6, unlocked: true }))).toEqual({ highWaterMs: 61_235, unlocked: true });
    expect(parseGameWatch(null)).toEqual(EMPTY_WATCH);
    expect(parseGameWatch('{nope')).toEqual(EMPTY_WATCH);
    expect(parseGameWatch('{"h":-5,"u":"yes"}')).toEqual(EMPTY_WATCH);
    expect(parseGameWatch('{"h":9e15}').highWaterMs).toBe(24 * 3600 * 1000);
    expect(gameWatchKey('abc')).toBe('ea:game-watch:v1:abc');
  });
});

describe('gameTagOf', () => {
  it('a highlight as the engine reads it', () => {
    const row = h('t', 1000, 4000, { event_key: 'fg3_made', period: 2, side: 1, value: null, label: 'Three', people: [{ id: 'r1', profile_id: 'p1', name: 'Ann', handle: 'ann', avatar_url: null, role: 'scorer', side: null }] });
    expect(gameTagOf(row)).toEqual({ id: 't', startMs: 1000, endMs: 4000, eventKey: 'fg3_made', period: 2, side: 1, value: null, label: 'Three', people: [{ profileId: 'p1', name: 'Ann', role: 'scorer', side: null }] });
  });
});
