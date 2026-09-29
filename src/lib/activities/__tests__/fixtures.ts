// Synthetic but real-shaped activity files for the parser tests.

/** A straight line north from (lat0, lng0): `n` samples, `stepM` metres and
 *  `stepS` seconds apart, climbing `climbPerStep` metres each. */
export function line(n: number, opts: { lat0?: number; lng0?: number; stepM?: number; stepS?: number; t0?: number; ele0?: number; climbPerStep?: number; hr?: number } = {}) {
  const { lat0 = 43.65, lng0 = -79.38, stepM = 3, stepS = 1, t0 = Date.UTC(2026, 8, 20, 12, 0, 0), ele0 = 100, climbPerStep = 0, hr } = opts;
  const dLat = stepM / 111_195; // metres per degree of latitude
  return Array.from({ length: n }, (_, i) => ({
    t: t0 + i * stepS * 1000,
    lat: lat0 + i * dLat,
    lng: lng0,
    ele: ele0 + i * climbPerStep,
    hr: hr === undefined ? undefined : hr + (i % 5),
  }));
}

export function gpxOf(points: ReturnType<typeof line>, opts: { name?: string; type?: string; ns?: boolean } = {}): string {
  const pts = points
    .map(p => {
      const hr = p.hr === undefined
        ? ''
        : opts.ns === false
          ? `<extensions><hr>${p.hr}</hr></extensions>`
          : `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions>`;
      return `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}"><ele>${p.ele.toFixed(1)}</ele><time>${new Date(p.t).toISOString()}</time>${hr}</trkpt>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
<metadata><time>${new Date(points[0].t).toISOString()}</time></metadata>
<trk><name>${opts.name ?? 'Morning Run'}</name><type>${opts.type ?? 'running'}</type><trkseg>
${pts}
</trkseg></trk></gpx>`;
}

export function tcxOf(points: ReturnType<typeof line>, opts: { sport?: string; lapDistance?: number; lapTime?: number; calories?: number } = {}): string {
  let cum = 0;
  const tps = points
    .map((p, i) => {
      if (i > 0) cum += 3;
      return `<Trackpoint><Time>${new Date(p.t).toISOString()}</Time><Position><LatitudeDegrees>${p.lat}</LatitudeDegrees><LongitudeDegrees>${p.lng}</LongitudeDegrees></Position><AltitudeMeters>${p.ele}</AltitudeMeters><DistanceMeters>${cum}</DistanceMeters>${p.hr === undefined ? '' : `<HeartRateBpm><Value>${p.hr}</Value></HeartRateBpm>`}<Extensions><ns3:TPX><ns3:Watts>200</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="${opts.sport ?? 'Biking'}"><Id>${new Date(points[0].t).toISOString()}</Id>
<Lap StartTime="${new Date(points[0].t).toISOString()}"><TotalTimeSeconds>${opts.lapTime ?? 500}</TotalTimeSeconds><DistanceMeters>${opts.lapDistance ?? 1500}</DistanceMeters><Calories>${opts.calories ?? 120}</Calories><Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>
<Track>
${tps}
</Track></Lap><Notes>Lunch &amp; laps</Notes></Activity></Activities></TrainingCenterDatabase>`;
}
