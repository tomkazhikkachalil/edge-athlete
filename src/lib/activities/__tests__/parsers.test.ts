import { describe, expect, it } from 'vitest';
import { Encoder, Profile, type Mesg } from '@garmin/fitsdk';
import { activityTypeFromWord, ACTIVITY_TYPES } from '../catalog';
import { parseGpx } from '../parse-gpx';
import { parseTcx } from '../parse-tcx';
import { parseFit } from '../parse-fit-server';
import { ActivityParseError, decodeXmlText } from '../xml-scan';
import { gpxOf, line, tcxOf } from './fixtures';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('the catalog', () => {
  it('matches migration 245 activities_activity_type_check exactly', () => {
    const sql = readFileSync(path.join(process.cwd(), 'database/migrations/245_activities.sql'), 'utf8');
    const m = /activities_activity_type_check[\s\S]*?CHECK \(activity_type IN \(([^)]*)\)\)/.exec(sql);
    expect(m).not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
    expect(inSql).toEqual([...ACTIVITY_TYPES]);
  });

  it('maps file sport words, never guessing an unknown one', () => {
    expect(activityTypeFromWord('running')).toBe('run');
    expect(activityTypeFromWord('running', 'trail')).toBe('trail_run');
    expect(activityTypeFromWord('Biking')).toBe('ride');
    expect(activityTypeFromWord('cycling', 'mountain')).toBe('mountain_bike');
    expect(activityTypeFromWord('alpineSkiing')).toBe('ski');
    expect(activityTypeFromWord('rockClimbing')).toBe('climb');
    expect(activityTypeFromWord('hiking')).toBe('hike');
    expect(activityTypeFromWord('rowing')).toBe('row');
    expect(activityTypeFromWord('Other')).toBe('other');
    expect(activityTypeFromWord(null)).toBe('other');
  });
});

describe('decodeXmlText', () => {
  it('decodes entities and CDATA, and drops invalid code points', () => {
    expect(decodeXmlText('Lunch &amp; laps &#x1F3C3;')).toBe('Lunch & laps 🏃');
    expect(decodeXmlText('<![CDATA[Run <3]]>')).toBe('Run <3');
    expect(decodeXmlText('bad &#99999999; ok')).toBe('bad  ok');
  });
});

describe('parseGpx', () => {
  it('reads points, HR and cadence from the Garmin extension, the name and the type', () => {
    const a = parseGpx(gpxOf(line(10, { hr: 140 })));
    expect(a.format).toBe('gpx');
    expect(a.type).toBe('run');
    expect(a.name).toBe('Morning Run');
    expect(a.points).toHaveLength(10);
    expect(a.points[0].hr).toBe(140);
    expect(a.points[0].cad).toBe(85);
    expect(a.points[3].lat).toBeCloseTo(43.65 + 9 / 111_195, 6);
    expect(a.tzOffsetMin).toBeNull();
  });

  it('reads an un-namespaced hr and a file without HR', () => {
    expect(parseGpx(gpxOf(line(3, { hr: 150 }), { ns: false })).points[1].hr).toBe(151);
    expect(parseGpx(gpxOf(line(3))).points[0].hr).toBeUndefined();
  });

  it('refuses a planned route (no times) and a non-GPX file', () => {
    const route = '<gpx><trk><trkseg><trkpt lat="1" lon="2"><ele>3</ele></trkpt></trkseg></trk></gpx>';
    expect(() => parseGpx(route)).toThrow(ActivityParseError);
    expect(() => parseGpx('<kml></kml>')).toThrow(/not a GPX/);
  });
});

describe('parseTcx', () => {
  it('reads trackpoints, the lap totals without double-counting trackpoint distances, notes', () => {
    const a = parseTcx(tcxOf(line(20, { hr: 120 }), { lapDistance: 57, lapTime: 19, calories: 12 }));
    expect(a.format).toBe('tcx');
    expect(a.type).toBe('ride');
    expect(a.points).toHaveLength(20);
    expect(a.points[5].hr).toBe(120);
    expect(a.points[5].pwr).toBe(200);
    expect(a.points[5].dist).toBe(15);
    expect(a.device).toEqual({ movingS: 19, distanceM: 57, calories: 12 });
    expect(a.name).toBe('Lunch & laps');
  });

  it('refuses a file that is not TCX', () => {
    expect(() => parseTcx('<gpx/>')).toThrow(/not a TCX/);
  });
});

function fitFile(opts: { withSession: boolean; withGps: boolean }): Uint8Array {
  const encoder = new Encoder();
  // The SDK types a message as its base Mesg; the fields are the Profile's.
  const on = (num: number, m: Record<string, unknown>) => encoder.onMesg(num, m as Mesg);
  const start = new Date(Date.UTC(2026, 8, 20, 12, 0, 0));
  on(Profile.MesgNum.FILE_ID, { manufacturer: 'development', product: 1, timeCreated: start, type: 'activity' });
  const pts = line(30, { hr: 130 });
  for (const p of pts) {
    on(Profile.MesgNum.RECORD, {
      timestamp: new Date(p.t),
      ...(opts.withGps ? { positionLat: Math.round(p.lat / (180 / 2 ** 31)), positionLong: Math.round(p.lng / (180 / 2 ** 31)) } : {}),
      altitude: p.ele,
      heartRate: p.hr,
      distance: pts.indexOf(p) * 3,
    });
  }
  if (opts.withSession) {
    on(Profile.MesgNum.SESSION, {
      timestamp: new Date(pts[pts.length - 1].t),
      startTime: start,
      sport: 'running',
      subSport: 'trail',
      totalElapsedTime: 29,
      totalTimerTime: 29,
      totalDistance: 87,
      totalAscent: 0,
      totalCalories: 9,
    });
  }
  on(Profile.MesgNum.ACTIVITY, {
    timestamp: new Date(pts[pts.length - 1].t),
    // The device clock was UTC−4 (EDT).
    localTimestamp: Math.round((pts[pts.length - 1].t - 4 * 3_600_000) / 1000) - 631_065_600,
    numSessions: 1,
    type: 'manual',
  });
  return encoder.close();
}

describe('parseFit (server)', () => {
  it('decodes records, the session totals, the sport and the UTC offset', () => {
    const a = parseFit(fitFile({ withSession: true, withGps: true }));
    expect(a.format).toBe('fit');
    expect(a.type).toBe('trail_run');
    expect(a.points).toHaveLength(30);
    expect(a.points[0].lat).toBeCloseTo(43.65, 5);
    expect(a.points[0].hr).toBe(130);
    expect(a.points[10].dist).toBe(30);
    expect(a.device.distanceM).toBe(87);
    expect(a.device.calories).toBe(9);
    expect(a.tzOffsetMin).toBe(-240);
  });

  it('reads an indoor file (no GPS, no session) as type other with device distances', () => {
    const a = parseFit(fitFile({ withSession: false, withGps: false }));
    expect(a.type).toBe('other');
    expect(a.points[0].lat).toBeUndefined();
    expect(a.points[29].dist).toBe(87);
    expect(a.device).toEqual({});
  });

  it('refuses bytes that are not FIT', () => {
    expect(() => parseFit(new TextEncoder().encode('<gpx></gpx>'))).toThrow(/not a FIT/);
  });
});
