// ── The feed card's payload: posts.stats_data for a shared activity — pure ─
// Written ONLY by the server (share-server.ts rebuilds it from the row; a
// client's stats_data of type 'activity' is a REQUEST, never the payload).
// The route preview is the stored, already-trimmed one — and absent for a
// supervised athlete (Tom's rule: their route is the athlete's and the
// guardians' only). Denormalized like a workout card, so the feed renders
// without a second read.

import { isActivityType, type ActivityType } from './catalog';
import type { Derived } from './derived';
import type { TileSource } from './tiles';
import type { Details } from './details';

export interface ActivityPostStats {
  type: 'activity';
  activity_id: string;
  activity_type: ActivityType;
  name: string;
  occurred_on: string;
  distance_m: number | null;
  moving_s: number | null;
  elapsed_s: number;
  elev_gain_m: number | null;
  /** Oct 16 2026: the descent (ski, MTB, hikes) — absent on older cards. */
  elev_loss_m?: number | null;
  /** Oct 16 2026: the stream's max speed (m/s) and downhill runs, for the
   *  types that show them — absent otherwise and on older cards. */
  max_speed_mps?: number | null;
  runs?: number;
  avg_hr: number | null;
  route_preview: string | null;
  /** The provider credit its terms require ("Recorded with Polar"); absent
   *  on cards written before PR 4 and for files / the upload link. */
  credit?: string | null;
  /** Live Activities (251): the segments as the card shows them — absent on
   *  cards written before, and when the activity has none. */
  segments?: Array<{ kind: string; label: string | null; distance_m: number; seconds: number }>;
  /** 251: the step estimate ("est.") — absent when none. */
  steps?: number | null;
  /** 251: how many photos rode along (the post's own media carry them). */
  photo_count?: number;
  /** 265: how hard it felt and the type's answers — absent on older cards. */
  effort?: number | null;
  details?: Details;
}

/** A composer's request to share an activity: `{ type: 'activity', activity_id }`. */
export function isActivityShareRequest(v: unknown): v is { type: 'activity'; activity_id: string } {
  return !!v && typeof v === 'object' && (v as { type?: unknown }).type === 'activity';
}

export function isActivityPostStats(v: unknown): v is ActivityPostStats {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    o.type === 'activity' &&
    typeof o.activity_id === 'string' &&
    isActivityType(o.activity_type) &&
    typeof o.name === 'string' &&
    typeof o.occurred_on === 'string' &&
    typeof o.elapsed_s === 'number'
  );
}

/** A card's snapshot as tile input (tiles.ts) — what it does not hold is null. */
export function cardTileSource(s: ActivityPostStats): { src: TileSource; derived: Derived } {
  return {
    src: {
      type: s.activity_type,
      distanceM: s.distance_m,
      movingS: s.moving_s,
      elapsedS: s.elapsed_s,
      elevGainM: s.elev_gain_m,
      elevLossM: s.elev_loss_m ?? null,
      avgHr: s.avg_hr,
      maxHr: null,
      avgPower: null,
      avgCadence: null,
      calories: null,
      steps: null,
      stepsSource: null,
      effort: s.effort ?? null,
      details: s.details ?? {},
      // The card's segments carry no positions: enough to count rounds, never a work / rest.
      segments: (s.segments ?? []).map(x => ({ kind: x.kind, from_s: 0, to_s: x.seconds })),
    },
    derived: {
      bestEfforts: [],
      maxSpeedMps: s.max_speed_mps ?? null,
      maxElevationM: null,
      climbRateMph: null,
      runs: s.runs ?? 0,
      gradeAdjustedM: null,
    },
  };
}
