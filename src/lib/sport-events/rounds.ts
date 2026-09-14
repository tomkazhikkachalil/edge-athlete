/**
 * A sport event round's hole data and its mint plan (Events program, phase 1)
 * — pure. `rounds-server.ts` snapshots the catalog at save and mints the
 * round's group_posts row at go-live from `buildMintPlan`.
 *
 * Hole data keeps the STROKE INDEX (`handicap`) — the shared-round writer of
 * old stripped it, which is why the live board could never allocate net
 * strokes per hole. A back nine is encoded by hole numbering (10..18), the
 * src/lib/golf/holes.ts convention every reader already honours.
 */
import type { SportEventFormat, SportEventHoleDatum, SportEventVisibility } from './types';

/** The catalog's shape (golf_courses.hole_data), as course-catalog.ts normalises it. */
export interface CatalogHole {
  number: number;
  par: number;
  yardage?: Record<string, number> | number | null;
  handicap?: number | null;
}

/**
 * The round's own copy of the course: the played holes, numbered from the
 * starting hole, par + the tee's yardage + the stroke index. Null when the
 * course is off-catalog (free text) — the trigger then scores against par 4.
 */
export function buildRoundHoleData(
  course: { hole_data?: CatalogHole[] | null } | null | undefined,
  holes: 9 | 18,
  startingHole: 1 | 10,
  tee: string | null,
): SportEventHoleDatum[] | null {
  const catalog = course?.hole_data;
  if (!Array.isArray(catalog) || catalog.length === 0) return null;
  const byNumber = new Map<number, CatalogHole>();
  for (const h of catalog) if (Number.isInteger(h.number) && h.number >= 1 && h.number <= 18) byNumber.set(h.number, h);
  const first = holes === 9 ? startingHole : 1;
  const out: SportEventHoleDatum[] = [];
  for (let n = first; n < first + holes; n++) {
    const h = byNumber.get(n);
    if (!h || !Number.isInteger(h.par) || h.par < 3 || h.par > 6) return null; // an incomplete catalog is no catalog
    const yardage = typeof h.yardage === 'number' ? h.yardage : teeYardage(h.yardage, tee);
    const handicap = typeof h.handicap === 'number' && h.handicap >= 1 && h.handicap <= 18 ? h.handicap : null;
    out.push({ hole: n, par: h.par, yardage, handicap });
  }
  return out;
}

/** The tee's yardage from the per-tee map (keys are free text; match case-insensitively). */
function teeYardage(map: Record<string, number> | null | undefined, tee: string | null): number | null {
  if (!map || !tee) return null;
  const key = Object.keys(map).find(k => k.toLowerCase() === tee.toLowerCase());
  const v = key ? map[key] : null;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The tee's rating / slope from the catalog's per-tee JSONB (keys are free text; match case-insensitively). */
export function ratingForTee(course: { course_rating?: Record<string, number> | null; slope_rating?: Record<string, number> | null } | null | undefined, tee: string | null): { course_rating: number | null; slope_rating: number | null } {
  const pick = (map: Record<string, number> | null | undefined): number | null => {
    if (!map || !tee) return null;
    const key = Object.keys(map).find(k => k.toLowerCase() === tee.toLowerCase());
    const v = key ? map[key] : null;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const rating = pick(course?.course_rating);
  const slope = pick(course?.slope_rating);
  return { course_rating: rating !== null && rating >= 55 && rating <= 85 ? rating : null, slope_rating: slope !== null && slope >= 55 && slope <= 155 ? slope : null };
}

export interface MintPlayer {
  participantId: string;
  profileId: string;
  role: 'organizer' | 'co_organizer' | 'participant';
  playing: boolean;
}

export interface MintGroup {
  id: string;
  sequence: number;
  members: Array<{ participantId: string; position: number }>;
}

export interface MintPlan {
  groupPost: { type: 'golf_round'; visibility: 'public' | 'participants_only' };
  /** group_post_participants rows in the order the round shows them. */
  participantRows: Array<{ profile_id: string; role: 'creator' | 'organizer' | 'participant'; status: 'confirmed'; position: number }>;
}

/** The shared round's visibility from the event's. */
export function roundVisibility(v: SportEventVisibility): 'public' | 'participants_only' {
  return v === 'public' ? 'public' : 'participants_only';
}

/**
 * The round's participant rows: the host is the round's creator (the
 * shared-round rule — every golf reader keys on creator_id), a co-organizer
 * who does not play is a round `organizer` (004 honours it in RLS), players
 * are ordered by (group sequence, position) then by the roster order. A
 * non-playing participant gets no row; a co-organizer who plays is a
 * player.
 */
export function buildMintPlan(input: { hostProfileId: string; visibility: SportEventVisibility; format: SportEventFormat; players: MintPlayer[]; groups: MintGroup[] }): MintPlan {
  const order = new Map<string, number>();
  const sortedGroups = [...input.groups].sort((a, b) => a.sequence - b.sequence);
  let n = 0;
  for (const g of sortedGroups) for (const m of [...g.members].sort((a, b) => a.position - b.position)) order.set(m.participantId, n++);
  const playing = input.players.filter(p => p.playing);
  playing.sort((a, b) => (order.get(a.participantId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.participantId) ?? Number.MAX_SAFE_INTEGER));

  const rows: MintPlan['participantRows'] = [];
  const seen = new Set<string>();
  rows.push({ profile_id: input.hostProfileId, role: 'creator', status: 'confirmed', position: 1 });
  seen.add(input.hostProfileId);
  let position = 2;
  for (const p of playing) {
    if (seen.has(p.profileId)) continue;
    rows.push({ profile_id: p.profileId, role: 'participant', status: 'confirmed', position: position++ });
    seen.add(p.profileId);
  }
  for (const p of input.players) {
    if (seen.has(p.profileId) || p.playing || p.role !== 'co_organizer') continue;
    rows.push({ profile_id: p.profileId, role: 'organizer', status: 'confirmed', position: position++ });
    seen.add(p.profileId);
  }
  return { groupPost: { type: 'golf_round', visibility: roundVisibility(input.visibility) }, participantRows: rows };
}
