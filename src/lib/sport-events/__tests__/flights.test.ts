import { describe, expect, it } from 'vitest';
import { flightLabel, flightsOf, FLIGHT_MAX, normalizeFlight, parseFlightsPlan, planFlights } from '../flights';

const rows = (indexes: Array<number | null>) => indexes.map((handicapIndex, i) => ({ participantId: `p${i + 1}`, handicapIndex }));

describe('flights', () => {
  it('labels A, B, C … Z, AA', () => {
    expect([0, 1, 2, 25, 26, 27].map(flightLabel)).toEqual(['A', 'B', 'C', 'Z', 'AA', 'AB']);
  });

  it('count mode: the indexed players sorted low to high, split into near-equal flights (the first ones take the extra); no index is never guessed', () => {
    const plan = planFlights(rows([12.4, 3.1, 20.0, 8.8, null, 15.2, 5.5, 30.1]), { mode: 'count', count: 3 });
    expect(plan.unindexed).toEqual(['p5']);
    expect(plan.assignments).toEqual([
      { participantId: 'p2', flight: 'A' }, { participantId: 'p7', flight: 'A' }, { participantId: 'p4', flight: 'A' },
      { participantId: 'p1', flight: 'B' }, { participantId: 'p6', flight: 'B' },
      { participantId: 'p3', flight: 'C' }, { participantId: 'p8', flight: 'C' },
    ]);
    expect(planFlights(rows([1, 2]), { mode: 'count', count: 4 }).assignments.map(a => a.flight)).toEqual(['A', 'B']); // never more flights than players
    expect(planFlights(rows([1, 2, 3]), { mode: 'count', count: 99 }).assignments.map(a => a.flight)).toEqual(['A', 'B', 'C']); // the cap is 6, then the field
    expect(planFlights(rows([null, null]), { mode: 'count', count: 2 })).toEqual({ assignments: [], unindexed: ['p1', 'p2'] });
    expect(planFlights([], { mode: 'count', count: 2 })).toEqual({ assignments: [], unindexed: [] });
  });

  it('bands mode: the first band whose ceiling holds the index; above every band → the last; the label trimmed', () => {
    const plan = planFlights(rows([4, 11.9, 12, 25, 40]), { mode: 'bands', bands: [{ label: ' Silver ', max_index: 24 }, { label: 'Gold', max_index: 12 }] });
    expect(plan.assignments).toEqual([
      { participantId: 'p1', flight: 'Gold' }, { participantId: 'p2', flight: 'Gold' }, { participantId: 'p3', flight: 'Gold' },
      { participantId: 'p4', flight: 'Silver' }, { participantId: 'p5', flight: 'Silver' },
    ]);
    expect(planFlights(rows([4]), { mode: 'bands', bands: [] }).assignments).toEqual([]);
  });

  it('normalizeFlight trims, clears on empty, refuses text over the cap by name', () => {
    expect(normalizeFlight(' A ')).toEqual({ ok: true, value: 'A' });
    expect(normalizeFlight('')).toEqual({ ok: true, value: null });
    expect(normalizeFlight(null)).toEqual({ ok: true, value: null });
    expect(normalizeFlight('x'.repeat(FLIGHT_MAX + 1))).toMatchObject({ ok: false, error: expect.stringContaining('flight') });
    expect(normalizeFlight(3, 'assignments[0].flight')).toMatchObject({ ok: false, error: 'assignments[0].flight must be text' });
  });

  it('parseFlightsPlan: every id an eligible player, none twice, each flight normalized', () => {
    const eligible = new Set(['p1', 'p2']);
    expect(parseFlightsPlan({ assignments: [{ participant_id: 'p1', flight: 'A' }, { participant_id: 'p2', flight: '' }] }, eligible)).toEqual({ ok: true, value: [{ participant_id: 'p1', flight: 'A' }, { participant_id: 'p2', flight: null }] });
    expect(parseFlightsPlan({ assignments: [{ participant_id: 'p9', flight: 'A' }] }, eligible)).toMatchObject({ ok: false, error: expect.stringContaining('assignments[0].participant_id') });
    expect(parseFlightsPlan({ assignments: [{ participant_id: 'p1', flight: 'A' }, { participant_id: 'p1', flight: 'B' }] }, eligible)).toMatchObject({ ok: false, error: expect.stringContaining('twice') });
    expect(parseFlightsPlan({ assignments: 'A' }, eligible)).toMatchObject({ ok: false, error: 'assignments must be a list' });
    expect(parseFlightsPlan(null, eligible)).toMatchObject({ ok: false });
  });

  it('flightsOf lists the distinct labels in natural order', () => {
    expect(flightsOf([{ flight: 'B' }, { flight: 'A' }, { flight: null }, { flight: 'A' }])).toEqual(['A', 'B']);
  });
});
