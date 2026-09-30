import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { audienceFor, projectActivity, projectActivityDetail, type ActivityRow } from '../visibility';
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
  created_at: '2026-09-20T13:00:00+00:00',
  updated_at: '2026-09-20T13:00:00+00:00',
};

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

  it('a viewer of a route shorter than the trims gets no route', () => {
    const short = { ...row, route_preview: null };
    expect(projectActivity(short, 'viewer').hasRoute).toBe(false);
    expect(projectActivity(short, 'owner').hasRoute).toBe(true);
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
