import { describe, it, expect } from 'vitest';
import { disputedHoles, evidenceFromBoxes, judgePars, judgementCounts, lengthVotes, openHoles, parCorrections, type ParEvidenceRow } from '../par-evidence';
import { estimatePar } from '../map-sheet';
import { believablePar, parsFromTees } from '../sheet-merge';
import realHoles from './fixtures/par-disputed-holes.json';

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
    expect(alone[4]).toMatchObject({ par: 4, status: 'accepted', candidates: [4, 5] });
    const withSite = judgePars([...CHAMPLAIN, one('website', pars('535354344534443444'))], null, 18);
    expect(withSite[4]).toMatchObject({ par: 5, status: 'settled', settledBy: ['website'] });
    expect(row(withSite)).toBe('535354344534443444');
    expect(disputedHoles(withSite)).toEqual([]);
  });

  it('the tagged map settles a hole too, and two independent sources that agree are both named', () => {
    const j = judgePars([...ANGUS_SOUTH, one('opengolfapi', only(1, 4))], only(1, 4), 18);
    expect(j[0]).toMatchObject({ par: 4, status: 'settled', settledBy: ['map', 'opengolfapi'] });
  });

  it('the map ALONE only leans: it may confirm a saved par and never changes one (Champlain hole 3, the first production sweep)', () => {
    // OpenStreetMap tags hole 3 as a par 4; the club's published card says 5.
    const j = judgePars(CHAMPLAIN, only(3, 4), 18);
    expect(j[2]).toMatchObject({ par: 4, status: 'leaning', settledBy: ['map'], candidates: [4, 5] });
    const saved = card('535354344534443444');
    expect(parCorrections(saved, j)).toEqual([]);
    // Nothing waits for a person: a lean changes nothing, and holes the tees
    // merely disagree on are decided by the rule (Tom, Nov 20: "need to use logic").
    expect(openHoles(saved, j)).toEqual([]);
    expect(openHoles(saved, judgePars(CHAMPLAIN, only(3, 5), 18))).toEqual([]);
    // A hole SETTLED against the saved par is open until the card is corrected, and only that one.
    const settled = judgePars([...CHAMPLAIN, one('website', only(3, 4))], null, 18);
    expect(settled[2].status).toBe('settled');
    expect(openHoles(saved, settled)).toEqual([3]);
    expect(openHoles(card('534354344534443444'), settled)).toEqual([]);
    // The same par from the course's own website settles it.
    expect(judgePars([...CHAMPLAIN, one('website', only(3, 5))], null, 18)[2]).toMatchObject({ par: 5, status: 'settled', settledBy: ['website'] });
  });

  it('strong sources that contradict each other settle nothing; a strong one is not outvoted by the map', () => {
    const j = judgePars([...ANGUS_SOUTH, one('website', only(1, 5)), one('opengolfapi', only(1, 4))], null, 18);
    expect(j[0]).toMatchObject({ par: 4, status: 'accepted', independent: { website: 5, opengolfapi: 4 } });
    // The club's own card against one mapper's tag (Champlain's 3rd, for real): the card decides.
    const club = judgePars([...ANGUS_SOUTH, one('website', only(1, 4))], only(1, 5), 18);
    expect(club[0]).toMatchObject({ par: 4, status: 'settled', settledBy: ['website'], independent: { website: 4, map: 5 } });
  });

  it('an independent par that no box of the provider gave settles nothing', () => {
    const j = judgePars([...ANGUS_SOUTH, one('website', only(1, 3))], null, 18);
    expect(j[0]).toMatchObject({ par: 4, status: 'accepted' });
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

// Nov 20 2026, the evening: the 40 holes production held whose men's tees
// disagree, as the provider answered them (tee, par, yards), with the par on
// the saved card. 27 of the 40 were checked against a club's published card.
describe('decided by logic: the 40 real holes whose men\'s tees disagree', () => {
  type Real = { course: string; hole: number; saved: number; boxes: Array<[string, number | null, number | null]> };
  const holes = realHoles as Real[];
  const judgeOne = (r: Real, extra: ParEvidenceRow[] = [], map: number | null = null, length = true) => {
    const rows: ParEvidenceRow[] = r.boxes.map(([label, par]) => ({ source: 'golfcourseapi', label, votes: true, pars: [par] }));
    const yards = [Object.fromEntries(r.boxes.filter(b => b[2] !== null).map(b => [b[0], b[2]]))];
    return judgePars([...rows, ...extra], map === null ? null : [map], 1, { yards, lengthPars: length ? lengthVotes(yards, r.boxes.map(b => b[0]), estimatePar) : null })[0];
  };
  /** The rule's own default: what the tees and their lengths give with no confirmation at all. */
  const defaultOf = (r: Real) => {
    const j = judgeOne(r, [], null, false);
    expect(j.status).toBe('accepted');
    return j.par;
  };

  it('every one is decided without a person, and none is impossible', () => {
    expect(holes).toHaveLength(40);
    for (const r of holes) {
      const j = judgeOne(r);
      expect(['accepted', 'leaning'], `${r.course} ${r.hole}`).toContain(j.status);
      expect(openHoles([{ number: 1, par: r.saved }], [j])).toEqual([]);
      expect(parCorrections([{ number: 1, par: r.saved }], [j])).toEqual([]);
    }
  });

  it('the default is the saved, checked par on 38 of 40; neither miss can be told from the tees alone', () => {
    const misses = holes.filter(r => defaultOf(r) !== r.saved).map(r => `${r.course} ${r.hole}`);
    // Amberwood Village's 2nd: par 5 from blue, par 4 from white on the club's own card.
    // Champlain's 5th: only the back tee carries the card's par (blue 5 at 478, white 4 at 460):
    // the same shape as Angus Glen South's 1st, where the card says the opposite.
    // What a confirmation is for; neither is changed without one.
    expect(misses.sort()).toEqual(['Amberwood Village 2', 'Champlain 5']);
  });

  it('the two longest tees decide when they agree (Angus Glen North 11); a back tee alone does not (Angus Glen South 1)', () => {
    const north11 = holes.find(r => r.course.includes('(North)') && r.hole === 11)!;
    expect(north11.boxes.map(b => b[1])).toEqual([5, 5, 4, 4, 4]);
    expect(defaultOf(north11)).toBe(5);
    const south1 = holes.find(r => r.course.includes('(South)') && r.hole === 1)!;
    expect(south1.boxes.map(b => b[1])).toEqual([5, 4, 4, 4, 4]);
    expect(defaultOf(south1)).toBe(4);
    // Its length (490 from the back) leans to 5, and a lean never changes a card.
    expect(judgeOne(south1)).toMatchObject({ status: 'leaning', par: 5 });
    expect(parCorrections([{ number: 1, par: 4 }], [judgeOne(south1)])).toEqual([]);
    // Without lengths the count decides, as before.
    expect(parsFromTees(north11.boxes.map(b => [b[1]])).pars).toEqual([4]);
  });

  it('a par impossible for its length does not vote (Eagles Nest 1: the white box says par 3 at 501 yards)', () => {
    const nest1 = holes.find(r => r.course.startsWith('Eagles Nest') && r.hole === 1)!;
    expect(nest1.boxes.find(b => b[0] === 'white')).toEqual(['white', 3, 501]);
    const j = judgeOne(nest1);
    expect(j.candidates).toEqual([4, 5]);
    expect(defaultOf(nest1)).toBe(5);
  });

  it('the hole\'s length is one weak vote: alone it leans, with the map it settles, against the map nothing settles', () => {
    const south7 = holes.find(r => r.course.includes('(South)') && r.hole === 7)!;   // 517 yards from the back
    expect(judgeOne(south7)).toMatchObject({ status: 'leaning', par: 5, settledBy: ['length'] });
    expect(judgeOne(south7, [], 5)).toMatchObject({ status: 'settled', par: 5, settledBy: ['length', 'map'] });
    expect(judgeOne(south7, [], 4)).toMatchObject({ status: 'accepted', par: 5 });
    // A strong source settles alone, with or against the hole's length.
    expect(judgeOne(south7, [one('website', [5])])).toMatchObject({ status: 'settled', settledBy: ['length', 'website'] });
    expect(judgeOne(south7, [one('website', [4])])).toMatchObject({ status: 'settled', par: 4, settledBy: ['website'] });
    // Two weak ones that contradict each other settle nothing, whichever way.
    expect(judgeOne(south7, [], 4).settledBy).toBeUndefined();
  });

  it('length is silent near a boundary and never a par by itself', () => {
    expect(lengthVotes([{ blue: 465 }, { blue: 517 }, { blue: 150 }, { blue: 250 }, {}], ['blue'], estimatePar)).toEqual([null, 5, 3, null, null]);
    expect(lengthVotes([{ red: 517, blue: 300 }], ['blue'], estimatePar)).toEqual([4]); // only the voting tees
  });
});

describe('impossible data: the one thing left for a person', () => {
  it('believablePar is wide: real forward tees pass, only the plainly impossible fails', () => {
    expect(believablePar(4, 130)).toBe(true);    // Camelot's forward tee
    expect(believablePar(5, 235)).toBe(true);
    expect(believablePar(3, 501)).toBe(false);   // Eagles Nest, white
    expect(believablePar(3, 391)).toBe(false);   // Kanata
    expect(believablePar(5, 150)).toBe(false);
    expect(believablePar(4, null)).toBe(true);   // an unknown length passes
    expect(believablePar(4, 0)).toBe(true);
  });

  it('a hole NO tee gives a believable par for is impossible and listed; the card keeps what it has', () => {
    const rows = [box('blue', '34'), box('white', '34')];
    const yards = [{ blue: 520, white: 480 }, { blue: 400, white: 380 }];
    const j = judgePars(rows, null, 2, { yards });
    expect(j[0]).toMatchObject({ status: 'impossible', par: 3, candidates: [] });
    expect(j[1]).toMatchObject({ status: 'agreed', par: 4 });
    const saved = card('34');
    expect(openHoles(saved, j)).toEqual([1]);
    expect(parCorrections(saved, j)).toEqual([]);
    expect(judgementCounts(j)).toEqual({ confirmed: 0, byRule: 0, impossible: 1 });
    // A tee with no length on the card does not vouch for the hole.
    expect(judgePars([...rows, box('red (f)', '34', false)], null, 2, { yards })[0].status).toBe('impossible');
    // An admin's decision closes it.
    expect(openHoles(saved, judgePars([...rows, one('admin', [5, null])], null, 2, { yards }))).toEqual([]);
  });

  it('bad lengths never turn a card into no card: with no believable box the boxes still give the par', () => {
    expect(parsFromTees([[3, 4], [3, 4]], 0, undefined, [[520, 400], [480, 380]]).pars).toEqual([3, 4]);
  });

  it('an independent row of another length is another card and says nothing', () => {
    const j = judgePars([...ANGUS_SOUTH, one('website', [4, 4, 4, 4, 4, 4, 4, 4, 4])], null, 18);
    expect(j[0]).toMatchObject({ status: 'accepted', independent: {} });
  });
});

describe('parCorrections: what may change on a saved card', () => {
  it('a settled hole whose saved par differs is corrected; agreed and rule-accepted holes are left alone', () => {
    // Champlain as the first-box rule saved it, hole 5 right, but say hole 1 was saved wrong and hole 3 disputed.
    const judged = judgePars([...CHAMPLAIN, one('website', pars('535354344534443444'))], null, 18);
    expect(parCorrections(card('535354344534443444'), judged)).toEqual([]);
    expect(parCorrections(card('535344344534443444'), judged)).toEqual([{ hole: 5, from: 4, to: 5, reason: 'settled', settledBy: ['website'] }]);
  });

  it('a hole the rule accepted is never changed, even when the saved par is not the default', () => {
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
