import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { audienceFor, pinFor, projectActivity, projectActivityDetail, projectStream, type ActivityMediaRow, type ActivityRow } from '../visibility';
import { buildStream, routePreview } from '../stream';
import { cleanPoints } from '../normalize';
import { line } from './fixtures';

const stream = buildStream(cleanPoints({ format: 'gpx', type: 'run', name: null, points: line(2000, { stepM: 2, hr: 140 }), device: {}, tzOffsetMin: null }));

const row: ActivityRow = {
  id: '00000000-0000-4000-8000-000000000001',
  profile_id: '00000000-0000-4000-8000-000000000002',
  activity_type: 'run',
  source: 'file',
  source_format: 'gpx',
  name: 'Morning Run',
  started_at: '2026-09-20T12:00:00+00:00',
  timezone: 'America/Toronto',
  occurred_on: '2026-09-20',
  elapsed_s: 1999,
  moving_s: 1999,
  distance_m: '3998.4',
  elev_gain_m: 0,
  elev_loss_m: 0,
  avg_hr: 142,
  max_hr: 144,
  avg_power: null,
  avg_cadence: null,
  calories: null,
  has_route: true,
  route_preview: routePreview(stream),
  stream_path: 'activities/00000000-0000-4000-8000-000000000002/00000000-0000-4000-8000-000000000001.json.gz',
  post_id: null,
  only_me: false,
  segments: [{ id: 'seg-1', kind: 'sprint', from_s: 600, to_s: 660 }],
  steps: null,
  steps_source: null,
  notes: 'Felt good.',
  created_at: '2026-09-20T13:00:00+00:00',
  updated_at: '2026-09-20T13:00:00+00:00',
};

/** A photo at the very start (inside a viewer's trimmed 200 m) and one in the middle. */
const media: ActivityMediaRow[] = [
  { id: 'm-start', activity_id: row.id, media_url: '/api/media/t1', media_type: 'image', thumbnail_url: null, duration_seconds: null, caption: 'Door', at_s: 3, display_order: 1, created_at: '2026-09-20T12:00:03+00:00' },
  { id: 'm-mid', activity_id: row.id, media_url: '/api/media/t2', media_type: 'image', thumbnail_url: null, duration_seconds: null, caption: null, at_s: 1000, display_order: 2, created_at: '2026-09-20T12:16:40+00:00' },
];

describe('audienceFor', () => {
  it('self or guardian → owner; a supervised athlete’s other viewers → no positions', () => {
    expect(audienceFor({ isSelfOrGuardian: true, profileSupervised: true })).toBe('owner');
    expect(audienceFor({ isSelfOrGuardian: false, profileSupervised: false })).toBe('viewer');
    expect(audienceFor({ isSelfOrGuardian: false, profileSupervised: true })).toBe('supervised_viewer');
  });
});

