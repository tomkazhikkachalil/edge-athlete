import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { htmlTableLines, nameInText, parseCardLines } from '../site-card-parse';
import { parseSiteRead, siteCardVerdict } from '../site-card';

// Nov 18 2026: scorecards read out of text by rule (no model). The fixtures
// are the text lines of real course sites' cards from the day's sample: the
// rows a course published, as pdf.js and the page's tables gave them.

interface Fixture { course: string; club: string | null; kind: string; title: string; holesCount: number | null; mapYards: number[] | null; mapPars: number[] | null; lines: string[][] }
const fixtures: Fixture[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'site-card-lines.json'), 'utf8'));
const fx = (course: string) => fixtures.find(f => f.course === course)!;

function run(f: Fixture, nameConfirmed = false) {
  const parsed = parseCardLines(f.lines);
  if (!parsed.ok) return { why: parsed.why, verdict: null, card: null, named: false };
  const named = nameInText(f.lines, f.title, [f.course, f.club]);
  const read = parseSiteRead({ ...parsed.raw, printedName: named ? f.course : null });
  const mapPars = f.mapPars ? f.mapPars.map((par, i) => ({ number: i + 1, par })) : null;
  const r = siteCardVerdict({ name: f.course, club_name: f.club, lat: null, lng: null, holes_count: f.holesCount }, read, null, mapPars, f.mapYards, { singleReading: true, nameConfirmed });
  return { why: null, verdict: r.verdict, card: r.card, named };
}
const totals = (card: NonNullable<ReturnType<typeof run>['card']>) =>
  Object.fromEntries(Object.keys(card.hole_data[0].yardage).map(t => [t, card.hole_data.reduce((s, h) => s + h.yardage[t], 0)]));

describe('the ten cards of the sample that are read, each adding up to its own printed totals', () => {
  const expected: Array<[string, number, Record<string, number>, number]> = [
    ['Park Ridge Golf Course', 72, { 'black tees': 6707, 'gold tees': 6224, 'blue tees': 5745, 'white tees': 5182, 'silver tees': 4700 }, 1],
    ['Seven Canyons', 71, { weiskopf: 6858, member: 6418, regular: 5884, forward: 5143 }, 6],
    ['Heritage Bluffs Public Golf Club', 72, { gold: 7171, black: 6617, green: 6388, silver: 6038, copper: 5035 }, 11],
    ['Edelweiss Chalet Country Club', 72, { blue: 6642, white: 6262, green: 5660, red: 5148 }, 0],
    ['Sheridan Park Golf Course', 71, { blue: 6644, white: 6399, red: 5526, gold: 5387 }, 3],
    ['Callippe Preserve', 72, { 'black 0 6': 6748, 'blue 7 13': 6409, yellow: 5560, red: 4788 }, 5],
    ['Chi Chi Rodriguez Golf Course', 69, { blue: 5313, white: 4864, gold: 4289, red: 3785, 'juniors tee': 2300 }, 7],
    ['Sanctuary Lake Golf Course', 71, { black: 6388, blue: 6006, white: 5294 }, 3],
    ['Aliante Golf Club', 72, { eagle: 7022, falcon: 6657, hawk: 6117, dove: 5340 }, 7],
    ['San Juan Hills Golf Club', 71, { blue: 6317, tournament: 6123, white: 5970, red: 5393 }, 11],
  ];
  for (const [course, par, tees, firstIndex] of expected) {
    it(course, () => {
      const r = run(fx(course));
      expect(r.verdict).toBe('ok');
      expect(r.card).toMatchObject({ total_par: par, holes_count: 18 });
      expect(r.card!.hole_data.reduce((s, h) => s + h.par, 0)).toBe(par);
      expect(totals(r.card!)).toEqual(tees);
      expect(r.card!.hole_data[0].handicap).toBe(firstIndex);
    });
  }
  it('Sanctuary Lake: the tee row whose holes do not add up to its printed total (a misprint on the card) is left out', () => {
    const parsed = parseCardLines(fx('Sanctuary Lake Golf Course').lines);
    expect(parsed.ok && parsed.raw.tees.map(t => t.name)).toEqual(['black', 'blue', 'white', 'red']);
    expect(Object.keys(run(fx('Sanctuary Lake Golf Course')).card!.hole_data[0].yardage)).toEqual(['black', 'blue', 'white']);
  });
});

