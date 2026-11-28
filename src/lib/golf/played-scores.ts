// ── An already-played round's scores, before the round exists ────────────────
// Pure, zero imports (Nov 27 2026). Tom: rounds already played, outdoor and
// indoor, follow the live round. The live scoring card is the entry (its
// batch mode); the composer holds every player's holes until Create Post,
// and these are the rules between the two:
//   • a card save REPLACES the holes it names on that player's row and
//     leaves the rest alone (the card sends every recorded hole);
//   • a row's line on the Scores step and the Create step: "18 holes · 82 ·
//     +10", "5 of 18 holes · 23 · +3", "No scores yet";
//   • an INDOOR round on Auto 2 records 2 putts on every hole, never more
//     than the strokes (Tom, Nov 27 2026: the played card follows the
//     putting rule). Gimme and Putt out leave the putts as entered.

export interface PlayedHole {
  hole_number: number;
  strokes?: number;
  putts?: number;
  fairway_hit?: boolean;
  green_in_regulation?: boolean;
  penalties?: string[] | null;
  penalty_strokes?: number[] | null;
}

/** What the scoring card hands back for one recorded hole. */
export interface SavedHole {
  hole_number: number;
  strokes: number;
  putts?: number;
  fairway_hit?: boolean;
  green_in_regulation?: boolean;
  penalties?: string[] | null;
  penalty_strokes?: number[] | null;
}

const scored = (h: { strokes?: number | null }): boolean => typeof h.strokes === 'number' && h.strokes > 0;

/** One player's row after a card save: each saved hole takes its slot; a
 *  hole the row has no slot for (outside the grid) is dropped; every other
 *  player, and every hole the save does not name, is untouched. */
export function mergeCardSave<P extends { participant_id: string; hole_scores: PlayedHole[] }>(
  players: readonly P[],
  participantId: string,
  saved: readonly SavedHole[],
): P[] {
  const byHole = new Map(saved.filter(scored).map(h => [h.hole_number, h]));
  return players.map(player => {
    if (player.participant_id !== participantId) return player;
    const hole_scores = player.hole_scores.map(slot => {
      const next = byHole.get(slot.hole_number);
      if (!next) return slot;
      const hole: PlayedHole = { hole_number: slot.hole_number, strokes: next.strokes };
      if (typeof next.putts === 'number') hole.putts = next.putts;
      if (typeof next.fairway_hit === 'boolean') hole.fairway_hit = next.fairway_hit;
      if (typeof next.green_in_regulation === 'boolean') hole.green_in_regulation = next.green_in_regulation;
      if (next.penalties && next.penalties.length > 0) {
        hole.penalties = [...next.penalties];
        hole.penalty_strokes = next.penalty_strokes ? [...next.penalty_strokes] : null;
      }
      return hole;
    });
    return { ...player, hole_scores };
  });
}

export interface PlayedCard {
  /** Holes with strokes. */
  holes: number;
  strokes: number;
  /** null before any hole. */
  toPar: number | null;
}

/** A row's totals over its scored holes; `parOf` answers a hole's par. */
export function playedCard(holes: readonly PlayedHole[], parOf: (hole: number) => number): PlayedCard {
  let count = 0;
  let strokes = 0;
  let toPar = 0;
  for (const h of holes) {
    if (!scored(h)) continue;
    count += 1;
    strokes += h.strokes as number;
    toPar += (h.strokes as number) - parOf(h.hole_number);
  }
  return { holes: count, strokes, toPar: count === 0 ? null : toPar };
}

/** "E", "+3", "−2" (a real minus sign, as the card's totals read). */
export function toParWord(toPar: number): string {
  if (toPar === 0) return 'E';
  return toPar > 0 ? `+${toPar}` : `−${Math.abs(toPar)}`;
}

/** The date played, for the Create step's summary: "Nov 27, 2026" from
 *  "2026-11-27". English month names on purpose (the app's one language),
 *  no Date object, so no time zone can move the day. Anything else is
 *  returned as it came. */
export function playedDateLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] : undefined;
  if (!m || !month) return date;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

export const NO_SCORES_YET = 'No scores yet';

/** The row's one line: "18 holes · 82 · +10" for a full card, "5 of 18
 *  holes · 23 · +3" for a part of one, "No scores yet" for none. */
export function playedCardLine(card: PlayedCard, gridHoles: number): string {
  if (card.holes === 0 || card.toPar === null) return NO_SCORES_YET;
  const holes = card.holes >= gridHoles ? `${card.holes} holes` : `${card.holes} of ${gridHoles} holes`;
  return `${holes} · ${card.strokes} · ${toParWord(card.toPar)}`;
}

/** The putts a rule fixes on every hole: 2 for Auto 2, nothing otherwise
 *  (an outdoor round has no rule). */
export function fixedPutts(rule: { mode: string } | null | undefined): number | null {
  return rule?.mode === 'auto_2' ? 2 : null;
}

/** A score under the rule: with fixed putts, the putts are that number,
 *  never above the strokes (a hole in one is one stroke, one putt at most). */
export function ruledScore<S extends { strokes: number; putts: number }>(score: S, fixed: number | null): S {
  return fixed === null ? score : { ...score, putts: Math.min(fixed, score.strokes) };
}

/** Every scored hole of every row under the rule (the round as it is sent):
 *  a rule changed after holes were entered still reaches them. */
export function withPuttingRule<P extends { hole_scores: PlayedHole[] }>(players: readonly P[], fixed: number | null): P[] {
  if (fixed === null) return [...players];
  return players.map(player => ({
    ...player,
    hole_scores: player.hole_scores.map(h => (scored(h) ? { ...h, putts: Math.min(fixed, h.strokes as number) } : h)),
  }));
}

// ── Saving the scores of a round that was just created ───────────────────────
// The round is created first (completed, a draft post), its scores second.
// A finished round WITHOUT scores draws no scorecard and has no door to add
// them, so that state must never be left behind: the save is tried
// `SCORE_SAVE_ATTEMPTS` times, and if no card was saved the round is deleted
// and the composer keeps everything for another try.

export const SCORE_SAVE_ATTEMPTS = 3;

export type ScoreSaveOutcome = 'saved' | 'partial' | 'failed';

/** What a scores response means. `ok` false, or no card saved: failed. Some
 *  cards saved and some refused: partial (the round stands, the person is
 *  told). */
export function scoreSaveOutcome(ok: boolean, body: { results?: unknown; failures?: unknown } | null): ScoreSaveOutcome {
  if (!ok) return 'failed';
  const saved = Array.isArray(body?.results) ? body.results.length : 0;
  const refused = Array.isArray(body?.failures) ? body.failures.length : 0;
  if (saved === 0) return 'failed';
  return refused > 0 ? 'partial' : 'saved';
}