describe('the projections (the access rule)', () => {
  it('never ships the storage path, the source, or the timestamps of the row to anyone', () => {
    for (const a of ['owner', 'viewer', 'supervised_viewer'] as const) {
      const json = JSON.stringify(projectActivityDetail(row, stream, a));
      expect(json).not.toContain('activities/');
      expect(json).not.toContain('stream_path');
    }
  });

  it('owner: the whole route and the controls', () => {
    const v = projectActivityDetail(row, stream, 'owner');
    expect(v.owner).toEqual({ onlyMe: false, updatedAt: row.updated_at });
    expect(v.stream!.lat![0]).not.toBeNull();
    expect(v.distanceM).toBe(3998.4);
  });

  it('viewer: the trimmed route, no controls', () => {
    const v = projectActivityDetail(row, stream, 'viewer');
    expect(v.owner).toBeNull();
    expect(v.hasRoute).toBe(true);
    expect(v.routePreview).toBe(row.route_preview);
    expect(v.stream!.lat![0]).toBeNull();
    expect(v.stream!.lat!.some(x => x !== null)).toBe(true);
  });

  it('supervised_viewer: no position anywhere — no lat/lng keys, no preview — charts stay', () => {
    const v = projectActivityDetail(row, stream, 'supervised_viewer');
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/"lat"|"lng"/);
    expect(v.routePreview).toBeNull();
    expect(v.hasRoute).toBe(false);
    expect(v.stream!.hr).toEqual(stream.hr);
    expect(Object.keys(v.stream!).sort()).toEqual(['d', 'ele', 'hr', 's', 'v']);
    expect(projectActivity(row, 'supervised_viewer').routePreview).toBeNull();
  });

  it('251: segments, steps and notes reach every audience; a photo pin follows the VIEWER\'s stream', () => {
    const owner = projectActivityDetail(row, stream, 'owner', media);
    expect(owner.segments).toEqual([{ id: 'seg-1', kind: 'sprint', from_s: 600, to_s: 660 }]);
    expect(owner.notes).toBe('Felt good.');
    expect(owner.steps).toBeNull();
    expect(owner.media.map(m => m.id)).toEqual(['m-start', 'm-mid']);
    expect(owner.media[0].pin).not.toBeNull(); // the owner sees the door
    expect(owner.media[1].pin).not.toBeNull();
    const viewer = projectActivityDetail(row, stream, 'viewer', media);
    expect(viewer.segments).toEqual(owner.segments); // a time range reveals no place
    expect(viewer.media[0].pin).toBeNull(); // inside the trimmed 200 m
    expect(viewer.media[1].pin).not.toBeNull();
    const supervised = projectActivityDetail(row, stream, 'supervised_viewer', media);
    expect(supervised.media.every(m => m.pin === null)).toBe(true);
    expect(JSON.stringify(supervised)).not.toMatch(/"lat"|"lng"/);
    // The row's garbage never ships: an unreadable segments value is [].
    expect(projectActivity({ ...row, segments: 'nope' }, 'owner').segments).toEqual([]);
    expect(projectActivity({ ...row, steps: 4200, steps_source: 'estimated' }, 'viewer')).toMatchObject({ steps: 4200, stepsSource: 'estimated' });
    expect(pinFor(null, 10)).toBeNull();
    expect(pinFor(stream, null)).toBeNull();
  });

  it('a viewer of a route shorter than the trims gets no route', () => {
    const short = { ...row, route_preview: null };
    expect(projectActivity(short, 'viewer').hasRoute).toBe(false);
    expect(projectActivity(short, 'owner').hasRoute).toBe(true);
  });
});

describe('a live recording\'s raw fixes never leave the server (GPS accuracy round)', () => {
  it('projectStream strips `raw` for the owner, a viewer and a supervised viewer alike', () => {
    const withRaw = { ...stream, raw: { s: [0, 1], lat: [45.4, 45.40001], lng: [-75.7, -75.70001], acc: [8, null] } };
    for (const audience of ['owner', 'viewer', 'supervised_viewer'] as const) {
      const out = projectStream(withRaw, audience)!;
      expect(out, audience).not.toHaveProperty('raw');
      expect(JSON.stringify(out), audience).not.toContain('"acc"');
    }
    // The owner still gets the whole (filtered) route.
    expect(projectStream(withRaw, 'owner')!.lat).toEqual(stream.lat);
  });
});

describe('the FIT SDK boundary (its license keeps it off clients)', () => {
  it('is imported only from -server.ts modules and tests', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== 'node_modules') walk(p);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|mjs)$/.test(name)) continue;
        if (!readFileSync(p, 'utf8').includes('@garmin/fitsdk')) continue;
        const rel = path.relative(process.cwd(), p);
        const ok = /-server\.ts$/.test(name) || /\.test\.ts$/.test(name) || /(^|\/)app\/api\//.test(rel);
        if (!ok) offenders.push(rel);
      }
    };
    walk(path.join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });
});
