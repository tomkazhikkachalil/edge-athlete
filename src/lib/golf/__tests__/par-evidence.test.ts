import { describe, it, expect } from 'vitest';
import { disputedHoles, evidenceFromBoxes, judgePars, parCorrections, type ParEvidenceRow } from '../par-evidence';

// Nov 20 2026 (migration 317): a card's pars are judged from kept evidence.
// The shapes are GolfCourseAPI's real answers, read that day.
const pars = (s: string) => s.split('').map(Number);
const box = (label: string, s: string, votes = true): ParEvidenceRow => ({ source: 'golfcourseapi', label, votes, pars: pars(s) });
const one = (source: ParEvidenceRow['source'], s: Array<number | null>): ParEvidenceRow => ({ source, label: '', votes: false, pars: s });
const only = (hole: number, par: number, holes = 18) => Array.from({ length: holes }, (_, i) => (i === hole - 1 ? par : null));
const row = (judged: ReturnType<typeof judgePars>) => judged.map(j => j.par).join('');
const card = (s: string) => pars(s).map((par, i) => ({ number: i + 1, par }));

const ANGUS_SOUTH = [box('black', '534443545443454534'), box('gold', '434443545443454534'), box('blue', '434443545443454534'), box('white', '434443444443454434'), box('red', '434443444443444434'), box('white (f)', '434443545443454534', false), box('red (f)', '434443545443454534', false)];
const CHAMPLAIN = [box('blue', '535354344534443444'), box('white', '535344344534443444'), box('yellow', '434344344434443444'), box('red', '434344344434443444'), box('white (f)', '535355344535443444', false), box('yellow (f)', '535344344534443444', false), box('rouge', '535344344534443444', false)];
const RIVERMEAD = [...['1', '1-2', '2', '2-3', '3'].map(n => box(n, '534445434354444354')), ...['1 (f)', '1-2 (f)', '2 (f)', '2-3 (f)', '3 (f)', '4'].map(n => box(n, '534455534354444355', false))];

