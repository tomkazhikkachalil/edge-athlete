import { describe, expect, it } from 'vitest';
import { ACTIVITY_TYPES, type ActivityType } from '../catalog';
import type { Derived } from '../derived';
import { MAX_TILES, TILE_FAMILY, tilesFor, type TileSource } from '../tiles';

const empty: Derived = { bestEfforts: [], maxSpeedMps: null, maxElevationM: null, climbRateMph: null, runs: 0, gradeAdjustedM: null };

function src(type: ActivityType, over: Partial<TileSource> = {}): TileSource {
  return {
    type,
    distanceM: null,
    movingS: null,
    elapsedS: 2700,
    elevGainM: null,
    elevLossM: null,
    avgHr: null,
    maxHr: null,
    avgPower: null,
    avgCadence: null,
    calories: null,
    steps: null,
    stepsSource: null,
    ...over,
  };
}

const full = (type: ActivityType): TileSource =>
  src(type, { distanceM: 8000, movingS: 2400, elapsedS: 3000, elevGainM: 400, elevLossM: 380, avgHr: 142, maxHr: 171, avgPower: 210, avgCadence: 88, calories: 600, steps: 9000, stepsSource: 'estimated' });
const rich: Derived = { bestEfforts: [], maxSpeedMps: 14, maxElevationM: 1200, climbRateMph: 700, runs: 6, gradeAdjustedM: 9000 };

describe('tilesFor', () => {
  it('a yoga session shows its time, never a distance, pace or elevation', () => {
    const keys = tilesFor(src('yoga'), null, 'km').map(t => t.key);
    expect(keys).toEqual(['time']);
    expect(tilesFor(src('yoga'), null, 'km')[0].value).toBe('45:00');
  });

  it('no session type ever shows Distance, even with one stored', () => {
    for (const t of ACTIVITY_TYPES.filter(x => TILE_FAMILY[x] === 'session')) {
      expect(tilesFor(full(t), rich, 'km').some(x => ['distance', 'pace', 'gain'].includes(x.key))).toBe(false);
    }
  });

  it('a tile appears only with a value — no heart rate without one', () => {
    const keys = tilesFor(src('hiit'), null, 'km').map(t => t.key);
    expect(keys).not.toContain('hr');
    expect(tilesFor(src('hiit', { avgHr: 150, maxHr: 180 }), null, 'km').find(t => t.key === 'hr')!.value).toBe('150 bpm · max 180');
    expect(tilesFor(src('run', { distanceM: 5000, movingS: 1500, elapsedS: 1500 }), empty, 'km').map(t => t.key)).toEqual(['distance', 'moving', 'pace']);
  });

  it('a hike shows gain, loss, high point, climb rate and moving vs total', () => {
    const keys = tilesFor(full('hike'), rich, 'km').map(t => t.key);
    expect(keys).toEqual(expect.arrayContaining(['gain', 'loss', 'high', 'climbRate', 'total']));
  });

  it('a trail run shows grade-adjusted pace', () => {
    expect(tilesFor(full('trail_run'), rich, 'km').find(t => t.key === 'gap')!.label).toBe('Grade-adjusted pace');
  });

  it('a ride shows max speed and total time even under a minute stopped', () => {
    const keys = tilesFor(src('ride', { distanceM: 20000, movingS: 2970, elapsedS: 3000 }), rich, 'km').map(t => t.key);
    expect(keys).toEqual(expect.arrayContaining(['maxSpeed', 'total']));
    expect(tilesFor(src('run', { distanceM: 5000, movingS: 1470, elapsedS: 1500 }), empty, 'km').map(t => t.key)).not.toContain('total');
  });

  it('ski days lead with descent and runs, never elevation gain', () => {
    const keys = tilesFor(full('ski'), rich, 'km').map(t => t.key);
    expect(keys.slice(0, 5)).toEqual(['distance', 'moving', 'descent', 'runs', 'maxSpeed']);
    expect(keys).not.toContain('gain');
  });

  it('a row reads per 500 m and its cadence in spm', () => {
    const t = tilesFor(src('row', { distanceM: 2000, movingS: 480, avgCadence: 26 }), null, 'mi');
    expect(t.find(x => x.key === 'pace')!.value).toBe('2:00 /500m');
    expect(t.find(x => x.key === 'cadence')!.value).toBe('26 spm');
  });

  it('never exceeds the ceiling, and the card takes four', () => {
    for (const t of ACTIVITY_TYPES) {
      expect(tilesFor(full(t), rich, 'km').length).toBeLessThanOrEqual(MAX_TILES);
      expect(tilesFor(full(t), rich, 'km', 4).length).toBeLessThanOrEqual(4);
      expect(tilesFor(full(t), rich, 'km').length).toBeGreaterThan(0);
    }
  });
});

describe('effort and lengths (265)', () => {
  it('an effort shows on every family; a pool swim counts its lengths', () => {
    expect(tilesFor(src('yoga', { effort: 6 }), null, 'km').map(t => t.key)).toEqual(['time', 'effort']);
    expect(tilesFor(src('yoga', { effort: 6 }), null, 'km')[1].value).toBe('6 / 10');
    const swim = tilesFor(src('swim', { distanceM: 1500, movingS: 1800, details: { pool: '25m' } }), null, 'km');
    expect(swim.find(t => t.key === 'lengths')!.value).toBe('60');
    expect(tilesFor(src('swim', { distanceM: 1500, movingS: 1800 }), null, 'km').some(t => t.key === 'lengths')).toBe(false);
  });
});
