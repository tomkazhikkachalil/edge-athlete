import { describe, expect, it } from 'vitest';
import {
  canOverwriteProvenance,
  deriveDisplayTier,
  stampProvenance,
} from '../provenance';

describe('stampProvenance', () => {
  it('stamps the owner as league_verified', () => {
    expect(stampProvenance('owner')).toBe('league_verified');
  });

  it('stamps a participating club as club_recorded', () => {
    expect(stampProvenance('participant')).toBe('club_recorded');
  });
});

describe('canOverwriteProvenance — the no-silent-downgrade rule', () => {
  it('lets the owner overwrite anything', () => {
    for (const existing of [
      'sanctioned',
      'league_verified',
      'club_recorded',
      'self_reported',
      'imported',
    ] as const) {
      expect(canOverwriteProvenance(existing, 'owner')).toBe(true);
    }
  });

  it('blocks a participant from replacing owner-verified rows', () => {
    expect(canOverwriteProvenance('league_verified', 'participant')).toBe(false);
    expect(canOverwriteProvenance('sanctioned', 'participant')).toBe(false);
    expect(canOverwriteProvenance('imported', 'participant')).toBe(false);
  });

  it('lets a participant replace its own or self-reported rows', () => {
    expect(canOverwriteProvenance('club_recorded', 'participant')).toBe(true);
    expect(canOverwriteProvenance('self_reported', 'participant')).toBe(true);
  });
});

describe('deriveDisplayTier — sanctioned is derived, never stored', () => {
  it('upgrades league_verified only through a live league sanctioning edge', () => {
    expect(
      deriveDisplayTier('league_verified', { ownerIsLeague: true, sanctionedEdgeToClub: true })
    ).toBe('sanctioned');
  });

  it('never upgrades without the edge or when a club owns the competition', () => {
    expect(
      deriveDisplayTier('league_verified', { ownerIsLeague: true, sanctionedEdgeToClub: false })
    ).toBe('league_verified');
    expect(
      deriveDisplayTier('league_verified', { ownerIsLeague: false, sanctionedEdgeToClub: true })
    ).toBe('league_verified');
  });

  it('never upgrades other rungs regardless of context', () => {
    for (const stored of ['club_recorded', 'self_reported', 'imported'] as const) {
      expect(
        deriveDisplayTier(stored, { ownerIsLeague: true, sanctionedEdgeToClub: true })
      ).toBe(stored);
    }
  });
});