describe('judgePars', () => {
  it('boxes that agree: every hole agreed, nothing disputed', () => {
    const j = judgePars([box('blue', '443'), box('white', '443')], null, 3);
    expect(j.map(x => x.status)).toEqual(['agreed', 'agreed', 'agreed']);
    expect(disputedHoles(j)).toEqual([]);
  });

  it('Angus Glen South with no other source: the default card, five holes disputed', () => {
    const j = judgePars(ANGUS_SOUTH, null, 18);
    expect(row(j)).toBe('434443545443454534');
    expect(disputedHoles(j)).toEqual([1, 7, 9, 14, 16]);
    expect(j[0].candidates).toEqual([4, 5]);
  });

  it('Champlain: the default is wrong on hole 5 (three short tees outvote the back tee); the course\'s own website settles it', () => {
    const alone = judgePars(CHAMPLAIN, null, 18);
    expect(alone[4]).toMatchObject({ par: 4, status: 'disputed', candidates: [4, 5] });
    const withSite = judgePars([...CHAMPLAIN, one('website', pars('535354344534443444'))], null, 18);
    expect(withSite[4]).toMatchObject({ par: 5, status: 'settled', settledBy: ['website'] });
    expect(row(withSite)).toBe('535354344534443444');
    expect(disputedHoles(withSite)).toEqual([]);
  });

  it('the tagged map settles a hole too, and two independent sources that agree are both named', () => {
    const j = judgePars([...ANGUS_SOUTH, one('opengolfapi', only(1, 4))], only(1, 4), 18);
    expect(j[0]).toMatchObject({ par: 4, status: 'settled', settledBy: ['map', 'opengolfapi'] });
  });

  it('independent sources that contradict each other settle nothing', () => {
    const j = judgePars([...ANGUS_SOUTH, one('website', only(1, 5))], only(1, 4), 18);
    expect(j[0]).toMatchObject({ par: 4, status: 'disputed', independent: { website: 5, map: 4 } });
  });

  it('an independent par that no box of the provider gave settles nothing', () => {
    const j = judgePars([...ANGUS_SOUTH, one('website', only(1, 3))], null, 18);
    expect(j[0]).toMatchObject({ par: 4, status: 'disputed' });
  });

  it('a hole the voting boxes agree on is never reopened by another source or by the women\'s boxes (Rivermead)', () => {
    const j = judgePars([...RIVERMEAD, one('website', pars('534455534354444355'))], null, 18);
    expect(row(j)).toBe('534445434354444354');
    expect(j[4]).toMatchObject({ par: 4, status: 'agreed', candidates: [4, 5], independent: { website: 5 } });
  });

  it('an admin\'s decision decides, on any hole and to any par', () => {
    const j = judgePars([...RIVERMEAD, one('admin', only(5, 5)), one('admin', only(2, 6))], null, 18);
    expect(j[4]).toMatchObject({ par: 5, status: 'admin' });
    expect(j[1]).toMatchObject({ par: 6, status: 'admin' });
  });

  it('no provider boxes: nothing to judge', () => {
    const j = judgePars([one('website', pars('443'))], [4, 4, 3], 3);
    expect(j.map(x => x.status)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(j.map(x => x.par)).toEqual([null, null, null]);
  });

  it('with no men\'s box the women\'s boxes vote; a box of another length is ignored', () => {
    const j = judgePars([box('red', '445', false), box('gold', '445', false), box('nine', '44', false)], null, 3);
    expect(row(j)).toBe('445');
    expect(j.map(x => x.status)).toEqual(['agreed', 'agreed', 'agreed']);
  });
});

describe('parCorrections: what may change on a saved card', () => {
  it('a settled hole whose saved par differs is corrected; agreed and disputed holes are left alone', () => {
    // Champlain as the first-box rule saved it, hole 5 right, but say hole 1 was saved wrong and hole 3 disputed.
    const judged = judgePars([...CHAMPLAIN, one('website', pars('535354344534443444'))], null, 18);
    expect(parCorrections(card('535354344534443444'), judged)).toEqual([]);
    expect(parCorrections(card('535344344534443444'), judged)).toEqual([{ hole: 5, from: 4, to: 5, reason: 'settled', settledBy: ['website'] }]);
  });

  it('a disputed hole is never changed, even when the saved par is not the default', () => {
    const judged = judgePars(ANGUS_SOUTH, null, 18);
    expect(parCorrections(card('534443545443454534'), judged)).toEqual([]);
  });

  it('an agreed hole is never changed either: a saved card that differs there is not this rule\'s business', () => {
    const judged = judgePars([box('blue', '443'), box('white', '443')], null, 3);
    expect(parCorrections(card('543'), judged)).toEqual([]);
  });

  it('an admin decision corrects the saved card', () => {
    const judged = judgePars([...ANGUS_SOUTH, one('admin', only(1, 4))], null, 18);
    expect(parCorrections(card('534443545443454534'), judged)).toEqual([{ hole: 1, from: 5, to: 4, reason: 'admin', settledBy: [] }]);
  });
});

describe('evidenceFromBoxes', () => {
  it('men\'s boxes vote, women\'s are kept and do not; a shared name takes (f); empty boxes are dropped', () => {
    const rows = evidenceFromBoxes('golfcourseapi', [{ name: 'Blue', pars: [4, 3] }, { name: 'Blue', pars: [5, 3] }, { name: 'Gold', pars: [null, undefined] }], [{ name: 'blue', pars: [5, 3] }, { name: 'Red', pars: [4, 9] }]);
    expect(rows).toEqual([
      { source: 'golfcourseapi', label: 'blue', votes: true, pars: [4, 3] },
      { source: 'golfcourseapi', label: 'blue (f)', votes: false, pars: [5, 3] },
      { source: 'golfcourseapi', label: 'red', votes: false, pars: [4, null] },
    ]);
  });
});

describe('taggedMapPars: the map as evidence, hole by hole', () => {
  it('a tagged hole is evidence, an untagged one is not; a map with no tag at all is none', async () => {
    const { taggedMapPars } = await import('../par-evidence');
    expect(taggedMapPars([{ hole: 2, par: 4 }, { hole: 1, par: null }, { hole: 3 }], 3)).toEqual([null, 4, null]);
    expect(taggedMapPars([{ hole: 1 }, { hole: 2 }], 2)).toBeNull();
    expect(taggedMapPars(null, 9)).toBeNull();
  });
  it('a map of another shape is not this card\'s evidence', async () => {
    const { taggedMapPars } = await import('../par-evidence');
    expect(taggedMapPars([{ hole: 1, par: 4 }], 2)).toBeNull();                       // fewer holes
    expect(taggedMapPars([{ hole: 1, par: 4 }, { hole: 1, par: 4 }], 2)).toBeNull();   // a hole twice
    expect(taggedMapPars([{ hole: 1, par: 4 }, { hole: 7, par: 4 }], 2)).toBeNull();   // out of range
    expect(taggedMapPars([{ hole: 1, par: 9 }, { hole: 2, par: 4 }], 2)).toEqual([null, 4]); // not a par
  });
});
