// ── Reading a scorecard out of TEXT, by rule (Nov 18 2026) — pure ───────────
// Tom: no AI in the app and nothing paid; read what is free. A course that
// publishes its card as a table on a page or as a PDF with real text has
// published rows of numbers, and rows of numbers are read by rule:
//   the par row      "Par" then 9 or 18 values of 3–6 and their printed totals
//   a tee row        a name, then 9 or 18 yardages and their printed totals
//   the stroke index "Handicap" / "HCP", 9 or 18 distinct values
// A card published only as a picture is not read at all.
//
// This file only PROPOSES a card. Whether it may be saved is site-card.ts
// (parseSiteRead holds the shape, siteCardVerdict checks it against the card's
// own printed totals, the course's name, our row and the map). Measured on the
// day's 150-site sample: 16 courses with text, 10 cards through the checks,
// all 10 right hole for hole and tee for tee, none wrong.

import { sameFacilityName } from '@/lib/golf/course-catalog';

const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, '-');

/** A page's table rows as rows of cell texts, and its title. */
export function htmlTableLines(html: string): { title: string; lines: string[][] } {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  const clean = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? '');
  const lines: string[][] = [];
  for (const tr of body.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) ?? []).map(clean);
    if (cells.some(c => c)) lines.push(cells);
  }
  return { title, lines };
}

interface Shape { holes: number[]; out: number | null; inn: number | null; total: number | null; span: 9 | 18 }

/** A run of numbers read as holes and printed totals, by its length:
 *  21 = 9 · Out · 9 · In · Total; 20 = the same without a Total; 18 = holes;
 *  12 = 9 · In · Out · Total; 11 = 9 · In · Total; 10 = 9 · Out; 9 = holes. */
function shapeOf(nums: number[]): Shape | null {
  switch (nums.length) {
    case 21: return { holes: [...nums.slice(0, 9), ...nums.slice(10, 19)], out: nums[9], inn: nums[19], total: nums[20], span: 18 };
    case 20: return { holes: [...nums.slice(0, 9), ...nums.slice(10, 19)], out: nums[9], inn: nums[19], total: null, span: 18 };
    case 18: return { holes: nums, out: null, inn: null, total: null, span: 18 };
    case 12: return { holes: nums.slice(0, 9), out: null, inn: nums[9], total: nums[11], span: 9 };
    case 11: return { holes: nums.slice(0, 9), out: null, inn: nums[9], total: nums[10], span: 9 };
    case 10: return { holes: nums.slice(0, 9), out: nums[9], inn: null, total: null, span: 9 };
    case 9: return { holes: nums, out: null, inn: null, total: null, span: 9 };
    default: return null;
  }
}

/** Two par rows of eighteen differing on more holes than this are two courses. */
export const SAME_COURSE_PAR_DIFF = 3;

