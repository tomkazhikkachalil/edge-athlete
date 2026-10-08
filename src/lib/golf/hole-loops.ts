// ── Pickable nines (map sweep PR 4, Oct 2026) ───────────────────────────────
// A club whose OSM hole ways split into clean loops that nothing labels is
// stored as `sections` ("A", "B", "C" — letters, never a guessed name) with
// `holes: []`: NOTHING is drawn until the player picks a loop or the GPS
// fix is unmistakably on one (Tom's decision: pickable nines, never a wrong
// overlay). Pure, zero React: the live page asks these three questions.

import { composeHoleGeometry, type HoleGeometry, type HoleSection } from '@/lib/golf/hole-geometry';
import { haversineKm } from '@/lib/golf/geocode';

export type LatLng = [number, number];

/** A fix this close to ONE loop's tee, with every rival tee clearly farther,
 *  picks the loop by itself. */
export const LOOP_AUTOPICK_M = 150;
/** A rival tee must be this many times farther than the nearest for the
 *  auto-pick to count (or beyond LOOP_RIVAL_MIN_M). */
export const LOOP_RIVAL_FACTOR = 2;
export const LOOP_RIVAL_MIN_M = 300;

const metres = (a: LatLng, b: LatLng) => haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) * 1000;

/** The nearest tee of a section to a fix, in metres. */
function nearestTeeM(s: HoleSection, fix: LatLng): number {
  let best = Infinity;
  for (const h of s.holes) {
    const d = metres(h.line[0], fix);
    if (d < best) best = d;
  }
  return best;
}

/** The loop to draw: the player's pick when it exists; else the ONE loop
 *  with a tee within LOOP_AUTOPICK_M of the fix whose nearest rival tee is
 *  LOOP_RIVAL_FACTOR× farther (or past LOOP_RIVAL_MIN_M); else null. */
export function pickLoop(sections: HoleSection[], input: { fix?: LatLng | null; chosen?: string | null }): HoleSection | null {
  if (input.chosen) {
    const s = sections.find(x => x.label === input.chosen);
    if (s) return s;
  }
  if (!input.fix) return null;
  const ranked = sections
    .map(s => ({ s, d: nearestTeeM(s, input.fix!) }))
    .sort((a, b) => a.d - b.d);
  if (!ranked.length || ranked[0].d > LOOP_AUTOPICK_M) return null;
  const rival = ranked[1]?.d ?? Infinity;
  if (rival < LOOP_RIVAL_MIN_M && rival < ranked[0].d * LOOP_RIVAL_FACTOR) return null;
  return ranked[0].s;
}

/** A section as a geometry of its own (its holes and greens). */
export function sectionAsGeometry(s: HoleSection): HoleGeometry {
  return { holes: s.holes, source: 'osm', ...(s.greens ? { greens: s.greens } : {}) };
}

export interface LoopPicks {
  front: string | null;
  back: string | null;
}

/** The geometry the map should draw for THIS round over a sections
 *  geometry: a round whose length one section covers (9 holes on a nine, 18
 *  on an 18-section, a back nine numbered 10–18 on an 18-section) draws the
 *  picked / auto-picked section whole; an 18-hole round on nines draws the
 *  front pick and the back pick composed (the back renumbered 10–18, the
 *  existing two-nine rule). A geometry without sections passes through. */
export function geometryForRound(
  g: HoleGeometry | null | undefined,
  input: { holesPlayed: number; fix?: LatLng | null; picks: LoopPicks }
): HoleGeometry | null {
  if (!g) return null;
  if (!g.sections?.length) return g;
  const whole = g.sections.filter(s => s.holes.length >= input.holesPlayed);
  if (input.holesPlayed <= 9 || whole.some(s => s.holes.length === 18)) {
    const candidates = input.holesPlayed <= 9 ? g.sections : whole;
    const picked = pickLoop(candidates, { fix: input.fix, chosen: input.picks.front });
    return picked ? sectionAsGeometry(picked) : null;
  }
  // 18 holes over nines: both halves must be known; only the front may be
  // auto-picked (the back nine starts far from the player at the first tee).
  const nines = g.sections.filter(s => s.holes.length === 9);
  const front = pickLoop(nines, { fix: input.fix, chosen: input.picks.front });
  const back = input.picks.back ? nines.find(s => s.label === input.picks.back && s !== front) ?? null : null;
  if (!front || !back) return null;
  return composeHoleGeometry(sectionAsGeometry(front), sectionAsGeometry(back));
}

/** What the picker offers: one row for a round one section covers, two
 *  (front / back) for 18 holes over nines. */
export function pickerRows(g: HoleGeometry | null | undefined, holesPlayed: number): Array<{ key: 'front' | 'back'; labels: string[] }> {
  if (!g?.sections?.length) return [];
  if (holesPlayed <= 9) return [{ key: 'front', labels: g.sections.map(s => s.label) }];
  if (g.sections.some(s => s.holes.length === 18)) return [{ key: 'front', labels: g.sections.filter(s => s.holes.length === 18).map(s => s.label) }];
  const nines = g.sections.filter(s => s.holes.length === 9).map(s => s.label);
  return [{ key: 'front', labels: nines }, { key: 'back', labels: nines }];
}

const PICKS_KEY = (groupPostId: string) => `golf:loops:${groupPostId}`;

/** The picks this device made for a round (per round, per device — no DDL). */
export function readLoopPicks(groupPostId: string): LoopPicks {
  try {
    const raw = globalThis.localStorage?.getItem(PICKS_KEY(groupPostId));
    if (!raw) return { front: null, back: null };
    const o = JSON.parse(raw) as { front?: unknown; back?: unknown };
    return { front: typeof o.front === 'string' ? o.front : null, back: typeof o.back === 'string' ? o.back : null };
  } catch {
    return { front: null, back: null };
  }
}

export function writeLoopPicks(groupPostId: string, picks: LoopPicks): void {
  try {
    globalThis.localStorage?.setItem(PICKS_KEY(groupPostId), JSON.stringify(picks));
  } catch {
    // Storage may be unavailable (private mode) — the pick lives in state for this open.
  }
}
