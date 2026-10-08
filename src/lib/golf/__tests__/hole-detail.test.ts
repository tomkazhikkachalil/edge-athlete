import { describe, it, expect } from 'vitest';
import { groupScoresForHole, holeHeaderFacts, liveLine, runningToPar, teeSheetForHole, type TeeSheetSource } from '../hole-detail';
import { sampleHoleLine } from '../elevation';
import { polylineYards } from '../hole-geometry';

// Hole-detail program PR D: the one ladder the chip and the scorer share.

const line: [number, number][] = [[45.3, -75.7], [45.3015, -75.6996], [45.303, -75.699]];
const sheet: TeeSheetSource = {
  holes: [{ number: 7, par: 4, yardage: { white: 388, blue: 412, red: 0 }, handicap: 11 }, { number: 8, par: 3, yardage: { white: 160 }, handicap: 0 }],
  courseRating: { white: 70.1, blue: 71.9 },
  slopeRating: { white: 125, blue: 133 },
};

describe('holeHeaderFacts — the ladder', () => {
  it("the round's own hole_data wins: par, yards, stroke index, the tee label", () => {
    const f = holeHeaderFacts({ hole: 7, holeData: [{ hole: 7, par: 4, yardage: 390, handicap: 9 }], sheet, teeInPlay: 'white', line });
    expect(f).toEqual({ par: 4, hcp: 9, yards: 390, approx: false, teeLabel: 'White' });
  });
  it('the catalog sheet fills what the round lacks, on the tee in play with the white/blue/any fallback', () => {
    expect(holeHeaderFacts({ hole: 7, holeData: [{ hole: 7, par: 4 }], sheet, teeInPlay: 'blue' })).toMatchObject({ hcp: 11, yards: 412 });
    expect(holeHeaderFacts({ hole: 7, sheet, teeInPlay: 'gold' })).toMatchObject({ par: 4, yards: 388 });
    expect(holeHeaderFacts({ hole: 8, sheet, teeInPlay: 'blue' })).toMatchObject({ par: 3, hcp: null, yards: 160 });
  });
  it('the drawn line is the last resort, flagged approximate; nothing known → nulls', () => {
    const f = holeHeaderFacts({ hole: 3, line, fallbackPar: 5 });
    expect(f.yards).toBe(polylineYards(line));
    expect(f.approx).toBe(true);
    expect(f.par).toBe(5);
    expect(holeHeaderFacts({ hole: 3 })).toEqual({ par: null, hcp: null, yards: null, approx: false, teeLabel: null });
  });
});

describe('teeSheetForHole', () => {
  it('hardest first, the tee in play first of all, tees without a yardage left out', () => {
    const rows = teeSheetForHole(sheet, 7, 'white');
    expect(rows.map(r => [r.label, r.yards, r.rating, r.slope, r.inPlay])).toEqual([
      ['White', 388, 70.1, 125, true],
      ['Blue', 412, 71.9, 133, false],
    ]);
    expect(teeSheetForHole(sheet, 7, null).map(r => r.key)).toEqual(['blue', 'white']);
    expect(teeSheetForHole(null, 7, 'white')).toEqual([]);
    expect(teeSheetForHole(sheet, 12, 'white')).toEqual([]);
  });
});

describe('liveLine', () => {
  const pts = sampleHoleLine(line, 4);
  const profile = { pts, elev: [100, 102, 105, 106.4] };
  it('from a fix: the distance to the green and the rise read there', () => {
    const l = liveLine({ fix: line[0], line, profile, cardYards: 388 });
    expect(l.kind).toBe('gps');
    expect(typeof l.toGreen).toBe('number');
    expect(l.toGreen).toBeCloseTo(polylineYards(line)!, -1);
    expect(l.riseYds).toBeCloseTo(7, 0);
    expect(l.playsLike).toBe(Math.round(l.toGreen! + l.riseYds!));
  });
  it('without a fix: the card yards (else the line) from the tee', () => {
    const l = liveLine({ line, profile, cardYards: 388 });
    expect(l).toMatchObject({ kind: 'tee', toGreen: 388 });
    expect(l.playsLike).toBe(395);
    expect(liveLine({ line }).toGreen).toBe(polylineYards(line));
  });
  it('no profile → no plays-like; no line → nothing; a fix past the cap falls back to the tee', () => {
    expect(liveLine({ line, cardYards: 388 }).playsLike).toBeNull();
    expect(liveLine({ fix: line[0] }).kind).toBe('none');
    expect(liveLine({ fix: [46.5, -75.7], line, cardYards: 388 })).toMatchObject({ kind: 'tee', toGreen: 388 });
  });
});

