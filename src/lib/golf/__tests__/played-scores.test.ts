import { describe, it, expect } from 'vitest';
import {
  NO_SCORES_YET,
  SCORE_SAVE_ATTEMPTS,
  fixedPutts,
  mergeCardSave,
  playedCard,
  playedCardLine,
  playedDateLabel,
  ruledScore,
  scoreSaveOutcome,
  toParWord,
  withPuttingRule,
  type PlayedHole,
} from '../played-scores';

const blank = (n: number): PlayedHole[] => Array.from({ length: n }, (_, i) => ({ hole_number: i + 1 }));
const row = (id: string, holes: PlayedHole[]) => ({ participant_id: id, name: id, hole_scores: holes });

describe('mergeCardSave — a card save lands on one player, hole by hole', () => {
  it('writes the saved holes on that player and leaves everyone else alone', () => {
    const players = [row('me', blank(18)), row('sam', blank(18))];
    const next = mergeCardSave(players, 'me', [
      { hole_number: 1, strokes: 4, putts: 2 },
      { hole_number: 2, strokes: 5, putts: 3, fairway_hit: false, green_in_regulation: true },
    ]);
    expect(next[0].hole_scores[0]).toEqual({ hole_number: 1, strokes: 4, putts: 2 });
    expect(next[0].hole_scores[1]).toEqual({ hole_number: 2, strokes: 5, putts: 3, fairway_hit: false, green_in_regulation: true });
    expect(next[0].hole_scores[2]).toEqual({ hole_number: 3 });
    expect(next[1]).toBe(players[1]);
    expect(next[0].name).toBe('me');
  });
  it('keeps a hole the save does not name, and replaces one it does', () => {
    const players = [row('me', [{ hole_number: 1, strokes: 6, putts: 3 }, { hole_number: 2, strokes: 4, putts: 2 }])];
    const next = mergeCardSave(players, 'me', [{ hole_number: 1, strokes: 5, putts: 2 }]);
    expect(next[0].hole_scores).toEqual([{ hole_number: 1, strokes: 5, putts: 2 }, { hole_number: 2, strokes: 4, putts: 2 }]);
  });
  it('carries each penalty with its strokes, and clears them when the save has none', () => {
    const players = [row('me', [{ hole_number: 1, strokes: 6, penalties: ['water'], penalty_strokes: [2] }])];
    const kept = mergeCardSave(players, 'me', [{ hole_number: 1, strokes: 7, putts: 2, penalties: ['water', 'ob'], penalty_strokes: [1, 2] }]);
    expect(kept[0].hole_scores[0]).toEqual({ hole_number: 1, strokes: 7, putts: 2, penalties: ['water', 'ob'], penalty_strokes: [1, 2] });
    const cleared = mergeCardSave(players, 'me', [{ hole_number: 1, strokes: 5, putts: 2, penalties: [], penalty_strokes: null }]);
    expect(cleared[0].hole_scores[0]).toEqual({ hole_number: 1, strokes: 5, putts: 2 });
  });
  it('drops a hole outside the grid and a hole without strokes', () => {
    const players = [row('me', blank(9))];
    const next = mergeCardSave(players, 'me', [{ hole_number: 12, strokes: 4 }, { hole_number: 3, strokes: 0 }]);
    expect(next[0].hole_scores).toEqual(blank(9));
  });
  it('an unknown player changes nothing', () => {
    const players = [row('me', blank(9))];
    expect(mergeCardSave(players, 'nobody', [{ hole_number: 1, strokes: 4 }])).toEqual(players);
  });
});

