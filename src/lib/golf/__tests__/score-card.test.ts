import { describe, expect, it } from 'vitest';
import { cardTotals, confirmedScore, holeKeyRows, isRecorded, maxPutts, nextHoleNumber, puttTone, scoreName, shownScore, toParCell, toParTab, toneVar, withPutts, withStrokes } from '../score-card';
import { dialArcPath, dialPolar, scoreDialAngle, scoreDialTicks, strokesForPointer } from '../score-dial';
import { colourAlpha, hueOf, playerColour, PLAYER_COLOURS } from '../player-colour';

// The live scoring card (Tom's live-round spec, Nov 25 2026).
describe('shownScore — A3: an unscored hole opens on par and 2 putts', () => {
  it('shows par and two putts until the hole has its own values', () => {
    expect(shownScore({ strokes: null, putts: null, par: 4 })).toEqual({ strokes: 4, putts: 2 });
    expect(shownScore({ strokes: undefined, putts: undefined, par: 5 })).toEqual({ strokes: 5, putts: 2 });
    expect(shownScore({ strokes: 6, putts: 3, par: 4 })).toEqual({ strokes: 6, putts: 3 });
  });
  it('never shows more putts than strokes', () => {
    expect(shownScore({ strokes: 1, putts: null, par: 3 })).toEqual({ strokes: 1, putts: 1 });
  });
});

describe('A4 — when a hole is recorded', () => {
  const fresh = { strokes: null, putts: null, par: 4 };
  it('a hole that was only looked at is not recorded', () => {
    expect(isRecorded(fresh)).toBe(false);
    expect(isRecorded({ strokes: 4 })).toBe(true);
  });
  it('changing the strokes writes both numbers', () => {
    expect(withStrokes(fresh, 5)).toEqual({ strokes: 5, putts: 2 });
    expect(withStrokes({ strokes: 5, putts: 3, par: 4 }, 6)).toEqual({ strokes: 6, putts: 3 });
  });
  it('changing the putts writes both numbers, the strokes as shown', () => {
    expect(withPutts(fresh, 1)).toEqual({ strokes: 4, putts: 1 });
    expect(withPutts({ strokes: 6, putts: 2, par: 4 }, 3)).toEqual({ strokes: 6, putts: 3 });
  });
  it('Next (or a tap on a number) records exactly what is shown, defaults included', () => {
    expect(confirmedScore(fresh)).toEqual({ strokes: 4, putts: 2 });
    expect(confirmedScore({ strokes: 3, putts: 1, par: 4 })).toEqual({ strokes: 3, putts: 1 });
  });
});

describe('the limits', () => {
  it('strokes stay in 1..15', () => {
    expect(withStrokes({ strokes: 1, putts: 0, par: 4 }, 0).strokes).toBe(1);
    expect(withStrokes({ strokes: 15, putts: 2, par: 4 }, 16).strokes).toBe(15);
  });
  it('putts never exceed strokes: a hole in one takes its putts down with it', () => {
    expect(withStrokes({ strokes: null, putts: null, par: 3 }, 1)).toEqual({ strokes: 1, putts: 1 });
    expect(withStrokes({ strokes: 4, putts: 3, par: 4 }, 2)).toEqual({ strokes: 2, putts: 2 });
    expect(withPutts({ strokes: 2, putts: 2, par: 4 }, 3)).toEqual({ strokes: 2, putts: 2 });
    expect(maxPutts({ strokes: 2, putts: 2, par: 4 })).toBe(2);
  });
  it('putts stay in 0..10', () => {
    expect(withPutts({ strokes: 15, putts: 10, par: 4 }, 11).putts).toBe(10);
    expect(withPutts({ strokes: 4, putts: 0, par: 4 }, -1).putts).toBe(0);
    expect(maxPutts({ strokes: 15, putts: 2, par: 5 })).toBe(10);
  });
});

describe('scoreName — A5', () => {
  it.each([
    [1, 4, 'Eagle', 'great'], [2, 4, 'Eagle', 'great'], [3, 5, 'Eagle', 'great'],
    [3, 4, 'Birdie', 'good'], [4, 4, 'Par', 'good'], [5, 4, 'Bogey', 'text'],
    [6, 4, 'Double', 'warn'], [7, 4, 'Triple', 'bad'], [8, 4, '+4', 'bad'], [12, 3, '+9', 'bad'],
  ] as const)('%i on a par %i is %s (%s)', (strokes, par, name, tone) => {
    expect(scoreName(strokes, par)).toEqual({ name, tone });
  });
  it('putts: 0 or 1 great, 2 good, 3 danger, 4 or more bad', () => {
    expect([0, 1, 2, 3, 4, 7].map(puttTone)).toEqual(['great', 'great', 'good', 'danger', 'bad', 'bad']);
  });
  it('a tone names its token; "text" is the text colour', () => {
    expect(toneVar('good')).toBe('var(--mech-good)');
    expect(toneVar('text')).toBe('var(--mech-text)');
  });
});

describe('cardTotals — only recorded holes count', () => {
  const holes = [
    { strokes: 4, putts: 2, par: 4 },
    { strokes: null, putts: null, par: 3 }, // viewed, untouched
    { strokes: 6, putts: 3, par: 5 },
    { strokes: 3, putts: null, par: 4 },
  ];
  it('thru, to par, strokes and putts', () => {
    expect(cardTotals(holes)).toEqual({ thru: 3, toPar: 0, strokes: 13, putts: 5 });
    expect(cardTotals([])).toEqual({ thru: 0, toPar: null, strokes: 0, putts: 0 });
  });
  it('the TO PAR cell reads "--" before any hole, the tab reads "0"', () => {
    expect([null, 0, 2, -1].map(toParCell)).toEqual(['--', 'E', '+2', '-1']);
    expect([null, 0, 2, -1].map(toParTab)).toEqual(['0', 'E', '+2', '-1']);
  });
});

