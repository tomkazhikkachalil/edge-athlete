import { describe, expect, it } from 'vitest';
import { getStatSchema } from '../../stat-schemas';
import { PROVENANCE_ORDER, PROVENANCE_RANK, provenanceAtOrAbove } from '../../provenance-copy';
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
  disputed: false,
  date: '2026-09-01T00:00:00Z',
  teamName: 'Blazers',
  opponentName: 'Comets',
  stats,
  provenance,
  href: '/league/l1/standings',
});

describe('provenanceRank — the display ladder', () => {
  it('F1: is the ONE ladder — PROVENANCE_RANK derived from PROVENANCE_ORDER, and the at-or-above set follows it', () => {
    expect(PROVENANCE_RANK).toEqual({ sanctioned: 6, league_verified: 5, club_recorded: 4, tracked: 3, imported: 2, entered: 1 });
    for (const k of PROVENANCE_ORDER) expect(provenanceRank(k)).toBe(PROVENANCE_RANK[k]);
    expect(provenanceAtOrAbove('club_recorded')).toEqual(['sanctioned', 'league_verified', 'club_recorded']);
    expect(provenanceAtOrAbove('entered')).toEqual([...PROVENANCE_ORDER]);
  });

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
  it('leaves disputed lines out of the headline numbers (R5)', () => {
    const contribution = { tiles: [{ label: 'Goals', value: '3', provenance: 'tracked' as const }] };
    const disputed = { ...line({ goals: 9 }), disputed: true };
    // Every line disputed → the contribution is untouched.
    expect(mergeOfficialContribution(contribution, [disputed], hockey)).toBe(contribution);
    // A confirmed line beside a disputed one: only the confirmed one counts.
    const merged = mergeOfficialContribution(null, [disputed, line({ goals: 2 })], hockey);
    expect(new Map(merged!.tiles!.map(t => [t.label, t.value])).get('Goals')).toBe('2');
  });

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

describe('the card stays verified-only and says how many self-posted games are besides it (Tom, Nov 14 2026)', () => {
  const post = (date: string | undefined, goals: number, opponent?: string) => ({ type: 'stat_line', sport_key: 'ice_hockey', ...(date ? { date } : {}), ...(opponent ? { opponent } : {}), stats: { goals } });
  const tracked = (lines: unknown[]) => ({ tiles: [{ label: 'Goals', value: '9', provenance: 'tracked' as const }], statLines: lines });
  it('the tiles are the official lines only; a posted game of another day is counted beside them', () => {
    const merged = mergeOfficialContribution(tracked([post('2026-09-01', 1), post('2026-09-02', 3)]), [line({ goals: 2 })], hockey, true)!;
    expect(merged.tiles!.find(t => t.label === 'Goals')).toMatchObject({ value: '2', provenance: 'league_verified' });
    // Sep 1 is the official game (the same date, a sport with two sides) — one self-posted game is its own.
    expect(merged.selfPostedGames).toBe(1);
  });
  it('one to one: one official line takes one post of its day with it, not all of them', () => {
    expect(mergeOfficialContribution(tracked([post('2026-09-01', 1), post('2026-09-01', 2), post('2026-09-01', 3)]), [line({ goals: 2 })], hockey, true)!.selfPostedGames).toBe(2);
  });
  it('a sport without sides is never matched by date; a post with no date is a game of its own', () => {
    expect(mergeOfficialContribution(tracked([post('2026-09-01', 1)]), [line({ goals: 2 })], hockey, false)!.selfPostedGames).toBe(1);
    expect(mergeOfficialContribution(tracked([post(undefined, 1)]), [line({ goals: 2 })], hockey, true)!.selfPostedGames).toBe(1);
  });
  it('nothing is said when every posted game is an official one, when there are no posts, or when there is no official line', () => {
    expect(mergeOfficialContribution(tracked([post('2026-09-01', 1)]), [line({ goals: 2 })], hockey, true)!.selfPostedGames).toBeUndefined();
    expect(mergeOfficialContribution({ tiles: [] }, [line({ goals: 2 })], hockey, true)!.selfPostedGames).toBeUndefined();
    const untouched = tracked([post('2026-09-02', 3)]);
    expect(mergeOfficialContribution(untouched, [], hockey, true)).toBe(untouched);
  });
  it('a disputed line counts nothing and takes no post with it', () => {
    const merged = mergeOfficialContribution(tracked([post('2026-09-01', 1)]), [{ ...line({ goals: 2 }), disputed: true }, { ...line({ goals: 4 }), contestId: 'c2', date: '2026-09-05T00:00:00Z' }], hockey, true)!;
    expect(merged.selfPostedGames).toBe(1);
  });
});