describe('runningToPar + groupScoresForHole', () => {
  it('counts only holes with strokes; even par reads 0', () => {
    expect(runningToPar([{ strokes: 4, par: 4 }, { strokes: 5, par: 4 }, { strokes: null, par: 3 }, { strokes: 2, par: 3 }])).toEqual({ toPar: 0, thru: 3 });
    expect(runningToPar([{ strokes: null, par: 4 }])).toBeNull();
  });
  it("the others' strokes on the hole, first names, 'You' for the viewer's own card", () => {
    const group = [
      { participantId: 'me', name: 'Edge Alpha', isSelf: true, holeScores: [{ hole_number: 2, strokes: 4 }] },
      { participantId: 'b', name: 'Edge Bravo', isSelf: false, holeScores: [{ hole_number: 2, strokes: 5 }, { hole_number: 3, strokes: null }] },
      { participantId: 'c', name: 'Charlie', isSelf: false, holeScores: [] },
    ];
    expect(groupScoresForHole(group, 2, 'me')).toEqual([{ label: 'Edge', strokes: 5 }]);
    expect(groupScoresForHole(group, 2, 'b')).toEqual([{ label: 'You', strokes: 4 }]);
    expect(groupScoresForHole(group, 3, 'me')).toEqual([]);
    expect(groupScoresForHole(null, 2, 'me')).toEqual([]);
  });
});

describe('liveLine with a green outline (PR G3)', () => {
  // A 20 m square green centred 30 m past the line's end, due north.
  const mPerDeg = (2 * Math.PI * 6371000) / 360;
  const end = line[line.length - 1];
  const centre: [number, number] = [end[0] + 30 / mPerDeg, end[1]];
  const d = 10 / mPerDeg;
  const dl = d / Math.cos((centre[0] * Math.PI) / 180);
  const green: [number, number][] = [
    [centre[0] - d, centre[1] - dl], [centre[0] - d, centre[1] + dl], [centre[0] + d, centre[1] + dl], [centre[0] + d, centre[1] - dl],
  ];
  it('from a fix: the centre is the centroid, front < centre < back', () => {
    const plain = liveLine({ fix: line[0], line });
    const l = liveLine({ fix: line[0], line, green });
    expect(l.kind).toBe('gps');
    expect(l.toGreen!).toBeGreaterThan(plain.toGreen!);
    expect(l.toGreen! - plain.toGreen!).toBeGreaterThanOrEqual(30);
    expect(l.toGreen! - plain.toGreen!).toBeLessThanOrEqual(36);
    expect(l.front!).toBeLessThan(l.toGreen!);
    expect(l.back!).toBeGreaterThan(l.toGreen!);
    expect(l.back! - l.front!).toBeGreaterThanOrEqual(20);
    expect(l.back! - l.front!).toBeLessThanOrEqual(24);
  });
  it('without a fix, or without an outline, front and back are null and the rest is unchanged', () => {
    expect(liveLine({ line, green, cardYards: 388 })).toMatchObject({ kind: 'tee', toGreen: 388, front: null, back: null });
    expect(liveLine({ fix: line[0], line })).toMatchObject({ front: null, back: null });
    expect(liveLine({})).toMatchObject({ kind: 'none', front: null, back: null });
  });
  it('standing on the green: a centre, no edges', () => {
    const l = liveLine({ fix: centre, line, green });
    expect(l.kind).toBe('gps');
    expect(l.toGreen).toBe(0);
    expect(l.front).toBeNull();
    expect(l.back).toBeNull();
  });
});