describe('the cards of the sample that are not read', () => {
  it('a PDF whose text is a course map, and a card laid out in columns: no par row', () => {
    expect(run(fx('Saint Ives')).why).toBe('no_par_row');
    expect(run(fx('Sharon Country Club')).why).toBe('no_par_row');
  });
  it('a sheet with two courses\' cards (a city site): none is read, whatever the name evidence', () => {
    expect(run(fx('Page Belcher Golf Course')).why).toBe('several_cards');
    expect(run(fx('Page Belcher Golf Course'), true).why).toBe('several_cards');
  });
  it('a nine read out of an eighteen is stopped by the map, even with the site confirmed', () => {
    const r = run(fx('Oak Hollow Golf Course'), true);
    expect(r.verdict).not.toBe('ok');
    expect(r.card).toBeNull();
  });
  it('Sweetwater: two courses on one sheet whose pars differ on five holes: none is read (the first prototype would have saved one of them)', () => {
    expect(run(fx('Sweetwater Country Club')).why).toBe('several_cards');
    expect(run(fx('Sweetwater Country Club'), true).why).toBe('several_cards');
  });
  it('a second par row differing on a few holes is the same course\'s ladies\' par: the first is read', () => {
    const men = ['4', '5', '3', '4', '4', '3', '5', '4', '4'];
    const ladies = ['5', '5', '3', '4', '4', '3', '5', '4', '4'];
    const y = ['380', '510', '160', '400', '390', '175', '530', '410', '365'];
    const p = parseCardLines([['Par', ...men, '36', ...men, '36', '72'], ['Blue', ...y, '3320', ...y, '3320', '6640'], ['Par', ...ladies, '37', ...ladies, '37', '74']]);
    expect(p).toMatchObject({ ok: true, raw: { printedPar: 72 } });
    const four = ['5', '4', '4', '5', '4', '3', '5', '4', '4'];
    expect(parseCardLines([['Par', ...men, '36', ...men, '36', '72'], ['Blue', ...y, '3320', ...y, '3320', '6640'], ['Par', ...four, '38', ...men, '36', '74']])).toEqual({ ok: false, why: 'several_cards' });
  });
});

