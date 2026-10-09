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

import { sourceCredit } from './connections';
import { isActivityType, type ActivityType } from './catalog';
import { segmentsFromRow, type ActivitySegment } from './segments';
import { trimStream } from './stream';
import type { ActivityStream } from './types';

export type ActivityAudience = 'owner' | 'viewer' | 'supervised_viewer';

/** The columns the readers select (245; 251 added segments, steps, steps_source, notes —
 *  a select naming a column the database lacks 404s the whole API, so this
 *  list grows only after the migration ran on BOTH environments). */
export const ACTIVITY_COLUMNS =
  'id, profile_id, activity_type, source, source_format, name, started_at, timezone, occurred_on, elapsed_s, moving_s, distance_m, elev_gain_m, elev_loss_m, avg_hr, max_hr, avg_power, avg_cadence, calories, has_route, route_preview, stream_path, post_id, only_me, segments, steps, steps_source, notes, created_at, updated_at';

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
  /** 251: boundaries only (segments.ts); the shape is re-checked on read. */
  segments: unknown;
  steps: number | null;
  steps_source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A photo or clip on an activity (251), as the row is stored. The URLs the
 *  server hands a projection are already proxied (media-server.ts). */
export interface ActivityMediaRow {
  id: string;
  activity_id: string;
  media_url: string;
  media_type: 'image' | 'video';
  thumbnail_url: string | null;
  duration_seconds: number | string | null;
  caption: string | null;
  at_s: number | null;
  display_order: number;
  created_at: string;
}

export interface ActivityMediaView {
  id: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  caption: string | null;
  /** Seconds into the recording the photo was taken; null when added after. */
  atS: number | null;
  /** Where on the route it was taken — resolved from the VIEWER's stream, so
   *  a photo inside a viewer's trimmed 200 m has none and a supervised
   *  athlete's viewers get none; null when the activity has no positions. */
  pin: [number, number] | null;
  displayOrder: number;
  createdAt: string;
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
  /** The credit a provider's terms require where its data is shown
   *  ("Recorded with Polar"); null for a file or the upload link. */
  credit: string | null;
  /** True only when THIS viewer may see a route. */
  hasRoute: boolean;
  /** The encoded, already-trimmed preview — null for a supervised athlete's viewer. */
  routePreview: string | null;
  postId: string | null;
  /** 251: the segments marked during or after — time ranges; what they
   *  measure is computed from the stream (stream.ts segmentStats). */
  segments: ActivitySegment[];
  /** 251: an estimate ("est.") on the web; a device count with the native apps. */
  steps: number | null;
  stepsSource: 'estimated' | 'device' | null;
  notes: string | null;
  /** The athlete's own controls, present for the owner audience only. */
  owner: { onlyMe: boolean; updatedAt: string } | null;
}

export interface ActivityDetailView extends ActivityView {
  stream: ActivityStream | null;
  /** 251: the photos, pins resolved from THIS viewer's stream. */
  media: ActivityMediaView[];
}

/** The sample nearest `atS` on a stream that still has positions, else null. */
export function pinFor(stream: ActivityStream | null, atS: number | null): [number, number] | null {
  if (!stream || atS === null || !stream.lat || !stream.lng || stream.s.length === 0) return null;
  let best = 0;
  let bestGap = Infinity;
  for (let i = 0; i < stream.s.length; i++) {
    const gap = Math.abs(stream.s[i] - atS);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  const lat = stream.lat[best];
  const lng = stream.lng[best];
  return typeof lat === 'number' && typeof lng === 'number' ? [lat, lng] : null;
}

export function projectActivityMedia(rows: readonly ActivityMediaRow[], viewerStream: ActivityStream | null): ActivityMediaView[] {
  return rows
    .slice()
    .sort((a, b) => a.display_order - b.display_order || (a.at_s ?? Infinity) - (b.at_s ?? Infinity) || a.created_at.localeCompare(b.created_at))
    .map(r => ({
      id: r.id,
      mediaUrl: r.media_url,
      mediaType: r.media_type,
      thumbnailUrl: r.thumbnail_url,
      durationSeconds: n(r.duration_seconds),
      caption: r.caption,
      atS: r.at_s,
      pin: pinFor(viewerStream, r.at_s),
      displayOrder: r.display_order,
      createdAt: r.created_at,
    }));
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
    credit: sourceCredit(row.source),
    hasRoute: routeVisible && (audience === 'owner' || row.route_preview !== null),
    routePreview: routeVisible ? row.route_preview : null,
    postId: row.post_id,
    segments: segmentsFromRow(row.segments),
    steps: row.steps,
    stepsSource: row.steps_source === 'estimated' || row.steps_source === 'device' ? row.steps_source : null,
    notes: row.notes,
    owner: audience === 'owner' ? { onlyMe: row.only_me, updatedAt: row.updated_at } : null,
  };
}

/** The stream each audience receives. */
export function projectStream(stream: ActivityStream | null, audience: ActivityAudience): ActivityStream | null {
  if (!stream) return null;
  // A live recording's raw fixes (GPS accuracy round) are SERVER-ONLY, for
  // every audience: they would undo the 200 m trim, and nobody draws them.
  if (stream.raw) {
    const { raw: _raw, ...withoutRaw } = stream;
    void _raw;
    stream = withoutRaw;
  }
  if (audience === 'owner') return stream;
  if (audience === 'viewer') return trimStream(stream);
  const rest: ActivityStream = { ...stream };
  delete rest.lat;
  delete rest.lng;
  return rest;
}

export function projectActivityDetail(
  row: ActivityRow,
  stream: ActivityStream | null,
  audience: ActivityAudience,
  media: readonly ActivityMediaRow[] = []
): ActivityDetailView {
  const projected = projectStream(stream, audience);
  return { ...projectActivity(row, audience), stream: projected, media: projectActivityMedia(media, projected) };
}
