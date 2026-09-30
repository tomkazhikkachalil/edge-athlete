// ── .GPX → NormalizedActivity — pure (browser + node) ─────────────────────
// GPX 1.1 track points (`<trkpt lat lon>` with `<ele>`, `<time>`) plus the
// Garmin TrackPointExtension fields every watch and app writes (`hr`, `cad`)
// and the common power tags. A GPX carries no device totals: the summary is
// computed from the points (normalize.ts). Route-only files (no `<time>`)
// are refused — an activity is a thing that happened at a time.

import { activityTypeFromWord } from './catalog';
import type { ActivityPoint, NormalizedActivity } from './types';
import { ActivityParseError, attr, eachElement, parseTime, tagNumber, tagText } from './xml-scan';

export function parseGpx(xml: string): NormalizedActivity {
  if (!/<(?:[\w.-]+:)?gpx\b/i.test(xml)) throw new ActivityParseError('This is not a GPX file.');

  const points: ActivityPoint[] = [];
  const tracks: string[] = [];
  eachElement(xml, 'trk', (_a, body) => {
    tracks.push(body);
  });
  eachElement(xml, 'trkpt', (attrs, body) => {
    const t = parseTime(tagText(body, 'time'));
    if (t === undefined) return;
    const lat = Number(attr(attrs, 'lat'));
    const lng = Number(attr(attrs, 'lon'));
    const p: ActivityPoint = { t };
    if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
      p.lat = lat;
      p.lng = lng;
    }
    const ele = tagNumber(body, 'ele');
    if (ele !== undefined) p.ele = ele;
    const hr = tagNumber(body, 'hr');
    if (hr !== undefined) p.hr = hr;
    const cad = tagNumber(body, 'cad');
    if (cad !== undefined) p.cad = cad;
    const pwr = tagNumber(body, 'power') ?? tagNumber(body, 'PowerInWatts');
    if (pwr !== undefined) p.pwr = pwr;
    points.push(p);
  });
  if (points.length === 0) {
    throw new ActivityParseError('This GPX file has no timed track points — it may be a planned route, not a recorded activity.');
  }

  const trk = tracks.length > 0 ? tracks[0] : '';
  const name = tagText(trk, 'name') ?? tagText(xml, 'name');
  return {
    format: 'gpx',
    type: activityTypeFromWord(tagText(trk, 'type')),
    name: name ? name.slice(0, 120) : null,
    points,
    device: {},
    tzOffsetMin: null,
  };
}
