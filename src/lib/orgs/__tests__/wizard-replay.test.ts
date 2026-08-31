import { describe, expect, it } from 'vitest';
import { planStructureReplay } from '../wizard-replay';

describe('planStructureReplay', () => {
  it('NULL / garbage drafts degrade to null, never throw', () => {
    expect(planStructureReplay(null, 'league', 'golf')).toBeNull();
    expect(planStructureReplay('garbage', 'league', 'golf')).toBeNull();
    expect(planStructureReplay({ divisions: 'nope' }, 'club', null)).toBeNull();
    expect(planStructureReplay({ divisions: [], teams: [] }, 'club', null)).toBeNull();
  });

  it('league plans re-stamp EVERY division sport with the org sport', () => {
    const plan = planStructureReplay(
      {
        seasonLabel: '2026–27 Season',
        divisions: [
          { sportKey: 'tampered', name: 'U13 A' },
          { sportKey: 'ice_hockey', name: 'U15 A' },
        ],
        teams: ['Blazers'],
      },
      'league',
      'ice_hockey'
    );
    expect(plan).not.toBeNull();
    expect(plan!.divisions.every(d => d.sportKey === 'ice_hockey')).toBe(true);
    expect(plan!.seasonLabel).toBe('2026–27 Season');
    expect(plan!.seasonSportKey).toBe('ice_hockey');
    expect(plan!.teams).toEqual(['Blazers']);
  });

  it('club plans keep per-division sports and derive the season label', () => {
    const plan = planStructureReplay(
      { divisions: [{ sportKey: 'soccer', name: 'U12 Coed' }], teams: [] },
      'club',
      null
    );
    expect(plan!.divisions[0].sportKey).toBe('soccer');
    expect(plan!.seasonSportKey).toBeNull();
    expect(plan!.seasonLabel).toMatch(/Season$/);
  });

  it('a teams-only draft still plans (season + teams, no divisions)', () => {
    const plan = planStructureReplay({ divisions: [], teams: ['A', 'B'] }, 'league', 'golf');
    expect(plan!.divisions).toEqual([]);
    expect(plan!.teams).toEqual(['A', 'B']);
  });
});
