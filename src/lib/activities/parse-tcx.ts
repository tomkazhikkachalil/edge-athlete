// ── .TCX → NormalizedActivity — pure (browser + node) ─────────────────────
// Garmin Training Center XML: `<Activity Sport=…>` → `<Lap>` (the device's
// own totals: TotalTimeSeconds is the TIMER — moving — time, plus
// DistanceMeters and Calories) → `<Trackpoint>` (Time, Position,
// AltitudeMeters, DistanceMeters, HeartRateBpm/Value, Cadence, and the TPX
// extension's Watts / RunCadence). Only the first Activity is read.

import { activityTypeFromWord } from './catalog';
import type { ActivityPoint, DeviceTotals, NormalizedActivity } from './types';
import { ActivityParseError, attr, eachElement, parseTime, tagNumber, tagText } from './xml-scan';

export function parseTcx(xml: string): NormalizedActivity {
  if (!/<(?:[\w.-]+:)?TrainingCenterDatabase\b/i.test(xml)) throw new ActivityParseError('This is not a TCX file.');

  const activities: { attrs: string; body: string }[] = [];
  eachElement(xml, 'Activity', (attrs, body) => {
    activities.push({ attrs, body });
  });
  if (activities.length === 0) throw new ActivityParseError('This TCX file has no activity in it.');
  const { attrs: activityAttrs, body: activityBody } = activities[0];

  const device: DeviceTotals = {};
  let lapTime = 0;
  let lapDist = 0;
  let lapCal = 0;
  let laps = 0;
  eachElement(activityBody, 'Lap', (_attrs, body) => {
    // A lap's own totals sit beside its Track; the trackpoints repeat
    // DistanceMeters, so read the lap with the Track cut out.
    const own = body.replace(/<(?:[\w.-]+:)?Track\b[\s\S]*?<\/(?:[\w.-]+:)?Track\s*>/gi, '');
    lapTime += tagNumber(own, 'TotalTimeSeconds') ?? 0;
    lapDist += tagNumber(own, 'DistanceMeters') ?? 0;
    lapCal += tagNumber(own, 'Calories') ?? 0;
    laps += 1;
  });
  if (laps > 0) {
    if (lapTime > 0) device.movingS = lapTime;
    if (lapDist > 0) device.distanceM = lapDist;
    if (lapCal > 0) device.calories = lapCal;
  }

  const points: ActivityPoint[] = [];
  eachElement(activityBody, 'Trackpoint', (_attrs, body) => {
    const t = parseTime(tagText(body, 'Time'));
    if (t === undefined) return;
    const p: ActivityPoint = { t };
    const lat = tagNumber(body, 'LatitudeDegrees');
    const lng = tagNumber(body, 'LongitudeDegrees');
    if (lat !== undefined && lng !== undefined && !(lat === 0 && lng === 0)) {
      p.lat = lat;
      p.lng = lng;
    }
    const ele = tagNumber(body, 'AltitudeMeters');
    if (ele !== undefined) p.ele = ele;
    const dist = tagNumber(body, 'DistanceMeters');
    if (dist !== undefined) p.dist = dist;
    const hrBlock = tagText(body, 'HeartRateBpm');
    const hr = hrBlock !== null ? tagNumber(hrBlock, 'Value') : undefined;
    if (hr !== undefined) p.hr = hr;
    const cad = tagNumber(body, 'Cadence') ?? tagNumber(body, 'RunCadence');
    if (cad !== undefined) p.cad = cad;
    const pwr = tagNumber(body, 'Watts');
    if (pwr !== undefined) p.pwr = pwr;
    points.push(p);
  });
  if (points.length === 0) throw new ActivityParseError('This TCX file has no timed track points.');

  const notes = tagText(activityBody, 'Notes');
  return {
    format: 'tcx',
    type: activityTypeFromWord(attr(activityAttrs, 'Sport')),
    name: notes ? notes.slice(0, 120) : null,
    points,
    device,
    tzOffsetMin: null,
  };
}
