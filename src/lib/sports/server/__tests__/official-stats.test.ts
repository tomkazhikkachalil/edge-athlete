import { describe, expect, it } from 'vitest';
import { getStatSchema } from '../../stat-schemas';
import {
  mergeOfficialContribution,
  provenanceRank,
  type OfficialStatLine,
} from '../official-stats';

const hockey = getStatSchema('ice_hockey')!;

const line = (
  stats: Record<string, number>,
  provenance: OfficialStatLine['provenance'] = 'league_verified'
): OfficialStatLine => ({
  contestId: 'c1',
  competitionId: 'comp1',
  competitionName: 'House League',
  sportKey: 'ice_hockey',
  date: '2026-09-01T00:00:00Z',
  teamName: 'Blazers',
  opponentName: 'Comets',
  stats,
  provenance,
  href: '/league/l1/standings',
});

describe('provenanceRank — the display ladder', () => {
  it('orders sanctioned > league_verified > club_recorded > tracked > imported > entered', () => {
    const order = [
      'sanctioned',
      'league_verified',
      'club_recorded',
      'tracked',
      'imported',
      'entered',
    ] as const;
    for (let i = 1; i < order.length; i++) {
      expect(provenanceRank(order[i - 1])).toBeGreaterThan(provenanceRank(order[i]));
    }
  });
});

describe('mergeOfficialContribution', () => {
  it('passes the contribution through untouched with no official lines', () => {
    const contribution = { tiles: [{ label: 'Goals', value: '3', provenance: 'tracked' as const }] };
    expect(mergeOfficialContribution(contribution, [], hockey)).toBe(contribution);
    expect(mergeOfficialContribution(null, [], hockey)).toBeNull();
  });

  it('computes official tiles with the schema profileTiles machinery', () => {
    const merged = mergeOfficialContribution(
      null,
      [line({ goals: 2, assists: 1 }), line({ goals: 1 })],
      hockey
    );
    const byLabel = new Map(merged!.tiles!.map(t => [t.label, t]));
    expect(byLabel.get('Goals')!.value).toBe('3');
    expect(byLabel.get('Assists')!.value).toBe('1');
    expect(byLabel.get('Points')!.value).toBe('4');
    expect(byLabel.get('Games')!.value).toBe('2');
  });

  it('official tiles REPLACE same-label tracked tiles (verified beats tracked)', () => {
    const contribution = {
      tiles: [
        { label: 'Goals', value: '9', provenance: 'tracked' as const },
        { label: 'Shots', value: '40', provenance: 'tracked' as const },
      ],
    };
    const merged = mergeOfficialContribution(contribution, [line({ goals: 2 })], hockey);
    const goals = merged!.tiles!.filter(t => t.label === 'Goals');
    expect(goals).toHaveLength(1);
    expect(goals[0].value).toBe('2');
    expect(goals[0].provenance).toBe('league_verified');
    // A tracked tile with no official twin survives, after the official set.
    expect(merged!.tiles!.some(t => t.label === 'Shots' && t.provenance === 'tracked')).toBe(true);
  });

  it('tile provenance is the CONSERVATIVE minimum across the lines', () => {
    const merged = mergeOfficialContribution(
      null,
      [line({ goals: 2 }, 'sanctioned'), line({ goals: 1 }, 'club_recorded')],
      hockey
    );
    for (const tile of merged!.tiles!) {
      expect(tile.provenance).toBe('club_recorded');
    }
  });

  it('degrades to the plain contribution when the sport has no schema', () => {
    const contribution = { tiles: [] };
    expect(mergeOfficialContribution(contribution, [line({ goals: 1 })], null)).toBe(contribution);
  });
});
