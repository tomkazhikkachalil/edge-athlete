import { parsFromTees } from '@/lib/golf/sheet-merge';

/**
 * A scorecard's pars, judged from evidence (Nov 20 2026; migration 317). Pure.
 *
 * Three cards needed hand-run SQL in one day: GolfCourseAPI answers pars per
 * tee box, the boxes contradict each other, and no rule picks the right box
 * every time (measured on 38 production cards: the first box wrong on three,
 * the men's boxes hole by hole wrong on one). So the boxes are KEPT, and a
 * hole they disagree on is settled by a source that does not come from them.
 *
 * Tom's rule (Nov 20): the app may correct a DISPUTED hole's par on a filled
 * card when an independent source settles it: only such holes, only to a par
 * one of the provider's tees gave. A person corrects on the admin console.
 *
 * Per hole, in this order:
 *   1. An admin's decision decides.
 *   2. The provider's voting boxes (the men's, or all when there are none)
 *      agree: that par, `agreed`. Nothing can change it but an admin.
 *   3. They disagree, and the independent sources that speak about the hole
 *      all give ONE par, and it is a par some box of the provider gave:
 *      that par, `settled`.
 *   4. Otherwise `disputed`: the par is parsFromTees' choice (the better
 *      default, not a proof) and the hole waits for evidence or a person.
 * With no provider boxes at all there is nothing to judge: `unknown`.
 *
 * An ESTIMATED map par is never passed in: the caller gives tagged pars only.
 */

export const PAR_BOX_SOURCE = 'golfcourseapi';
export type ParEvidenceSource = 'golfcourseapi' | 'opengolfapi' | 'website' | 'admin';

export interface ParEvidenceRow {
  source: ParEvidenceSource;
  /** The tee box, or '' for a source that answers one par row. */
  label: string;
  /** A men's box votes on the card; a women's box is kept and does not. */
  votes: boolean;
  /** One entry per hole in hole order; null where the source did not say. */
  pars: ReadonlyArray<number | null>;
}

export type ParStatus = 'admin' | 'agreed' | 'settled' | 'disputed' | 'unknown';

export interface HoleJudgement {
  hole: number;
  /** The par the evidence supports, or null when nothing says. */
  par: number | null;
  status: ParStatus;
  /** Every par a provider box gave this hole, lowest first. */
  candidates: number[];
  /** The independent sources that settled it (status `settled`). */
  settledBy?: string[];
  /** What the independent sources said, by source ('map' included). */
  independent: Record<string, number>;
}

const validPar = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p >= 3 && p <= 6;

/** What the independent sources say about each hole: the other provider, the
 *  course's own website, the tagged map. A source that contradicts itself
 *  across rows says nothing about that hole. */
function independentPars(rows: ReadonlyArray<ParEvidenceRow>, mapPars: ReadonlyArray<number | null> | null | undefined, holes: number): Array<Record<string, number>> {
  const out: Array<Record<string, number>> = Array.from({ length: holes }, () => ({}));
  const bySource = new Map<string, Array<ReadonlyArray<number | null>>>();
  for (const r of rows) {
    if (r.source === PAR_BOX_SOURCE || r.source === 'admin') continue;
    bySource.set(r.source, [...(bySource.get(r.source) ?? []), r.pars]);
  }
  if (mapPars) bySource.set('map', [mapPars]);
  for (const [source, lists] of bySource) {
    for (let h = 0; h < holes; h++) {
      const said = new Set(lists.map(l => l[h]).filter(validPar));
      if (said.size === 1) out[h][source] = [...said][0];
    }
  }
  return out;
}