describe('playedCard and its line', () => {
  const par = () => 4;
  it('counts only scored holes', () => {
    expect(playedCard(blank(18), par)).toEqual({ holes: 0, strokes: 0, toPar: null });
    expect(playedCard([{ hole_number: 1, strokes: 5 }, { hole_number: 2 }, { hole_number: 3, strokes: 3 }], par)).toEqual({ holes: 2, strokes: 8, toPar: 0 });
  });
  it('uses each hole’s own par', () => {
    const pars: Record<number, number> = { 1: 3, 2: 5 };
    expect(playedCard([{ hole_number: 1, strokes: 4 }, { hole_number: 2, strokes: 4 }], h => pars[h])).toEqual({ holes: 2, strokes: 8, toPar: 0 });
  });
  it('reads "No scores yet", a part of a card, and a full card', () => {
    expect(playedCardLine({ holes: 0, strokes: 0, toPar: null }, 18)).toBe(NO_SCORES_YET);
    expect(playedCardLine({ holes: 5, strokes: 23, toPar: 3 }, 18)).toBe('5 of 18 holes · 23 · +3');
    expect(playedCardLine({ holes: 18, strokes: 82, toPar: 10 }, 18)).toBe('18 holes · 82 · +10');
    expect(playedCardLine({ holes: 9, strokes: 34, toPar: -2 }, 9)).toBe('9 holes · 34 · −2');
  });
  it('to par: E, +n, and a real minus sign', () => {
    expect(toParWord(0)).toBe('E');
    expect(toParWord(4)).toBe('+4');
    expect(toParWord(-1)).toBe('−1');
  });
});

describe('playedDateLabel', () => {
  it('reads a day as words, and leaves anything else alone', () => {
    expect(playedDateLabel('2026-11-27')).toBe('Nov 27, 2026');
    expect(playedDateLabel('2026-01-05')).toBe('Jan 5, 2026');
    expect(playedDateLabel('2026-13-05')).toBe('2026-13-05');
    expect(playedDateLabel('')).toBe('');
  });
});

describe('the putting rule on an already-played indoor card', () => {
  it('only Auto 2 fixes the putts', () => {
    expect(fixedPutts({ mode: 'auto_2' })).toBe(2);
    expect(fixedPutts({ mode: 'gimme' })).toBeNull();
    expect(fixedPutts({ mode: 'putt_out' })).toBeNull();
    expect(fixedPutts(null)).toBeNull();
    expect(fixedPutts(undefined)).toBeNull();
  });
  it('a score under Auto 2 has 2 putts, never more than its strokes', () => {
    expect(ruledScore({ strokes: 5, putts: 4 }, 2)).toEqual({ strokes: 5, putts: 2 });
    expect(ruledScore({ strokes: 1, putts: 0 }, 2)).toEqual({ strokes: 1, putts: 1 });
    expect(ruledScore({ strokes: 5, putts: 4 }, null)).toEqual({ strokes: 5, putts: 4 });
  });
  it('the rule reaches holes entered before it was chosen, and never invents a score', () => {
    const players = [row('me', [{ hole_number: 1, strokes: 5, putts: 4 }, { hole_number: 2 }, { hole_number: 3, strokes: 1, putts: 0 }])];
    expect(withPuttingRule(players, 2)[0].hole_scores).toEqual([{ hole_number: 1, strokes: 5, putts: 2 }, { hole_number: 2 }, { hole_number: 3, strokes: 1, putts: 1 }]);
    expect(withPuttingRule(players, null)[0]).toBe(players[0]);
  });
});

describe('scoreSaveOutcome — a finished round never stays without scores', () => {
  it('tries three times', () => {
    expect(SCORE_SAVE_ATTEMPTS).toBe(3);
  });
  it('failed: a refused request, or one that saved no card', () => {
    expect(scoreSaveOutcome(false, null)).toBe('failed');
    expect(scoreSaveOutcome(false, { results: [{}] })).toBe('failed');
    expect(scoreSaveOutcome(true, { results: [], failures: [] })).toBe('failed');
    expect(scoreSaveOutcome(true, null)).toBe('failed');
  });
  it('saved: every card; partial: some refused', () => {
    expect(scoreSaveOutcome(true, { results: [{}, {}], failures: [] })).toBe('saved');
    expect(scoreSaveOutcome(true, { results: [{}] })).toBe('saved');
    expect(scoreSaveOutcome(true, { results: [{}], failures: [{}] })).toBe('partial');
  });
});