describe('A10 — Next names the hole', () => {
  it('the next hole\'s NUMBER, null on the last hole', () => {
    expect(nextHoleNumber(1, 18, 1)).toBe(2);
    expect(nextHoleNumber(17, 18, 1)).toBe(18);
    expect(nextHoleNumber(18, 18, 1)).toBeNull();
    // A back nine: position 1 is hole 10.
    expect(nextHoleNumber(1, 9, 10)).toBe(11);
    expect(nextHoleNumber(9, 9, 10)).toBeNull();
  });
  it('the jump keys come in rows of nine', () => {
    expect(holeKeyRows(18, 1)).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9], [10, 11, 12, 13, 14, 15, 16, 17, 18]]);
    expect(holeKeyRows(9, 10)).toEqual([[10, 11, 12, 13, 14, 15, 16, 17, 18]]);
    expect(holeKeyRows(0, 1)).toEqual([]);
  });
});

describe('the strokes dial — A1 / A2', () => {
  it('0 at −135, par at the top, double par at +135, on every par', () => {
    for (const par of [3, 4, 5]) {
      expect(scoreDialAngle(0, par)).toBe(-135);
      expect(scoreDialAngle(par, par)).toBe(0);
      expect(scoreDialAngle(2 * par, par)).toBe(135);
    }
  });
  it('above double par the dial stays full', () => {
    expect(scoreDialAngle(9, 4)).toBe(135);
    expect(scoreDialAngle(15, 3)).toBe(135);
  });
  it('one step is 270 / (2 × par) degrees', () => {
    expect(scoreDialAngle(1, 4)).toBeCloseTo(-135 + 33.75);
    expect(scoreDialAngle(1, 3)).toBe(-90);
  });
  it('one tick per stroke from 0 to double par, except at par', () => {
    expect(scoreDialTicks(3).map(t => t.value)).toEqual([0, 1, 2, 4, 5, 6]);
    expect(scoreDialTicks(4)).toHaveLength(8);
    expect(scoreDialTicks(5)).toHaveLength(10);
    expect(scoreDialTicks(4).some(t => t.angle === 0)).toBe(false);
  });
  it('a pointer straight up is par; at the ends it is 1 (never 0) and double par', () => {
    expect(strokesForPointer(0, -50, 4)).toBe(4);
    expect(strokesForPointer(0, -50, 5)).toBe(5);
    // −135°: down-left.
    expect(strokesForPointer(-50, 50, 4)).toBe(1);
    // +135°: down-right.
    expect(strokesForPointer(50, 50, 4)).toBe(8);
    expect(strokesForPointer(50, 50, 3)).toBe(6);
  });
  it('moves in whole strokes: 90° right on a par 4 is 4 + 8·(90/270) → 7', () => {
    expect(strokesForPointer(50, 0, 4)).toBe(7);
    expect(strokesForPointer(-50, 0, 4)).toBe(1);
    expect(strokesForPointer(-50, 0, 5)).toBe(2);
  });
  it('a pointer in the open bottom snaps to the nearer end', () => {
    expect(strokesForPointer(-5, 60, 4)).toBe(1);
    expect(strokesForPointer(5, 60, 4)).toBe(8);
  });
  it('bad input is 1, never NaN', () => {
    expect(strokesForPointer(Number.NaN, 0, 4)).toBe(1);
    expect(strokesForPointer(10, 10, 0)).toBe(1);
  });
  it('polar: 0° is straight up, 90° is right; the arc takes the long way past 180°', () => {
    expect(dialPolar(95, 95, 78, 0)).toEqual({ x: 95, y: 17 });
    const right = dialPolar(95, 95, 78, 90);
    expect(right.x).toBeCloseTo(173);
    expect(right.y).toBeCloseTo(95);
    expect(dialArcPath(95, 95, 78, -135, 135)).toMatch(/ A 78 78 0 1 1 /);
    expect(dialArcPath(95, 95, 78, -135, 0)).toMatch(/ A 78 78 0 0 1 /);
  });
});

describe('player colours', () => {
  it('the spec\'s three first, by place in the round, repeating past the end', () => {
    expect([0, 1, 2].map(playerColour)).toEqual(['#8B5CF6', '#4DA3FF', '#2DD4BF']);
    expect(playerColour(PLAYER_COLOURS.length)).toBe(PLAYER_COLOURS[0]);
    expect(playerColour(-1)).toBe(PLAYER_COLOURS[0]);
  });
  it('none is green, gold, yellow, orange or red — those hues mean a score', () => {
    for (const hex of PLAYER_COLOURS) {
      const hue = hueOf(hex);
      // red / orange / gold / yellow: 0–70 and 330–360; green: 70–165.
      expect(hue, `${hex} hue ${hue}`).toBeGreaterThan(165);
      expect(hue, `${hex} hue ${hue}`).toBeLessThan(330);
    }
    expect(new Set(PLAYER_COLOURS).size).toBe(PLAYER_COLOURS.length);
  });
  it('a colour at an alpha, without color-mix', () => {
    expect(colourAlpha('#8B5CF6', 0.22)).toBe('rgb(139 92 246 / 0.22)');
    expect(colourAlpha('nope', 0.5)).toBe('nope');
  });
});
