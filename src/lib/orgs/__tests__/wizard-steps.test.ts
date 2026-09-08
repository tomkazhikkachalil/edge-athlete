import { describe, expect, it } from 'vitest';
import { isSmallPath, stepsFor } from '../wizard-steps';

describe('stepsFor', () => {
  it('a club with zero or one sport takes the small path from ANY entry point', () => {
    expect(stepsFor({ side: 'club', sportsCount: 0, expandStructure: false })).toEqual(['identity', 'review']);
    expect(stepsFor({ side: 'club', sportsCount: 1, expandStructure: false })).toEqual(['identity', 'review']);
  });
  it('a multi-sport club has divisions by definition → the full path', () => {
    expect(stepsFor({ side: 'club', sportsCount: 2, expandStructure: false })).toEqual([
      'identity', 'structure', 'connections', 'review',
    ]);
  });
  it('a league is single-sport: small path with its sport step; the expander opens the full path', () => {
    expect(stepsFor({ side: 'league', sportsCount: 1, expandStructure: false })).toEqual(['identity', 'sport', 'review']);
    expect(stepsFor({ side: 'league', sportsCount: 1, expandStructure: true })).toEqual([
      'identity', 'sport', 'structure', 'connections', 'review',
    ]);
  });
  it('"We run divisions or teams" always wins', () => {
    expect(isSmallPath({ side: 'club', sportsCount: 1, expandStructure: true })).toBe(false);
    expect(stepsFor({ side: 'club', sportsCount: 1, expandStructure: true })).toEqual([
      'identity', 'structure', 'connections', 'review',
    ]);
  });
});