export function judgePars(rows: ReadonlyArray<ParEvidenceRow>, mapPars: ReadonlyArray<number | null> | null | undefined, holes: number): HoleJudgement[] {
  const boxes = rows.filter(r => r.source === PAR_BOX_SOURCE && r.pars.length === holes);
  const admin = rows.filter(r => r.source === 'admin');
  const independent = independentPars(rows, mapPars, holes);
  const voterIndexes = boxes.map((b, i) => (b.votes ? i : -1)).filter(i => i >= 0);
  const voters = voterIndexes.length > 0 ? voterIndexes : boxes.map((_, i) => i);
  const reference = voters[0] ?? 0;
  const chosen = boxes.length > 0 ? parsFromTees(boxes.map(b => b.pars), reference, voters) : null;

  return Array.from({ length: holes }, (_, h): HoleJudgement => {
    const hole = h + 1;
    const candidates = [...new Set(boxes.map(b => b.pars[h]).filter(validPar))].sort((a, b) => a - b);
    const base = { hole, candidates, independent: independent[h] };
    // 1. An admin's decision (the last row that speaks about the hole).
    const decided = admin.map(r => r.pars[h]).filter(validPar).pop();
    if (decided !== undefined) return { ...base, par: decided, status: 'admin' };
    if (!chosen) return { ...base, par: null, status: 'unknown' };
    // 2. The voting boxes agree.
    const voted = new Set(voters.map(i => boxes[i].pars[h]).filter(validPar));
    const fallback = chosen.pars[h] ?? null;
    if (voted.size <= 1) return { ...base, par: fallback, status: fallback === null ? 'unknown' : 'agreed' };
    // 3. They disagree: independent sources that all give one candidate par settle it.
    const said = Object.entries(independent[h]);
    const values = new Set(said.map(([, par]) => par));
    if (values.size === 1) {
      const par = [...values][0];
      if (candidates.includes(par)) return { ...base, par, status: 'settled', settledBy: said.map(([source]) => source).sort() };
    }
    // 4. Still disputed.
    return { ...base, par: fallback, status: 'disputed' };
  });
}

/** The hole numbers still waiting for evidence or a person. */
export function disputedHoles(judged: ReadonlyArray<HoleJudgement>): number[] {
  return judged.filter(j => j.status === 'disputed').map(j => j.hole);
}

export interface ParCorrection {
  hole: number;
  from: number;
  to: number;
  reason: 'settled' | 'admin';
  settledBy: string[];
}

/** What may change on a SAVED card: a hole whose saved par is not the judged
 *  one, and only when the hole was settled by independent evidence or decided
 *  by an admin. An agreed or still-disputed hole is never touched, whatever
 *  the saved card says (a filled card is otherwise not replaced). */
export function parCorrections(saved: ReadonlyArray<{ number: number; par: number }>, judged: ReadonlyArray<HoleJudgement>): ParCorrection[] {
  const out: ParCorrection[] = [];
  for (const j of judged) {
    if (j.status !== 'settled' && j.status !== 'admin') continue;
    const hole = saved.find(s => s.number === j.hole);
    if (!hole || j.par === null || hole.par === j.par) continue;
    out.push({ hole: j.hole, from: hole.par, to: j.par, reason: j.status === 'admin' ? 'admin' : 'settled', settledBy: j.settledBy ?? [] });
  }
  return out;
}

/** A provider's tee boxes as evidence rows. `female` boxes are kept and do
 *  not vote; a women's box named like a men's takes the "(f)" key its
 *  yardages and ratings already use. Boxes without a par row are dropped. */
export function evidenceFromBoxes(source: ParEvidenceSource, male: ReadonlyArray<{ name: string; pars: ReadonlyArray<number | null | undefined> }>, female: ReadonlyArray<{ name: string; pars: ReadonlyArray<number | null | undefined> }>): ParEvidenceRow[] {
  const key = (name: string) => name.toLowerCase().trim();
  const maleKeys = new Set(male.map(b => key(b.name)));
  const rows: ParEvidenceRow[] = [];
  const seen = new Set<string>();
  const push = (label: string, votes: boolean, pars: ReadonlyArray<number | null | undefined>) => {
    const clean = pars.map(p => (validPar(p) ? p : null));
    if (!label || seen.has(label) || !clean.some(p => p !== null)) return;
    seen.add(label);
    rows.push({ source, label: label.slice(0, 60), votes, pars: clean });
  };
  for (const b of male) push(key(b.name), true, b.pars);
  for (const b of female) push(maleKeys.has(key(b.name)) ? `${key(b.name)} (f)` : key(b.name), false, b.pars);
  return rows;
}
