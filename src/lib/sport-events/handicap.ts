/**
 * Handicaps for a sport event (Events program, phase 1) — pure.
 *
 * Tom's decision: net scoring uses the player's COMPUTED WHS index by
 * default, frozen on the participant row at accept; the organizer may
 * override per event. The COURSE handicap is a pure function of that index
 * and the round's rating / slope / par / holes (Rule 6.1a,
 * src/lib/golf/adjusted-gross.ts courseHandicap) and is computed at read —
 * a stored copy would drift when the organizer changes the tee before
 * go-live. The server half (`handicap-server.ts`) reads the index with
 * fetchHandicapComputation and writes the snapshot through `snapshotIndex`.
 */
import { courseHandicap } from '@/lib/golf/adjusted-gross';
import type { HandicapSeriesResult } from '@/lib/golf/handicap';
import type { HandicapSource, SportEventHoleDatum } from './types';

export interface IndexSnapshot {
  handicap_index: number | null;
  handicap_source: HandicapSource;
}

/** The computed index for the participant row — or none, honestly. */
export function snapshotIndex(result: HandicapSeriesResult | null | undefined): IndexSnapshot {
  const idx = result?.current?.index;
  if (typeof idx !== 'number' || !Number.isFinite(idx)) return { handicap_index: null, handicap_source: 'none' };
  return { handicap_index: Math.round(idx * 10) / 10, handicap_source: 'computed' };
}

/** The organizer's override; null clears it (a later re-accept may recompute). */
export function applyOverride(index: number | null): IndexSnapshot {
  if (index === null || !Number.isFinite(index)) return { handicap_index: null, handicap_source: 'none' };
  return { handicap_index: Math.round(index * 10) / 10, handicap_source: 'organizer' };
}

/** A fresh computed snapshot never replaces an organizer's override. */
export function mergeSnapshot(existing: IndexSnapshot, fresh: IndexSnapshot): IndexSnapshot {
  return existing.handicap_source === 'organizer' ? existing : fresh;
}

export interface RoundHandicapInputs {
  holes: 9 | 18;
  course_rating: number | null;
  slope_rating: number | null;
  /** The par of the holes PLAYED (the round's hole_data), not the course's 18-hole par. */
  par: number | null;
}

/** The par of a round's played holes from its hole_data — null when unknown. */
export function playedPar(holeData: SportEventHoleDatum[] | null | undefined): number | null {
  if (!holeData || holeData.length === 0) return null;
  let sum = 0;
  for (const h of holeData) {
    if (typeof h.par !== 'number' || !Number.isFinite(h.par) || h.par < 3 || h.par > 6) return null;
    sum += h.par;
  }
  return sum;
}

/**
 * The course handicap a participant plays off on a round — the golf-league
 * convention (src/lib/competitions/golf-league.ts netScore): a nine halves
 * the index; any missing input answers null (gross with a reason, never a
 * guess).
 */
export function courseHandicapFor(participant: { handicap_index: number | null }, round: RoundHandicapInputs): number | null {
  const idx = participant.handicap_index;
  if (idx === null || round.course_rating === null || round.slope_rating === null || round.par === null) return null;
  const effective = round.holes === 9 ? idx / 2 : idx;
  return courseHandicap(effective, round.slope_rating, round.course_rating, round.par);
}
