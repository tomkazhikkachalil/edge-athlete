// ── The live scoring card's rules (Tom's live-round spec, Nov 25 2026) ───────
// Pure, zero imports. What a hole SHOWS before it is scored, when it becomes
// RECORDED, the name and tone of a score, and the totals.
//
//  • A3: every unscored hole opens showing PAR strokes and 2 putts, so a par
//    with two putts needs no input. FIR and GIR start off.
//  • A4: a hole is RECORDED (its strokes stop being null) when the player
//    taps Next — the shown values, defaults included — or as soon as they
//    change strokes or putts, or tap a number to confirm it. A hole that was
//    only LOOKED at (a jump key, Previous) and left untouched stays
//    unrecorded: it has no strokes, counts in no total, gets no check mark.
//    "Recorded" is `strokes !== null`, the same single signal the rest of
//    golf uses for "played" (a golf_hole_scores row existing).
//  • Putts never exceed strokes (the scores API refuses it): lowering the
//    strokes pulls the putts down with it.

export const CARD_STROKES_MIN = 1;
export const CARD_STROKES_MAX = 15;
export const CARD_PUTTS_MIN = 0;
export const CARD_PUTTS_MAX = 10;
export const CARD_PUTTS_DEFAULT = 2;

export interface CardHole {
  strokes?: number | null;
  putts?: number | null;
  par: number;
}

const whole = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

/** What the card shows for a hole: its own values, else par and 2 putts. */
export function shownScore(hole: CardHole): { strokes: number; putts: number } {
  const strokes = typeof hole.strokes === 'number' ? hole.strokes : whole(hole.par, CARD_STROKES_MIN, CARD_STROKES_MAX);
  const putts = typeof hole.putts === 'number' ? hole.putts : CARD_PUTTS_DEFAULT;
  return { strokes, putts: Math.min(putts, strokes) };
}

/** Recorded = it has strokes. */
export function isRecorded(hole: { strokes?: number | null }): boolean {
  return typeof hole.strokes === 'number';
}

/** The player set the strokes: both numbers are written (the putts as
 *  shown, pulled down to the strokes when they would exceed them). */
export function withStrokes(hole: CardHole, strokes: number): { strokes: number; putts: number } {
  const s = whole(strokes, CARD_STROKES_MIN, CARD_STROKES_MAX);
  return { strokes: s, putts: Math.min(shownScore(hole).putts, s) };
}

/** The player set the putts: both numbers are written (the strokes as
 *  shown; the putts never above them, nor above the card's own maximum). */
export function withPutts(hole: CardHole, putts: number): { strokes: number; putts: number } {
  const s = shownScore(hole).strokes;
  return { strokes: s, putts: whole(putts, CARD_PUTTS_MIN, Math.min(CARD_PUTTS_MAX, s)) };
}

/** Next, or a tap on a number: what is shown becomes the hole's score. */
export function confirmedScore(hole: CardHole): { strokes: number; putts: number } {
  return shownScore(hole);
}

/** The most putts the capsule will go to on this hole. */
export function maxPutts(hole: CardHole): number {
  return Math.min(CARD_PUTTS_MAX, shownScore(hole).strokes);
}

// ── The score's name and tone ────────────────────────────────────────────────
export type ScoreTone = 'great' | 'good' | 'text' | 'warn' | 'danger' | 'bad';

/** By strokes minus par: Eagle (−2 or better) · Birdie · Par · Bogey ·
 *  Double · Triple · "+n" from +4. */
export function scoreName(strokes: number, par: number): { name: string; tone: ScoreTone } {
  const diff = strokes - par;
  if (diff <= -2) return { name: 'Eagle', tone: 'great' };
  if (diff === -1) return { name: 'Birdie', tone: 'good' };
  if (diff === 0) return { name: 'Par', tone: 'good' };
  if (diff === 1) return { name: 'Bogey', tone: 'text' };
  if (diff === 2) return { name: 'Double', tone: 'warn' };
  if (diff === 3) return { name: 'Triple', tone: 'bad' };
  return { name: `+${diff}`, tone: 'bad' };
}

/** 0 or 1 putt great · 2 good · 3 danger · 4 or more bad. */
export function puttTone(putts: number): ScoreTone {
  if (putts <= 1) return 'great';
  if (putts === 2) return 'good';
  if (putts === 3) return 'danger';
  return 'bad';
}

/** The CSS variable a tone paints with (inside `.ea-mech`). */
export function toneVar(tone: ScoreTone): string {
  return tone === 'text' ? 'var(--mech-text)' : `var(--mech-${tone})`;
}

// ── The totals strip and the tabs ────────────────────────────────────────────
export interface CardTotals {
  /** Recorded holes. */
  thru: number;
  /** null before any hole is recorded. */
  toPar: number | null;
  strokes: number;
  putts: number;
}

/** Sums over RECORDED holes only. */
export function cardTotals(holes: ReadonlyArray<CardHole>): CardTotals {
  let thru = 0;
  let toPar = 0;
  let strokes = 0;
  let putts = 0;
  for (const h of holes) {
    if (typeof h.strokes !== 'number') continue;
    thru += 1;
    toPar += h.strokes - h.par;
    strokes += h.strokes;
    putts += typeof h.putts === 'number' ? h.putts : 0;
  }
  return { thru, toPar: thru === 0 ? null : toPar, strokes, putts };
}

/** The totals strip's TO PAR cell: "--" before any hole, then E / +n / −n. */
export function toParCell(toPar: number | null): string {
  if (toPar === null) return '--';
  if (toPar === 0) return 'E';
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

/** A player tab's score to par: "0" before any hole is recorded, then E / +n / −n. */
export function toParTab(toPar: number | null): string {
  return toPar === null ? '0' : toParCell(toPar);
}

/** The footer's Next: the NUMBER of the hole it goes to, or null on the last
 *  hole (the caller says "Finish round"). `position` is 1-based in the round;
 *  a back nine starts at hole 10. */
export function nextHoleNumber(position: number, holesPlayed: number, startingHole: number): number | null {
  if (position >= holesPlayed) return null;
  return startingHole + position;
}

/** The jump keys, in rows of nine: an 18 is two rows, a nine is one. */
export function holeKeyRows(holesPlayed: number, startingHole: number): number[][] {
  const numbers = Array.from({ length: Math.max(0, holesPlayed) }, (_, i) => startingHole + i);
  const rows: number[][] = [];
  for (let i = 0; i < numbers.length; i += 9) rows.push(numbers.slice(i, i + 9));
  return rows;
}
