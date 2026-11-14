import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cutForViewer, parseReveal, revealDue, advanceWatch, EMPTY_WATCH, gameTagOf, gameWatchKey, hiddenCount, hiddenNote, parseGameWatch, recapPath, revealMode, serializeGameWatch, topHighlights, videoPageView, visibleHighlights } from '../game-view';
import { GAME_SHEETS } from '../game-sheets';
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

describe('the recap', () => {
  it('?view=recap opens it; anything else is the video; the share link says so', () => {
    expect(videoPageView('recap')).toBe('recap');
    expect(videoPageView(['recap', 'x'])).toBe('recap');
    expect(videoPageView('stats')).toBe('watch');
    expect(videoPageView(undefined)).toBe('watch');
    expect(recapPath('abc')).toBe('/videos/abc?view=recap');
  });
  it('top highlights: the plays that moved the board first, then named highlights, in time order, six at most', () => {
    const soccer = GAME_SHEETS.soccer;
    const list = [h('foul', 5, null, { event_key: 'foul' }), h('nice', 10), h('goal1', 20, null, { event_key: 'goal' }), h('save', 30, null, { event_key: 'save' }), h('goal2', 40, null, { event_key: 'own_goal' })];
    expect(topHighlights(soccer, list, 3).map(x => x.id)).toEqual(['nice', 'goal1', 'goal2']);
    expect(topHighlights(soccer, list).map(x => x.id)).toEqual(['foul', 'nice', 'goal1', 'save', 'goal2']);
    expect(topHighlights(null, list, 2).map(x => x.id)).toEqual(['foul', 'nice']); // not a game: just the first highlights... the named one leads
  });
  it('a game with more scoring plays than fit leads with the highlights the tagger named', () => {
    const bb = GAME_SHEETS.basketball;
    const buckets = Array.from({ length: 10 }, (_, i) => h(`b${i}`, i * 10, null, { event_key: 'fg2_made' }));
    const picked = topHighlights(bb, [...buckets, h('dunk', 55), h('buzzer', 95)], 4).map(x => x.id);
    expect(picked).toEqual(['b0', 'b1', 'dunk', 'buzzer']);
  });
});

/** Round 2 PR 6 (Nov 13 2026): the unwatched plays of a spoiler-free game never leave the server. */
describe('what the server holds back', () => {
  const hidden = { stats_hidden: true };
  const who = (profile_id: string | null) => ({ id: 'p', profile_id, name: 'x', handle: null, avatar_url: null, role: 'scorer', side: null });
  const rows = [
    h('a', 1000, 3000, { event_key: 'fg3_made' }),
    h('b', 5000, null),
    h('c', 15_000, 17_000, { event_key: 'fg2_made', people: [who('me')] }),
  ];
  it('the viewer says how far they have watched, or chooses everything; anything else is the start', () => {
    expect(parseReveal('3000', null)).toEqual({ all: false, uptoMs: 3000 });
    expect(parseReveal(null, null)).toEqual({ all: false, uptoMs: 0 });
    expect(parseReveal('-5', null).uptoMs).toBe(0);
    expect(parseReveal('1e9', null).uptoMs).toBe(0);
    expect(parseReveal('999999999', null).uptoMs).toBe(24 * 3600 * 1000);
    expect(parseReveal('3000', 'all').all).toBe(true);
    expect(parseReveal(null, 'yes').all).toBe(false);
  });
  it('a viewer of a spoiler-free game gets only what the video has played past — a clip at its END — with the counts and the next time', () => {
    const at = (uptoMs: number) => cutForViewer(rows, hidden, false, { all: false, uptoMs }, null);
    expect(at(0)).toEqual({ highlights: [], reveal: { mode: 'progressive', hidden: 3, ahead: 2, next_reveal_ms: 3000, tagged: false } });
    expect(at(2999).highlights).toHaveLength(0);
    expect(at(3000).highlights.map(r => r.id)).toEqual(['a']);
    expect(at(5000)).toMatchObject({ reveal: { hidden: 1, ahead: 1, next_reveal_ms: 17_000 } });
    expect(at(17_000)).toEqual({ highlights: rows, reveal: { mode: 'progressive', hidden: 0, ahead: 0, next_reveal_ms: null, tagged: false } });
  });
  it('a manager, a viewer who chose everything, a game without the switch and a plain video get all of it', () => {
    const all = { mode: 'all', hidden: 0, ahead: 0, next_reveal_ms: null, tagged: false };
    expect(cutForViewer(rows, hidden, true, { all: false, uptoMs: 0 }, null)).toEqual({ highlights: rows, reveal: all });
    expect(cutForViewer(rows, hidden, false, { all: true, uptoMs: 0 }, null)).toEqual({ highlights: rows, reveal: all });
    expect(cutForViewer(rows, { stats_hidden: false }, false, { all: false, uptoMs: 0 }, null)).toEqual({ highlights: rows, reveal: all });
    expect(cutForViewer(rows, null, false, { all: false, uptoMs: 0 }, null)).toEqual({ highlights: rows, reveal: all });
  });
  it('someone tagged in a play still held back is told they are tagged — their removal does not wait for the video', () => {
    expect(cutForViewer(rows, hidden, false, { all: false, uptoMs: 0 }, 'me').reveal.tagged).toBe(true);
    expect(cutForViewer(rows, hidden, false, { all: false, uptoMs: 0 }, 'other').reveal.tagged).toBe(false);
  });
  it('the page asks again only once the video is past the next reveal', () => {
    const r = { mode: 'progressive' as const, next_reveal_ms: 3000 };
    expect(revealDue(r, 2999)).toBe(false);
    expect(revealDue(r, 3000)).toBe(true);
    expect(revealDue({ mode: 'progressive', next_reveal_ms: null }, 99_999)).toBe(false);
    expect(revealDue({ mode: 'all', next_reveal_ms: 3000 }, 99_999)).toBe(false);
    expect(revealDue(null, 99_999)).toBe(false);
  });
  it('the route cuts with the viewer\'s rights and the page sends its watch point on every read', () => {
    const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
    expect(read('src/app/api/videos/[id]/route.ts')).toContain("cutForViewer(read.highlights, game, read.canManage, parseReveal(params_.get('upto'), params_.get('reveal')), user?.id ?? null)");
    const screen = read('src/components/videos/VideoScreen.tsx');
    expect(screen).toContain("const query = w.unlocked ? 'reveal=all' : `upto=${Math.max(0, Math.floor(w.highWaterMs))}`;");
    expect(screen).toContain('revealDue(load.reveal, advanced.highWaterMs)) askReveal(advanced);');
    // The profile's own read of a tagged game derives from the FULL set on the server (it withholds the line itself).
    expect(read('src/lib/videos/video-tagged-server.ts')).not.toContain('cutForViewer');
  });
});
