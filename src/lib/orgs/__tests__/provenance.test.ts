import { describe, expect, it } from 'vitest';
import {
  canOverwriteProvenance,
  deriveDisplayTier,
  resolveSanctionedPairs,
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

// Phase 6 R3: the chain resolver — common-authority semantics.
describe('resolveSanctionedPairs', () => {
  const club = (leagueId: string, clubId: string) => ({ leagueId, clubId });
  const parent = (leagueId: string, parentLeagueId: string) => ({ leagueId, parentLeagueId });

  it('single-hop parity: direct edges only (the pre-167 world)', () => {
    const pairs = resolveSanctionedPairs([club('L1', 'C1')], [], ['L1', 'L2']);
    expect(pairs.has('L1:C1')).toBe(true);
    expect(pairs.has('L2:C1')).toBe(false);
  });

  it('2-hop upgrade: the owner sits under the club’s sanctioner', () => {
    // District D sanctions club C; KMHA is sanctioned by D; KMHA owns the
    // competition → sanctioned.
    const pairs = resolveSanctionedPairs(
      [club('D', 'C')],
      [parent('KMHA', 'D')],
      ['KMHA']
    );
    expect(pairs.has('KMHA:C')).toBe(true);
  });

  it('down-chain: the federation owns, a child league sanctions the club', () => {
    const pairs = resolveSanctionedPairs(
      [club('KMHA', 'C')],
      [parent('KMHA', 'FED')],
      ['FED']
    );
    expect(pairs.has('FED:C')).toBe(true);
  });

  it('siblings under one federation share the authority', () => {
    const pairs = resolveSanctionedPairs(
      [club('LA', 'C')],
      [parent('LA', 'FED'), parent('LB', 'FED')],
      ['LB']
    );
    expect(pairs.has('LB:C')).toBe(true);
  });

  it('cycles terminate and depth is bounded', () => {
    const cycle = resolveSanctionedPairs(
      [club('A', 'C')],
      [parent('A', 'B'), parent('B', 'A')],
      ['B']
    );
    expect(cycle.has('B:C')).toBe(true); // B→(parent chain)…: A ancestors include B? B's ancestors {B,A}; sanctioners(C)=ancestors(A)={A,B} → shared
    // Depth cutoff: a 5-level ladder exceeds maxDepth 3 from the top.
    const ladder = resolveSanctionedPairs(
      [club('L0', 'C')],
      [parent('L0', 'L1'), parent('L1', 'L2'), parent('L2', 'L3'), parent('L3', 'L4')],
      ['L4']
    );
    expect(ladder.has('L4:C')).toBe(false); // L4 only reaches down… ancestors(L4)={L4}; sanctioners(C)=ancestors(L0) bounded at 3 = {L0,L1,L2,L3} → no overlap
    const nearer = resolveSanctionedPairs(
      [club('L0', 'C')],
      [parent('L0', 'L1'), parent('L1', 'L2'), parent('L2', 'L3')],
      ['L3']
    );
    expect(nearer.has('L3:C')).toBe(true);
  });

  it('member_of never chains (callers pre-filter, but empty input is safe)', () => {
    const pairs = resolveSanctionedPairs([], [parent('A', 'B')], ['B']);
    expect(pairs.size).toBe(0);
  });
});
