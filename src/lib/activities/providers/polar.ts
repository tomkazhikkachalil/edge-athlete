// ── Polar AccessLink — the pure half (fix round part 3, PR 4) ───────────────
// What Polar sends and how it is checked, with no I/O: the webhook's
// signature, the webhook's payload, and an exercise SUMMARY turned into a
// NormalizedActivity when Polar has no FIT file for it. The network half is
// polar-server.ts. Read from Polar's own pages (AccessLink API v3; the API
// License Agreement of 22 Aug 2025) on Oct 1 2026 — docs/ACTIVITIES.md
// "Polar" carries the record.

import { createHmac, timingSafeEqual } from 'crypto';
import type { ActivityType } from '../catalog';
import type { DeviceTotals, NormalizedActivity } from '../types';

/** Polar's hashed exercise ids ("2AC312F") and numeric user ids, as strings.
 *  An id that is not this shape never reaches a URL we build. */
export const POLAR_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `Polar-Webhook-Signature`: HMAC-SHA256 over the RAW body with the secret
 * Polar returned when the webhook was created, hex-encoded. Compared in
 * constant time; anything malformed is simply false.
 */
export function verifyPolarSignature(rawBody: string, header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!header || !secret) return false;
  const given = header.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  return timingSafeEqual(expected, Buffer.from(given, 'hex'));
}

export type PolarWebhook =
  | { event: 'PING' }
  | { event: 'EXERCISE'; userId: string; exerciseId: string }
  /** An event we did not subscribe to, or one we do not act on. */
  | { event: 'OTHER' };

/** The webhook body. Null = not a Polar webhook at all. The payload's own
 *  `url` is NEVER used: the exercise is fetched from the base we configure. */
export function parsePolarWebhook(body: unknown): PolarWebhook | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.event === 'PING') return { event: 'PING' };
  if (typeof b.event !== 'string') return null;
  if (b.event !== 'EXERCISE') return { event: 'OTHER' };
  const userId = typeof b.user_id === 'number' || typeof b.user_id === 'string' ? String(b.user_id) : '';
  const exerciseId = typeof b.entity_id === 'string' || typeof b.entity_id === 'number' ? String(b.entity_id) : '';
  if (!POLAR_ID_RE.test(userId) || !POLAR_ID_RE.test(exerciseId)) return null;
  return { event: 'EXERCISE', userId, exerciseId };
}

/** Polar's `sport` / `detailed_sport_info` words → our types. An explicit
 *  list; anything else is `other`, which Vitals still counts as a session. */
const SPORT_RULES: readonly [RegExp, ActivityType][] = [
  [/TRAIL_RUNNING/, 'trail_run'],
  [/(^|_)RUNNING|JOGGING|TREADMILL/, 'run'],
  [/MOUNTAIN_BIKING/, 'mountain_bike'],
  [/CYCLING|BIKING|SPINNING/, 'ride'],
  [/HIKING/, 'hike'],
  [/WALKING/, 'walk'],
  [/SWIMMING/, 'swim'],
  [/ROWING/, 'row'],
  [/SKIING|SNOWBOARDING/, 'ski'],
  [/(^|_)CLIMBING/, 'climb'],
];

export function polarSportType(sport: unknown, detailed?: unknown): ActivityType {
  const words = [detailed, sport].filter((w): w is string => typeof w === 'string').map(w => w.toUpperCase().replace(/[\s-]+/g, '_'));
  for (const w of words) for (const [re, type] of SPORT_RULES) if (re.test(w)) return type;
  return 'other';
}

/** "PT2H44M45.5S" → seconds. Null for anything else (never a guess). */
export function parseIsoDuration(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(v.trim());
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export interface PolarExerciseListItem {
  id: string;
  /** epoch ms, when the summary says both the local time and its offset */
  startedAt: number | null;
}

/** Polar's local `start_time` plus `start_time_utc_offset` (minutes) → epoch ms. */
export function polarStart(e: Record<string, unknown>): { t: number; offsetMin: number } | null {
  const offset = typeof e.start_time_utc_offset === 'number' && Number.isFinite(e.start_time_utc_offset) ? e.start_time_utc_offset : null;
  if (typeof e.start_time !== 'string' || offset === null || Math.abs(offset) > 14 * 60) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(e.start_time.trim());
  if (!m) return null;
  const local = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isFinite(local) ? { t: local - offset * 60_000, offsetMin: offset } : null;
}

export function parsePolarExerciseList(body: unknown): PolarExerciseListItem[] {
  if (!Array.isArray(body)) return [];
  const out: PolarExerciseListItem[] = [];
  for (const e of body) {
    if (typeof e !== 'object' || e === null) continue;
    const rec = e as Record<string, unknown>;
    const id = typeof rec.id === 'string' || typeof rec.id === 'number' ? String(rec.id) : '';
    if (!POLAR_ID_RE.test(id)) continue;
    out.push({ id, startedAt: polarStart(rec)?.t ?? null });
  }
  return out;
}

/**
 * An exercise SUMMARY → a bare activity (start and end, the device's
 * totals) — the fallback when Polar has no FIT for it (a gym session with no
 * samples). Null when the summary does not say when it happened.
 */
export function polarSummaryToActivity(e: unknown): NormalizedActivity | null {
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return null;
  const rec = e as Record<string, unknown>;
  const start = polarStart(rec);
  const seconds = parseIsoDuration(rec.duration);
  if (!start || seconds === null || seconds <= 0) return null;
  const device: DeviceTotals = { elapsedS: seconds };
  if (typeof rec.distance === 'number' && rec.distance >= 0) device.distanceM = rec.distance;
  if (typeof rec.calories === 'number' && rec.calories >= 0) device.calories = rec.calories;
  const hr = typeof rec.heart_rate === 'object' && rec.heart_rate !== null ? (rec.heart_rate as Record<string, unknown>).average : undefined;
  const avg = typeof hr === 'number' && hr > 0 ? hr : undefined;
  return {
    format: null,
    type: polarSportType(rec.sport, rec.detailed_sport_info),
    name: null,
    // The average rides on both ends, so the summary's heart rate survives
    // the writer's own maths (it averages the samples it is given).
    points: [avg !== undefined ? { t: start.t, hr: avg } : { t: start.t }, avg !== undefined ? { t: start.t + seconds * 1000, hr: avg } : { t: start.t + seconds * 1000 }],
    device,
    tzOffsetMin: start.offsetMin,
  };
}
