import { describe, expect, it } from 'vitest';
import { buildEnduranceStatLine, SPORT_FOR_ACTIVITY_TYPE, sportForActivity } from '../sport-bridge';
import { ACTIVITY_TYPES } from '../catalog';
import { validateStatLine } from '@/lib/sports/stat-line-validate';
import { getStatSchema, STAT_SCHEMAS } from '@/lib/sports/stat-schemas';
import { FEATURE_FLAGS } from '@/lib/features';
import { fromStatLinePost } from '@/lib/performance/map';

const ride = {
  activity_type: 'ride' as const,
  occurred_on: '2026-10-04',
  name: 'Lakeshore loop',
  distance_m: 42_195,
  moving_s: 5400,
  elapsed_s: 5700,
  elev_gain_m: 312.4,
  avg_hr: 142,
  max_hr: 171,
  avg_cadence: 88,
  avg_power: 210,
  calories: 1200,
};

describe('the share-time bridge — an activity posted as a sport result (Oct 4 2026)', () => {
  it('maps only the endurance types, each to an ENABLED stat-line sport', () => {
    for (const [type, sport] of Object.entries(SPORT_FOR_ACTIVITY_TYPE)) {
      expect(ACTIVITY_TYPES).toContain(type);
      expect(FEATURE_FLAGS.FEATURE_SPORTS).toContain(sport);
      expect(getStatSchema(sport!)).not.toBeNull();
    }
    expect(sportForActivity('walk')).toBeNull();
    expect(sportForActivity('yoga')).toBeNull();
    expect(sportForActivity('hike')).toBeNull();
    expect(sportForActivity('swim')).toBe('swimming');
    expect(sportForActivity('treadmill')).toBe('running');
  });

  it('a ride becomes a cycling stat line the validator and the performance mapper both accept', () => {
    const line = buildEnduranceStatLine(ride)!;
    expect(line).toMatchObject({ type: 'stat_line', sport_key: 'cycling', date: '2026-10-04', opponent: 'Lakeshore loop' });
    expect(line.stats).toMatchObject({ distance_km: 42.2, moving_s: 5400, elapsed_s: 5700, elev_gain_m: 312, avg_hr: 142, max_hr: 171, avg_cadence: 88, avg_power: 210, calories: 1200 });
    expect(line.stats.pace_s_per_km).toBeCloseTo(127.98, 1); // 5400 s over 42.195 km
    expect(validateStatLine(line, 'cycling', '2026-12-31')).toMatchObject({ ok: true });
    const perf = fromStatLinePost({ id: 'post-1', profile_id: 'p1', sport_key: 'cycling', created_at: '2026-10-04T12:00:00Z', status: 'published', created_by_user_id: null, stats_data: line });
    expect(perf).toMatchObject({ sport_key: 'cycling', occurred_on: '2026-10-04', natural_key: 'post:post-1', headline: 42.2 });
    expect(perf!.metrics.distance_km).toBe(42.2);
  });

  it('water sports count metres and a swim paces per 100 m; power is cycling\'s alone', () => {
    const swim = buildEnduranceStatLine({ ...ride, activity_type: 'swim', distance_m: 1500, moving_s: 1800, elapsed_s: 1900, avg_power: 100, elev_gain_m: null })!;
    expect(swim.sport_key).toBe('swimming');
    expect(swim.stats.distance_m).toBe(1500);
    expect(swim.stats.pace_s_per_100m).toBe(120);
    expect('avg_power' in swim.stats).toBe(false);
    expect('distance_km' in swim.stats).toBe(false);
    expect(validateStatLine(swim, 'swimming', '2026-12-31')).toMatchObject({ ok: true });
    const row = buildEnduranceStatLine({ ...ride, activity_type: 'row', distance_m: 5000, moving_s: 1200 })!;
    expect(row.sport_key).toBe('rowing');
    expect(row.stats.distance_m).toBe(5000);
    expect(row.stats.pace_s_per_km).toBe(240);
    expect(validateStatLine(row, 'rowing', '2026-12-31')).toMatchObject({ ok: true });
  });

  it('no sport, or no distance → no line; the schema\'s headline reads the line', () => {
    expect(buildEnduranceStatLine({ ...ride, activity_type: 'walk' })).toBeNull();
    expect(buildEnduranceStatLine({ ...ride, distance_m: null })).toBeNull();
    const line = buildEnduranceStatLine(ride)!;
    expect(STAT_SCHEMAS.cycling!.headline(line.stats)).toBe('42.2 km · 1:30:00');
    expect(STAT_SCHEMAS.cycling!.heroStat.compute(line.stats)).toBe(42.2);
  });
});
