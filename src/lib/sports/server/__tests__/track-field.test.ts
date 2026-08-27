import { describe, it, expect } from 'vitest';
import { buildTrackSkillContribution, enteredPBs, trackedPBs } from '../track-field';
import { assembleSkillCard } from '../index';
import { computeProfileTile, formatRaceTime } from '../../stat-schemas';

describe('formatRaceTime', () => {
  it('sprints read as seconds, distance as m:ss.xx', () => {
    expect(formatRaceTime(11.85)).toBe('11.85s');
    expect(formatRaceTime(59.99)).toBe('59.99s');
    expect(formatRaceTime(60)).toBe('1:00.00');
    expect(formatRaceTime(245.3)).toBe('4:05.30');
  });
});

describe("computeProfileTile 'min'", () => {
  const line = (stats: Record<string, number>) =>
    ({ type: 'stat_line' as const, sport_key: 'track_field' as const, stats });

  it('takes the fastest time, ignoring zero/absent', () => {
    const tile = { label: '100m PB', compute: { kind: 'min' as const, keys: ['time_100m'] } };
    const lines = [line({ time_100m: 12.4 }), line({ time_100m: 0 }), line({ time_200m: 24 }), line({ time_100m: 11.85 })];
    expect(computeProfileTile(tile, lines)).toBe('11.85');
  });

  it('renders "-" when the event was never recorded', () => {
    const tile = { label: '100m PB', compute: { kind: 'min' as const, keys: ['time_100m'] } };
    expect(computeProfileTile(tile, [line({ time_200m: 24 })])).toBe('-');
  });
});

describe('buildTrackSkillContribution', () => {
  const pbs = (entries: Record<string, number>) => new Map(Object.entries(entries));

  it('headline is the shortest-distance event with any PB', () => {
    const c = buildTrackSkillContribution(pbs({ time_400m: 52.1 }), pbs({ time_200m: 23.5 }), 3);
    // 200m (entered) is shorter than 400m (tracked) → 200m headlines.
    expect(c.headline).toEqual({ value: '23.50s', label: '200m PB', provenance: 'entered' });
    expect(c.tiles).toEqual([
      { label: '400m PB', value: '52.10s', provenance: 'tracked' },
      { label: 'Races', value: '3', provenance: 'tracked' },
    ]);
  });

  it('per event, a tracked PB beats the self-reported one and consumes its chip', () => {
    const c = buildTrackSkillContribution(pbs({ time_100m: 11.2 }), pbs({ time_100m: 10.9 }), 1);
    // Even a FASTER claimed time loses to the tracked one — verified wins.
    expect(c.headline).toEqual({ value: '11.20s', label: '100m PB', provenance: 'tracked' });
    expect(c.consumedEnteredKeys).toEqual(['pb_100m']);
  });

  it('entered-only card renders with self-reported provenance and no Races tile', () => {
    const c = buildTrackSkillContribution(new Map(), pbs({ time_800m: 155.2 }), 0);
    expect(c.headline).toEqual({ value: '2:35.20', label: '800m PB', provenance: 'entered' });
    expect(c.tiles).toEqual([]);
    expect(c.consumedEnteredKeys).toEqual(['pb_800m']);
  });

  it('nothing at all yields a null headline (card omitted downstream)', () => {
    const c = buildTrackSkillContribution(new Map(), new Map(), 0);
    expect(c.headline).toBeNull();
    expect(assembleSkillCard('track_field', c, [])).toBeNull();
  });
});

describe('PB extraction', () => {
  it('trackedPBs keeps the minimum per event across race lines', () => {
    const best = trackedPBs([{ time_100m: 12.1 }, { time_100m: 11.7, time_200m: 24.9 }]);
    expect(best.get('time_100m')).toBe(11.7);
    expect(best.get('time_200m')).toBe(24.9);
  });

  it('enteredPBs reads pb_<event> keys and ignores junk', () => {
    const best = enteredPBs({ pb_100m: 11.9, pb_200m: 0, pb_400m: 'fast' as unknown as number });
    expect(best.get('time_100m')).toBe(11.9);
    expect(best.has('time_200m')).toBe(false);
    expect(best.has('time_400m')).toBe(false);
  });

  it('a consumed PB chip disappears while unconsumed chips stay', () => {
    const c = buildTrackSkillContribution(new Map(), enteredPBs({ pb_100m: 11.9 }), 0);
    const card = assembleSkillCard('track_field', c, [
      { key: 'pb_100m', label: '100m PB (self-reported)', value: '11.9' },
      { key: 'team_name', label: 'Team', value: 'North Stars TC' },
    ]);
    expect(card?.entered).toEqual([{ key: 'team_name', label: 'Team', value: 'North Stars TC' }]);
  });
});
