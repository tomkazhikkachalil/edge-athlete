// ── The feed card's payload: posts.stats_data for a shared activity — pure ─
// Written ONLY by the server (share-server.ts rebuilds it from the row; a
// client's stats_data of type 'activity' is a REQUEST, never the payload).
// The route preview is the stored, already-trimmed one — and absent for a
// supervised athlete (Tom's rule: their route is the athlete's and the
// guardians' only). Denormalized like a workout card, so the feed renders
// without a second read.

import { isActivityType, type ActivityType } from './catalog';

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
  avg_hr: number | null;
  route_preview: string | null;
  /** The provider credit its terms require ("Recorded with Polar"); absent
   *  on cards written before PR 4 and for files / the upload link. */
  credit?: string | null;
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
