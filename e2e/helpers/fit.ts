import { Encoder, Profile, type Mesg } from '@garmin/fitsdk';
import { line } from '../../src/lib/activities/__tests__/fixtures';

/** A run as a .FIT a watch would write: `n` one-second samples from `t0`,
 *  3 m apart, heart rate 150. */
export function fitRun(t0: number, n = 900): Buffer {
  const encoder = new Encoder();
  const on = (num: number, m: Record<string, unknown>) => encoder.onMesg(num, m as Mesg);
  on(Profile.MesgNum.FILE_ID, { manufacturer: 'development', product: 1, timeCreated: new Date(t0), type: 'activity' });
  const pts = line(n, { t0, stepM: 3, hr: 150 });
  pts.forEach((p, i) =>
    on(Profile.MesgNum.RECORD, {
      timestamp: new Date(p.t),
      positionLat: Math.round(p.lat / (180 / 2 ** 31)),
      positionLong: Math.round(p.lng / (180 / 2 ** 31)),
      altitude: p.ele,
      heartRate: p.hr,
      distance: i * 3,
    })
  );
  on(Profile.MesgNum.SESSION, { timestamp: new Date(pts[pts.length - 1].t), startTime: new Date(t0), sport: 'running', totalElapsedTime: n - 1, totalTimerTime: n - 1, totalDistance: (n - 1) * 3 });
  return Buffer.from(encoder.close());
}
