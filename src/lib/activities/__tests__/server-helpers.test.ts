import { describe, expect, it } from 'vitest';
import { mondayOf, weeklyTotals } from '../totals';
import { decodeCursor, encodeCursor } from '../read-server';
import { isActivityPostStats, isActivityShareRequest } from '../post-card';
import { defaultActivityName, localParts } from '../normalize';
import { streamPathFor } from '../write-server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('weekly totals', () => {
  it('finds the Monday of any date', () => {
    expect(mondayOf('2026-09-29')).toBe('2026-09-28'); // a Tuesday
    expect(mondayOf('2026-09-28')).toBe('2026-09-28');
    expect(mondayOf('2026-10-04')).toBe('2026-09-28'); // a Sunday
  });

  it('returns every one of 12 weeks oldest first, folding by local date', () => {
    const rows = [
      { occurred_on: '2026-09-28', distance_m: '5000.4', moving_s: 1500, elapsed_s: 1600, elev_gain_m: 20 },
      { occurred_on: '2026-10-04', distance_m: 10_000, moving_s: null, elapsed_s: 3600, elev_gain_m: null },
      { occurred_on: '2026-09-21', distance_m: null, moving_s: 600, elapsed_s: 600, elev_gain_m: '5.5' },
      { occurred_on: '2025-01-01', distance_m: 99, moving_s: 1, elapsed_s: 1, elev_gain_m: 1 }, // outside the window
    ];
    const w = weeklyTotals(rows, '2026-09-30');
    expect(w).toHaveLength(12);
    expect(w[11]).toEqual({ weekStart: '2026-09-28', count: 2, distanceM: 15_000, seconds: 5100, elevGainM: 20 });
    expect(w[10]).toEqual({ weekStart: '2026-09-21', count: 1, distanceM: 0, seconds: 600, elevGainM: 6 });
    expect(w[0].weekStart).toBe('2026-07-13');
    expect(w.reduce((n, x) => n + x.count, 0)).toBe(3);
  });
});

describe('the list cursor', () => {
  const row = { started_at: '2026-09-20T12:00:00+00:00', id: '00000000-0000-4000-8000-000000000001' };
  it('round-trips', () => {
    expect(decodeCursor(encodeCursor(row))).toEqual({ startedAt: row.started_at, id: row.id });
  });
  it('refuses anything but a strict timestamp and a uuid (it is interpolated into a filter)', () => {
    const b = (s: string) => Buffer.from(s).toString('base64url');
    expect(decodeCursor(b('Sep 20 2026 (x"),id.gt.0)|00000000-0000-4000-8000-000000000001'))).toBeNull();
    expect(decodeCursor(b('2026-09-20T12:00:00+00:00|not-a-uuid'))).toBeNull();
    expect(decodeCursor('%%%')).toBeNull();
    expect(decodeCursor(null)).toBeNull();
  });
});

describe('the feed card payload', () => {
  it('tells a share REQUEST from a stored card', () => {
    expect(isActivityShareRequest({ type: 'activity', activity_id: 'x' })).toBe(true);
    expect(isActivityShareRequest({ type: 'stat_line' })).toBe(false);
    expect(isActivityPostStats({ type: 'activity', activity_id: 'x' })).toBe(false);
    expect(
      isActivityPostStats({ type: 'activity', activity_id: 'x', activity_type: 'run', name: 'Run', occurred_on: '2026-09-20', elapsed_s: 60 })
    ).toBe(true);
  });

  it('is rebuilt by the posts route, never taken from the client', () => {
    const route = readFileSync(path.join(process.cwd(), 'src/app/api/posts/route.ts'), 'utf8');
    expect(route).toContain('buildActivityPostStats(');
    expect(route).toContain('stats_data: statsData');
    expect(route).not.toContain('{ stats_data: incomingStatsData } :');
  });
});

describe('naming and local time', () => {
  it('names by the local hour', () => {
    expect(defaultActivityName('run', 6)).toBe('Morning Run');
    expect(defaultActivityName('ride', 18)).toBe('Evening Ride');
    expect(defaultActivityName('hike', 2)).toBe('Night Hike');
    expect(defaultActivityName('other', 13)).toBe('Afternoon Activity');
  });
  it('reads the hour in the file offset or the zone', () => {
    const t = Date.UTC(2026, 8, 21, 1, 30);
    expect(localParts(t, -240, null)).toEqual({ date: '2026-09-20', hour: 21 });
    expect(localParts(t, null, 'America/Vancouver')).toEqual({ date: '2026-09-20', hour: 18 });
  });
});

describe('the stream path', () => {
  it('matches 245’s CHECK shape', () => {
    const p = streamPathFor('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001');
    expect(p).toMatch(/^activities\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.json\.gz$/);
  });
});

describe('the uploads bucket admits what the writers send (migrations 249 + 250)', () => {
  // 249 pinned the bucket's allowed types to the upload routes' seven media
  // types and forgot the ONE non-media writer — the activity stream
  // (write-server.ts, `application/gzip`). Every import failed until 250
  // appended it. Here: the stream's content type is in the list the chain
  // declares, and the list is exactly the upload routes' types plus it.
  const migrations = path.join(process.cwd(), 'database/migrations');
  const sql249 = readFileSync(path.join(migrations, '249_storage_lockdown_and_cron_hygiene.sql'), 'utf8');
  const sql250 = readFileSync(path.join(migrations, '250_uploads_bucket_gzip.sql'), 'utf8');
  const listed = [...sql249.matchAll(/'((?:image|video)\/[a-z0-9.+-]+)'/g)].map(m => m[1]);

  it('the stream writer sends application/gzip and 250 admits it', () => {
    const writer = readFileSync(path.join(process.cwd(), 'src/lib/activities/write-server.ts'), 'utf8');
    expect(writer).toContain("contentType: 'application/gzip'");
    expect(sql250).toContain("array_append(allowed_mime_types, 'application/gzip')");
  });

  it("249's seven media types are the upload routes' EXT_BY_TYPE keys", async () => {
    const { EXT_BY_TYPE } = await import('@/lib/media/upload-rules');
    expect([...new Set(listed)].sort()).toEqual(Object.keys(EXT_BY_TYPE).sort());
  });
});