describe('parseCardLines: the shapes of a row', () => {
  const par9 = ['4', '5', '3', '4', '4', '3', '5', '4', '4'];
  const y9 = ['380', '510', '160', '400', '390', '175', '530', '410', '365'];
  it('one row of eighteen with Out, In and Total', () => {
    const p = parseCardLines([['Par', ...par9, '36', ...par9, '36', '72'], ['Blue', ...y9, '3320', ...y9, '3320', '6640']]);
    expect(p).toMatchObject({ ok: true, raw: { printedPar: 72, tees: [{ name: 'blue', printedTotal: 6640 }] } });
    expect(p.ok && p.raw.pars).toHaveLength(18);
  });
  it('two rows of nine: front with Out, back with In and Total (or In, Out, Total)', () => {
    const p = parseCardLines([['Par', ...par9, '36'], ['Blue', ...y9, '3320'], ['Par', ...par9, '36', '72'], ['Blue', ...y9, '3320', '6640']]);
    expect(p).toMatchObject({ ok: true, raw: { printedPar: 72, tees: [{ name: 'blue', printedTotal: 6640 }] } });
    const q = parseCardLines([['Par', ...par9, '36'], ['Blue', ...y9, '3320'], ['Par', ...par9, '36', '36', '72'], ['Blue', ...y9, '3320', '3320', '6640']]);
    expect(q).toMatchObject({ ok: true, raw: { printedPar: 72, tees: [{ printedTotal: 6640 }] } });
  });
  it('a nine-hole card', () => {
    expect(parseCardLines([['Par', ...par9, '36'], ['White', ...y9, '3320'], ['Handicap', '1', '2', '3', '4', '5', '6', '7', '8', '9']])).toMatchObject({ ok: true, raw: { pars: par9.map(Number), printedPar: 36, tees: [{ name: 'white', printedTotal: 3320 }], handicap: [1, 2, 3, 4, 5, 6, 7, 8, 9] } });
  });
  it('merged cells, a rating beside the name and a label repeated mid-row are read through', () => {
    const p = parseCardLines([['PAR', par9.join(' '), '36', par9.join(' '), '36 72'], ['GOLD', '74.9/140', ...y9, '3320', 'GOLD', ...y9, '3320 6640']]);
    expect(p).toMatchObject({ ok: true, raw: { printedPar: 72, tees: [{ name: 'gold', printedTotal: 6640 }] } });
  });
  it('a row of another length is not a row of the card, and nothing is repaired', () => {
    expect(parseCardLines([['Par', ...par9.slice(0, 8)]])).toEqual({ ok: false, why: 'no_par_row' });
    expect(parseCardLines([['Par', ...par9, '36'], ['Blue', ...y9, '3320', '1', '2', '3', '4']])).toEqual({ ok: false, why: 'no_tees' });
    expect(parseCardLines([['Par', '4', '5', '3', '4', '4', '3', '5', '4', '7', '39']])).toEqual({ ok: false, why: 'no_par_row' });
    expect(parseCardLines([['Hole', '1', '2', '3', '4', '5', '6', '7', '8', '9'], ['Handicap', '1', '2', '3', '4', '5', '6', '7', '8', '9']])).toEqual({ ok: false, why: 'no_par_row' });
  });
  it('furniture rows are never tees: Hole, Handicap, Ladies\' Par', () => {
    const p = parseCardLines([['Hole', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Out'], ['Par', ...par9, '36'], ['Yardage', ...y9, '3320'], ['Ladies’ Par', ...par9, '36'], ['Red', ...y9, '3320']]);
    expect(p.ok && p.raw.tees.map(t => t.name)).toEqual(['red']);
  });
  it('metres only when the text says metres and not yards', () => {
    expect(parseCardLines([['Metres'], ['Par', ...par9, '36'], ['White', ...y9, '3320']])).toMatchObject({ ok: true, raw: { unit: 'metres' } });
    expect(parseCardLines([['Yards / Meters'], ['Par', ...par9, '36'], ['White', ...y9, '3320']])).toMatchObject({ ok: true, raw: { unit: 'yards' } });
  });
});

describe('htmlTableLines and nameInText', () => {
  it('rows of a page\'s tables, tags and entities gone, scripts dropped', () => {
    const html = '<title>Scorecard &#8211; Park Ridge Golf Course &#8211; Lake Worth, FL</title><script>var t="<tr><td>9</td></tr>"</script><table><tr><th>Hole&nbsp;#</th><td><b>1</b></td><td>2</td></tr><tr><td>Men&#8217;s Handicap</td><td>1</td><td>&ndash;</td></tr><tr><td></td></tr></table>';
    expect(htmlTableLines(html)).toEqual({ title: 'Scorecard – Park Ridge Golf Course – Lake Worth, FL', lines: [['Hole #', '1', '2'], ['Men’s Handicap', '1', '-']] });
  });
  it('a name is found as a part of the title or a short line, by the catalog\'s own rule', () => {
    expect(nameInText([], 'Scorecard – Park Ridge Golf Course – Lake Worth, FL', ['Park Ridge Golf Course'])).toBe(true);
    expect(nameInText([['SEVEN CANYONS PRIVATE GOLF COURSE']], '', ['Seven Canyons'])).toBe(true);
    expect(nameInText([['Tullymore'], ['Par', '4']], 'Scorecard', ['Saint Ives', null])).toBe(false);
    expect(nameInText([['Welcome to our club']], '', [null, ''])).toBe(false);
  });
});

describe('siteCardVerdict with one reading', () => {
  const read = parseSiteRead({ found: true, printedName: null, pars: [4, 5, 3, 4, 4, 3, 5, 4, 4], printedPar: 36, unit: 'yards', handicap: null, tees: [{ name: 'Blue', yards: [380, 510, 160, 400, 390, 175, 530, 410, 365], printedTotal: 3320 }] });
  const row = { name: 'Camelot Golf & Country Club', club_name: null, lat: null, lng: null, holes_count: null };
  it('without the option a missing second reading is still no card', () => {
    expect(siteCardVerdict(row, read, null, null, null).verdict).toBe('no_site_card');
  });
  it('with it, the one reading is judged; a nameless card needs the map or the caller\'s confirmation', () => {
    expect(siteCardVerdict(row, read, null, null, null, { singleReading: true }).verdict).toBe('name_unconfirmed');
    expect(siteCardVerdict(row, read, null, null, null, { singleReading: true, nameConfirmed: true }).verdict).toBe('ok');
  });
  it('confirmation never overrides a printed name that is another course\'s, the arithmetic or the map', () => {
    const other = parseSiteRead({ found: true, printedName: 'Tullymore', pars: read!.pars, printedPar: 36, unit: 'yards', handicap: null, tees: [{ name: 'Blue', yards: read!.tees[0].yards, printedTotal: 3320 }] });
    const opts = { singleReading: true, nameConfirmed: true };
    expect(siteCardVerdict(row, other, null, null, null, opts).verdict).toBe('name_mismatch');
    expect(siteCardVerdict(row, { ...read!, printedPar: 35 }, null, null, null, opts).verdict).toBe('sum_mismatch');
    expect(siteCardVerdict(row, read, null, null, read!.tees[0].yards.map((y, i) => (i < 5 ? y * 2 : y)), opts).verdict).toBe('yardage_disagrees');
    expect(siteCardVerdict(row, read, null, read!.pars.map((par, i) => ({ number: i + 1, par: i < 3 ? (par === 3 ? 4 : 3) : par })), null, opts).verdict).toBe('map_disagrees');
  });
});
