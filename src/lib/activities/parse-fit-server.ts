// ── .FIT → NormalizedActivity — SERVER ONLY ───────────────────────────────
// Garmin's official SDK (@garmin/fitsdk). Its license makes the SDK Garmin's
// confidential information and forbids making it available to third
// parties, so it NEVER reaches a client bundle: the raw file is uploaded to
// POST /api/activities/fit and decoded here (a FIT is compact binary, far
// under the 4.5 MB request cap). activities-fit-boundary.test.ts holds every
// import of the SDK to a `-server.ts` module. The same decoder serves the
// Garmin webhook later.
//
// Read: record messages (the samples — positions in semicircles, the
// enhanced altitude when present, HR, cadence, power, the device distance),
// the first session (the device's totals and its sport), and the activity
// message's local_timestamp (the device's UTC offset → the local date).

import { Decoder, Stream } from '@garmin/fitsdk';
import { activityTypeFromWord } from './catalog';
import type { ActivityPoint, DeviceTotals, NormalizedActivity } from './types';
import { ActivityParseError } from './xml-scan';

/** FIT's own epoch (1989-12-31T00:00:00Z) in Unix seconds. */
const FIT_EPOCH_S = 631_065_600;
const SEMICIRCLE = 180 / 2 ** 31;

function toMs(v: unknown): number | undefined {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return (v + FIT_EPOCH_S) * 1000;
  return undefined;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function parseFit(bytes: Uint8Array): NormalizedActivity {
  // A copy into a plain ArrayBuffer (the upload may be a view of a larger one).
  const stream = Stream.fromArrayBuffer(new Uint8Array(bytes).buffer);
  if (!Decoder.isFIT(stream)) throw new ActivityParseError('This is not a FIT file.');
  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    includeUnknownData: false,
    mergeHeartRates: true,
  });
  const records = messages.recordMesgs ?? [];
  if (records.length === 0) {
    // A truncated file decodes its first part and reports an error; only
    // refuse when nothing usable came out.
    throw new ActivityParseError(
      errors.length > 0 ? 'This FIT file is damaged and could not be read.' : 'This FIT file has no recorded samples — it may be a workout plan or a course, not an activity.'
    );
  }

  const points: ActivityPoint[] = [];
  for (const r of records) {
    const t = toMs(r.timestamp);
    if (t === undefined) continue;
    const p: ActivityPoint = { t };
    const lat = num(r.positionLat);
    const lng = num(r.positionLong);
    if (lat !== undefined && lng !== undefined) {
      p.lat = lat * SEMICIRCLE;
      p.lng = lng * SEMICIRCLE;
    }
    const ele = num(r.enhancedAltitude) ?? num(r.altitude);
    if (ele !== undefined) p.ele = ele;
    const hr = num(r.heartRate);
    if (hr !== undefined) p.hr = hr;
    const cad = num(r.cadence);
    if (cad !== undefined) p.cad = cad;
    const pwr = num(r.power);
    if (pwr !== undefined) p.pwr = pwr;
    const dist = num(r.distance);
    if (dist !== undefined) p.dist = dist;
    points.push(p);
  }
  if (points.length === 0) throw new ActivityParseError('This FIT file has no timed samples.');

  const session = (messages.sessionMesgs ?? [])[0];
  const device: DeviceTotals = {};
  if (session) {
    const set = (k: keyof DeviceTotals, v: unknown) => {
      const n = num(v);
      if (n !== undefined && n >= 0) device[k] = n;
    };
    set('distanceM', session.totalDistance);
    set('elapsedS', session.totalElapsedTime);
    set('movingS', session.totalTimerTime);
    set('elevGainM', session.totalAscent);
    set('elevLossM', session.totalDescent);
    set('calories', session.totalCalories);
  }

  let tzOffsetMin: number | null = null;
  const activity = (messages.activityMesgs ?? [])[0];
  if (activity) {
    const utc = toMs(activity.timestamp);
    const local = toMs(activity.localTimestamp);
    if (utc !== undefined && local !== undefined) {
      // Offsets are whole quarter hours; anything else is a clock glitch.
      const off = Math.round((local - utc) / 60_000 / 15) * 15;
      if (Math.abs(off) <= 14 * 60) tzOffsetMin = off;
    }
  }

  const sport = session ? String(session.sport ?? '') : '';
  const subSport = session ? String(session.subSport ?? '') : '';
  return {
    format: 'fit',
    type: activityTypeFromWord(sport, subSport),
    name: null,
    points,
    device,
    tzOffsetMin,
  };
}
