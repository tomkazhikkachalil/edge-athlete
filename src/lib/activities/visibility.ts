// ── What each viewer of an activity receives — pure ────────────────────────
// The projection IS the access rule (the tickets pattern): a route handler
// decides WHETHER the viewer may see the activity at all (the profile gate,
// blocks, "Only me"), then hands the row and the stream to project*() with
// the audience, and returns only what comes out. Tom's rules (Sep 29 2026):
//   owner              the athlete, or a guardian acting for them: all of it.
//   viewer             anyone else: the route with its first and last ~200 m
//                      cut (trimStream; route_preview is stored trimmed).
//   supervised_viewer  anyone else looking at a SUPERVISED athlete: no
//                      position anywhere — no map, no preview; the numbers,
//                      the elevation and HR charts and the splits stay.
// visibility.test.ts serialises each projection and pins its keys.

import { isActivityType, type ActivityType } from './catalog';
import { trimStream } from './stream';
import type { ActivityStream } from './types';

export type ActivityAudience = 'owner' | 'viewer' | 'supervised_viewer';

/** The columns the readers select (245). */
export const ACTIVITY_COLUMNS =
  'id, profile_id, activity_type, source, source_format, name, started_at, timezone, occurred_on, elapsed_s, moving_s, distance_m, elev_gain_m, elev_loss_m, avg_hr, max_hr, avg_power, avg_cadence, calories, has_route, route_preview, stream_path, post_id, only_me, created_at, updated_at';

export interface ActivityRow {
  id: string;
  profile_id: string;
  activity_type: string;
  source: string;
  source_format: string | null;
  name: string;
  started_at: string;
  timezone: string | null;
  occurred_on: string;
  elapsed_s: number;
  moving_s: number | null;
  distance_m: number | string | null;
  elev_gain_m: number | string | null;
  elev_loss_m: number | string | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_power: number | null;
  avg_cadence: number | null;
  calories: number | null;
  has_route: boolean;
  route_preview: string | null;
  stream_path: string | null;
  post_id: string | null;
  only_me: boolean;
  created_at: string;
  updated_at: string;
}

export interface ActivityView {
  id: string;
  profileId: string;
  type: ActivityType;
  name: string;
  startedAt: string;
  timezone: string | null;
  occurredOn: string;
  elapsedS: number;
  movingS: number | null;
  distanceM: number | null;
  elevGainM: number | null;
  elevLossM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgPower: number | null;
  avgCadence: number | null;
  calories: number | null;
  sourceFormat: string | null;
  /** True only when THIS viewer may see a route. */
  hasRoute: boolean;
  /** The encoded, already-trimmed preview — null for a supervised athlete's viewer. */
  routePreview: string | null;
  postId: string | null;
  /** The athlete's own controls, present for the owner audience only. */
  owner: { onlyMe: boolean; updatedAt: string } | null;
}

export interface ActivityDetailView extends ActivityView {
  stream: ActivityStream | null;
}

const n = (v: number | string | null): number | null => {
  if (v === null || v === undefined) return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Who is looking: self or a guardian → owner; else the athlete's supervision decides. */
export function audienceFor(opts: { isSelfOrGuardian: boolean; profileSupervised: boolean }): ActivityAudience {
  if (opts.isSelfOrGuardian) return 'owner';
  return opts.profileSupervised ? 'supervised_viewer' : 'viewer';
}

export function projectActivity(row: ActivityRow, audience: ActivityAudience): ActivityView {
  const routeVisible = audience !== 'supervised_viewer' && row.has_route;
  return {
    id: row.id,
    profileId: row.profile_id,
    type: isActivityType(row.activity_type) ? row.activity_type : 'other',
    name: row.name,
    startedAt: row.started_at,
    timezone: row.timezone,
    occurredOn: row.occurred_on,
    elapsedS: row.elapsed_s,
    movingS: row.moving_s,
    distanceM: n(row.distance_m),
    elevGainM: n(row.elev_gain_m),
    elevLossM: n(row.elev_loss_m),
    avgHr: row.avg_hr,
    maxHr: row.max_hr,
    avgPower: row.avg_power,
    avgCadence: row.avg_cadence,
    calories: row.calories,
    sourceFormat: row.source_format,
    hasRoute: routeVisible && (audience === 'owner' || row.route_preview !== null),
    routePreview: routeVisible ? row.route_preview : null,
    postId: row.post_id,
    owner: audience === 'owner' ? { onlyMe: row.only_me, updatedAt: row.updated_at } : null,
  };
}

/** The stream each audience receives. */
export function projectStream(stream: ActivityStream | null, audience: ActivityAudience): ActivityStream | null {
  if (!stream) return null;
  if (audience === 'owner') return stream;
  if (audience === 'viewer') return trimStream(stream);
  const rest: ActivityStream = { ...stream };
  delete rest.lat;
  delete rest.lng;
  return rest;
}

export function projectActivityDetail(row: ActivityRow, stream: ActivityStream | null, audience: ActivityAudience): ActivityDetailView {
  return { ...projectActivity(row, audience), stream: projectStream(stream, audience) };
}