const isInt = (s: string) => /^\d{1,4}$/.test(s);
/** A label that is a row of the card's furniture, never a tee's name. */
const NOT_A_TEE = /^(hole|holes|par|handicap|hcp|hdcp|men|mens|ladies|women|womens|net|date|scorer|attest|rating|slope|out|in|tot|total|yards|yardage|stroke|index|si)\b/i;
const PAR_ROW = /^(men'?s )?par\b/i;
const INDEX_ROW = /^(men'?s )?(handicap|hcp|hdcp|stroke index)\b/i;

export type CardParse =
  | { ok: true; raw: { found: true; pars: number[]; printedPar: number | null; unit: 'yards' | 'metres'; tees: Array<{ name: string; yards: number[]; printedTotal: number | null }>; handicap: number[] | null } }
  | { ok: false; why: 'no_par_row' | 'no_tees' | 'several_cards' };

const whole = (front: number | null, back: number | null) => (front != null && back != null ? front + back : null);

/** The card in these lines, as the raw object parseSiteRead validates, or why
 *  there is none. Nothing is repaired or guessed: a row that does not have a
 *  recognised length is not a row of the card. */
export function parseCardLines(lines: ReadonlyArray<ReadonlyArray<string>>): CardParse {
  const rows = lines
    .map(cells => {
      // Cells are split into tokens (a PDF may hand "3531 7171" as one item);
      // a rating such as "74.9/140" and any word inside the run is skipped.
      const tokens = cells.flatMap(c => decodeEntities(c).replace(/[’‘]/g, "'").split(/\s+/)).filter(Boolean);
      let i = 0;
      const label: string[] = [];
      while (i < tokens.length && !isInt(tokens[i])) label.push(tokens[i++]);
      return {
        label: label.filter(t => !/^\d+(\.\d+)?\/\d+$/.test(t)).join(' ').trim(),
        nums: tokens.slice(i).filter(isInt).map(Number),
      };
    })
    .filter(r => r.nums.length >= 9);

  const parRows = rows
    .filter(r => PAR_ROW.test(r.label))
    .map(r => shapeOf(r.nums))
    .filter((s): s is Shape => !!s && s.holes.every(v => v >= 3 && v <= 6));
  if (parRows.length === 0) return { ok: false, why: 'no_par_row' };
  // More than one card in the text (a club's two courses on one sheet): which
  // rows belong to which is not something a rule can say, so none is read.
  // A second par row that differs on a few holes is the same course's other
  // par row (ladies'), and the first is the one read.
  const rowsOf = (span: 9 | 18) => parRows.filter(s => s.span === span).map(s => s.holes);
  const differ = (a: number[], b: number[]) => a.filter((v, i) => v !== b[i]).length;
  const eighteens = rowsOf(18);
  if (eighteens.some(r => differ(r, eighteens[0]) > SAME_COURSE_PAR_DIFF)) return { ok: false, why: 'several_cards' };
  // Nines come as front and back: a third nine unlike both is another course's.
  const nines = rowsOf(9);
  const kinds: number[][] = [];
  for (const r of nines) if (!kinds.some(k => differ(r, k) <= 1)) kinds.push(r);
  if (kinds.length > 2) return { ok: false, why: 'several_cards' };

  let pars: number[];
  let printedPar: number | null;
  const eighteen = parRows.find(s => s.span === 18);
  if (eighteen) {
    pars = eighteen.holes;
    printedPar = eighteen.total ?? whole(eighteen.out, eighteen.inn);
  } else {
    const front = parRows.find(s => s.out != null) ?? parRows[0];
    const back = parRows.find(s => s !== front && (s.inn != null || s.total != null)) ?? parRows.find(s => s !== front);
    if (back) {
      pars = [...front.holes, ...back.holes];
      printedPar = back.total ?? whole(front.out, back.inn);
    } else {
      pars = front.holes;
      printedPar = front.out ?? front.total;
    }
  }

  const byLabel = new Map<string, Shape[]>();
  for (const r of rows) {
    if (!r.label || NOT_A_TEE.test(r.label)) continue;
    const s = shapeOf(r.nums);
    if (!s || !s.holes.every(v => v >= 40 && v <= 800)) continue;
    const key = r.label.toLowerCase();
    byLabel.set(key, [...(byLabel.get(key) ?? []), s]);
  }
  const tees: Array<{ name: string; yards: number[]; printedTotal: number | null }> = [];
  for (const [name, list] of byLabel) {
    if (pars.length === 18) {
      const one = list.find(s => s.span === 18);
      if (one) tees.push({ name, yards: one.holes, printedTotal: one.total ?? whole(one.out, one.inn) });
      else if (list.length >= 2 && list[0].span === 9 && list[1].span === 9) {
        tees.push({ name, yards: [...list[0].holes, ...list[1].holes], printedTotal: list[1].total ?? whole(list[0].out, list[1].inn) });
      }
    } else if (list[0].span === 9) {
      tees.push({ name, yards: list[0].holes, printedTotal: list[0].out ?? list[0].total });
    }
  }
  if (tees.length === 0) return { ok: false, why: 'no_tees' };

  const indexRows = rows.filter(r => INDEX_ROW.test(r.label)).map(r => r.nums);
  let handicap: number[] | null;
  if (pars.length === 18) {
    const nines = indexRows.filter(n => n.length === 9);
    handicap = indexRows.find(n => n.length === 18) ?? (nines.length >= 2 ? [...nines[0], ...nines[1]] : null);
  } else {
    handicap = indexRows.find(n => n.length === 9) ?? null;
  }

  const text = lines.map(l => l.join(' ')).join('\n');
  const unit = /\bmet(re|er)s\b/i.test(text) && !/\byards\b/i.test(text) ? 'metres' : 'yards';
  return { ok: true, raw: { found: true, pars, printedPar, unit, tees, handicap } };
}

/** Is one of these names printed in the text? A short line (or the page's
 *  title) that is the same facility by the catalog's own rule. */
export function nameInText(lines: ReadonlyArray<ReadonlyArray<string>>, title: string, names: ReadonlyArray<string | null | undefined>): boolean {
  const wanted = names.filter((n): n is string => !!n && n.trim().length > 0);
  if (wanted.length === 0) return false;
  const candidates = [...title.split(/\s+[-–—|]\s+/), ...lines.map(l => l.join(' '))].map(s => decodeEntities(s).replace(/\s+/g, ' ').trim()).filter(s => s.length >= 4 && s.length <= 120);
  return candidates.some(text => wanted.some(name => sameFacilityName(name, text)));
}
