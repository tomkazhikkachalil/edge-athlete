import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { frontBack, golfByCourse, golfListed, golfSeasons, golfTotals, holesOfKind, parseGolfYear, pctText, scoreKindOf, toParText, type GolfHoleRow, type GolfRound } from '../sport-profile/golf-rules';

// Golf's sport profile ("one wave", phase 3, Nov 2026): Career → Season → Round → Hole.
const hole = (n: number, par: number, strokes: number | null, extra: Partial<GolfHoleRow> = {}): GolfHoleRow => ({ n, par, strokes, putts: null, fairway: null, green: null, penalties: 0, ...extra });
const round = (id: string, date: string, extra: Partial<GolfRound> = {}): GolfRound => ({ id, date, course: 'The Marshes', location: null, tee: 'Blue', holes: 18, type: 'outdoor', par: 72, gross: 80, complete: true, hidden: false, holeRows: [], ...extra });

const rounds: GolfRound[] = [
  round('a', '2026-06-01', { gross: 82, holeRows: [hole(1, 4, 5, { putts: 2, fairway: true, green: false }), hole(2, 3, 3, { putts: 2, green: true }), hole(3, 5, 4, { putts: 1, fairway: false, green: true, penalties: 1 })] }),
  round('b', '2026-07-01', { gross: 78, course: ' the marshes ', holeRows: [hole(1, 4, 4, { putts: 2, fairway: true, green: true }), hole(2, 3, 5, { green: false }), hole(3, 5, 3, { fairway: true })] }),
  round('h', '2026-08-01', { gross: 70, hidden: true, holeRows: [hole(1, 4, 3, { fairway: true })] }),
  round('n', '2026-08-10', { holes: 9, par: 36, gross: 41, course: 'Loch March' }),
  round('p', '2026-09-01', { gross: null, complete: false, holeRows: [hole(1, 4, null)] }),
  round('old', '2025-05-05', { gross: 90 }),
];

describe('golf profile rules', () => {
  it('names a score against par; no par or no strokes is nothing', () => {
    expect([scoreKindOf(5, 3), scoreKindOf(4, 3), scoreKindOf(4, 4), scoreKindOf(4, 5), scoreKindOf(3, 6), scoreKindOf(4, 1)]).toEqual(['eagle', 'birdie', 'par', 'bogey', 'double', 'eagle']);
    expect([scoreKindOf(null, 4), scoreKindOf(4, null), scoreKindOf(0, 4)]).toEqual([null, null, null]);
  });

  it('career: a hidden round counts in every total and is never a door for anyone else', () => {
    const t = golfTotals(rounds);
    expect(t.rounds).toBe(6);
    expect(t.scored).toBe(5); // the unfinished round has no score
    expect(t.avg18).toBe(80); // (82 + 78 + 70 + 90) / 4 — the 9-hole round is not an 18
    expect(t.best18).toEqual({ gross: 70, roundId: null, date: '2026-08-01' }); // the hidden round holds the best: counted, not opened
    expect(t.best9).toEqual({ gross: 41, roundId: 'n', date: '2026-08-10' });
    // +10, +6, −2 and +18 over four 18s, +5 over a 9 → 37 over par in 81 holes, per 18
    expect(t.toPar18).toBe(8.2);
    expect(golfTotals(rounds, true).best18).toEqual({ gross: 70, roundId: 'h', date: '2026-08-01' }); // the athlete opens their own hidden round
  });

  it('holes: fairways are asked on par 4s and 5s, an unanswered hole is not an attempt, putts scale to 18', () => {
    const t = golfTotals(rounds);
    expect(t.fairways).toEqual({ hit: 4, of: 5 });
    expect(t.greens).toEqual({ hit: 3, of: 5 });
    expect(t.putts18).toBe(Math.round((7 / 4) * 18 * 10) / 10);
    expect(t.penalties).toBe(1);
    expect(t.holesScored).toBe(7); // the hole with no strokes is not scored
    expect(t.kinds).toEqual({ eagle: 1, birdie: 2, par: 2, bogey: 1, double: 1 });
    expect(t.byPar).toEqual([
      { par: 3, holes: 2, toPar: 1 },
      { par: 4, holes: 3, toPar: 0 },
      { par: 5, holes: 2, toPar: -1.5 },
    ]);
  });

  it('a season is the calendar year, newest first, with its courses — the name matched without case or spaces', () => {
    const seasons = golfSeasons(rounds);
    expect(seasons.map(s => [s.year, s.rounds])).toEqual([['2026', 5], ['2025', 1]]);
    expect(seasons[0].courses.map(c => [c.course, c.rounds, c.best18, c.best9])).toEqual([['The Marshes', 4, 70, null], ['Loch March', 1, null, 41]]);
    expect(golfByCourse([])).toEqual([]);
  });

  it('the list: newest first, never a hidden round for a visitor, no holes, the score against par', () => {
    const listed = golfListed(rounds, false);
    expect(listed.map(r => r.id)).toEqual(['p', 'n', 'b', 'a', 'old']);
    expect(listed.every(r => !('holeRows' in r))).toBe(true);
    expect(listed.map(r => r.toPar)).toEqual([null, 5, 6, 10, 18]);
    expect(golfListed(rounds, true).map(r => r.id)).toContain('h');
  });

  it('a score kind opens its holes: newest round first, then by hole', () => {
    expect(holesOfKind(rounds.filter(r => !r.hidden), 'birdie')).toEqual([{ roundId: 'a', date: '2026-06-01', course: 'The Marshes', n: 3, par: 5, strokes: 4 }]);
    expect(holesOfKind(rounds, 'birdie').map(h => h.roundId)).toEqual(['h', 'a']);
    expect(holesOfKind(rounds, 'par').map(h => [h.roundId, h.n])).toEqual([['b', 1], ['a', 2]]);
  });

  it('front and back nine, over the holes played; putts only when every played hole has them', () => {
    const card = [hole(1, 4, 5, { putts: 2 }), hole(9, 3, 3, { putts: 1 }), hole(10, 5, 6), hole(18, 4, null)];
    expect(frontBack(card)).toEqual({ front: { holes: 2, strokes: 8, par: 7, putts: 3 }, back: { holes: 1, strokes: 6, par: 5, putts: null } });
    expect(frontBack([])).toEqual({ front: null, back: null });
  });

  it('the words and the address', () => {
    expect([toParText(0), toParText(3), toParText(-2), toParText(7.4), toParText(null)]).toEqual(['E', '+3', '−2', '+7.4', '—']);
    expect([pctText({ hit: 5, of: 8 }), pctText({ hit: 0, of: 0 })]).toEqual(['63%', '—']);
    expect([parseGolfYear('2026'), parseGolfYear('26'), parseGolfYear("2026'--"), parseGolfYear(null)]).toEqual(['2026', null, null, null]);
  });

  it('the reader folds the totals over every round and lists only what the viewer may see; the route keeps the sport profile\'s gate', () => {
    const reader = readFileSync(join(__dirname, '../sport-profile/golf-profile-server.ts'), 'utf8');
    expect(reader).toContain('career: golfTotals(rounds, seesHidden)');
    expect(reader).toContain('rounds: golfListed(rounds, seesHidden)');
    expect(reader).toContain('(seesHidden || r.profile_hidden_at === null)');
    const route = readFileSync(join(__dirname, '../../app/api/profile/[profileId]/sport-profile/route.ts'), 'utf8');
    expect(route.indexOf('sportProfileViewer(admin')).toBeLessThan(route.indexOf("if (sport === 'golf')"));
    expect(route).toContain('const seesHidden = who.actsForProfile;');
  });
});
