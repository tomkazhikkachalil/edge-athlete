import { describe, expect, it } from 'vitest';
import { computeProfileTile, getStatSchema, STAT_SCHEMAS, type StatLineData } from '../stat-schemas';

// Round 4 — non-golf parity in the schemas: the `ratio` tile (batting AVG,
// SV%, FG%), race-time PBs for every track event, the goalie / pitcher /
// attempts fields, and `decimal` on the fields a phone must type with a
// decimal keypad.

const line = (sport: 'baseball' | 'ice_hockey' | 'basketball' | 'track_field', stats: Record<string, number>): StatLineData => ({ type: 'stat_line', sport_key: sport, stats });

describe('the ratio tile', () => {
  it('batting average is Σhits / Σat-bats in the .300 convention; no at-bats → -', () => {
    const avg = getStatSchema('baseball')!.profileTiles.find(t => t.label === 'AVG')!;
    expect(computeProfileTile(avg, [line('baseball', { hits: 2, at_bats: 4 }), line('baseball', { hits: 1, at_bats: 6 })])).toBe('.300');
    expect(computeProfileTile(avg, [line('baseball', { hits: 0, at_bats: 0 })])).toBe('-');
    expect(computeProfileTile(avg, [line('baseball', { hits: 5, at_bats: 5 })])).toBe('1.000');
  });
  it('hockey SV% and basketball FG% are ratios of sums too', () => {
    const sv = getStatSchema('ice_hockey')!.profileTiles.find(t => t.label === 'SV%')!;
    expect(computeProfileTile(sv, [line('ice_hockey', { saves: 27, goals_against: 3 })])).toBe('.900');
    const fg = getStatSchema('basketball')!.profileTiles.find(t => t.label === 'FG%')!;
    expect(computeProfileTile(fg, [line('basketball', { fgm: 9, fga: 20 }), line('basketball', { fgm: 3, fga: 10 })])).toBe('.400');
  });
});

describe('track', () => {
  it('every event has a PB tile, formatted as a time past a minute; the decimal keypad on every field', () => {
    const track = getStatSchema('track_field')!;
    expect(track.profileTiles.map(t => t.label)).toEqual(['100m PB', '200m PB', '400m PB', '800m PB', '1500m PB', 'Races']);
    const pb1500 = track.profileTiles.find(t => t.label === '1500m PB')!;
    expect(computeProfileTile(pb1500, [line('track_field', { time_1500m: 245.3 }), line('track_field', { time_1500m: 251.02 })])).toBe('4:05.30');
    const pb100 = track.profileTiles.find(t => t.label === '100m PB')!;
    expect(computeProfileTile(pb100, [line('track_field', { time_100m: 11.85 })])).toBe('11.85s');
    expect(track.fields.every(f => f.decimal)).toBe(true);
  });
});

describe('the new fields', () => {
  it('goalie, pitcher (innings decimal), attempts, volleyball attack line', () => {
    const keys = (s: keyof typeof STAT_SCHEMAS) => STAT_SCHEMAS[s]!.fields.map(f => f.key);
    expect(keys('ice_hockey')).toEqual(expect.arrayContaining(['saves', 'goals_against']));
    expect(keys('baseball')).toEqual(expect.arrayContaining(['innings_pitched', 'strikeouts', 'earned_runs']));
    expect(STAT_SCHEMAS.baseball!.fields.find(f => f.key === 'innings_pitched')!.decimal).toBe(true);
    expect(keys('basketball')).toEqual(expect.arrayContaining(['fga', 'fgm', 'fta', 'ftm', 'turnovers']));
    expect(keys('volleyball')).toEqual(expect.arrayContaining(['attack_attempts', 'attack_errors']));
    // Integer fields stay integer.
    expect(STAT_SCHEMAS.ice_hockey!.fields.find(f => f.key === 'goals')!.decimal).toBeUndefined();
  });
});
