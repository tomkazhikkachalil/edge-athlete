import { describe, expect, it } from 'vitest';
import {
  buildDivisionName,
  buildGridRows,
  defaultSeasonLabel,
  gridRowKey,
  STRUCTURE_TEMPLATES,
  templateFor,
} from '../structure-templates';

describe('STRUCTURE_TEMPLATES', () => {
  it('exactly the three decided sports, with defaults ⊆ vocabulary', () => {
    expect(STRUCTURE_TEMPLATES.map(t => t.sportKey)).toEqual(['ice_hockey', 'soccer', 'baseball']);
    for (const t of STRUCTURE_TEMPLATES) {
      expect(t.bands.length).toBeGreaterThan(0);
      expect(t.tiers.length).toBeGreaterThan(0);
      for (const b of t.defaults.bands) expect(t.bands).toContain(b);
      for (const s of t.defaults.streams) expect(t.streams).toContain(s);
      for (const tier of t.defaults.tiers) expect(t.tiers).toContain(tier);
      // Default cross-products stay comfortably under the 60-row cap.
      expect(
        t.defaults.bands.length * t.defaults.streams.length * t.defaults.tiers.length
      ).toBeLessThanOrEqual(20);
    }
    expect(templateFor('golf')).toBeNull();
  });
});

describe('buildDivisionName', () => {
  it('omits stream/tier when null', () => {
    expect(buildDivisionName('U11', 'Girls', 'A')).toBe('U11 Girls A');
    expect(buildDivisionName('U11', null, 'A')).toBe('U11 A');
    expect(buildDivisionName('U11', null, null)).toBe('U11');
  });
});

describe('buildGridRows', () => {
  const sel = { bands: ['U11', 'U13'], streams: ['Mixed', 'Girls'], tiers: ['A'] };

  it('cross-product with singleton tier omitted from names', () => {
    const rows = buildGridRows('ice_hockey', sel, new Set());
    expect(rows).toHaveLength(4);
    expect(rows.map(r => r.name)).toEqual(['U11 Mixed', 'U11 Girls', 'U13 Mixed', 'U13 Girls']);
    expect(rows[0]).toMatchObject({ sportKey: 'ice_hockey', ageBand: 'U11', genderStream: 'Mixed', tier: 'A' });
  });

  it('excluded row keys are honored (re-checking a box never resurrects)', () => {
    const excluded = new Set([gridRowKey('ice_hockey', 'U11', 'Girls', 'A')]);
    const rows = buildGridRows('ice_hockey', sel, excluded);
    expect(rows).toHaveLength(3);
    expect(rows.every(r => !(r.ageBand === 'U11' && r.genderStream === 'Girls'))).toBe(true);
  });

  it('empty streams/tiers behave as a single null column', () => {
    const rows = buildGridRows('golf', { bands: ['Open'], streams: [], tiers: [] }, new Set());
    expect(rows).toEqual([
      { sportKey: 'golf', name: 'Open', ageBand: 'Open', genderStream: undefined, tier: undefined },
    ]);
  });
});

describe('defaultSeasonLabel', () => {
  it('hockey spans years around the September boundary; others are calendar', () => {
    expect(defaultSeasonLabel('ice_hockey', new Date(2026, 9, 1))).toBe('2026–27 Season');
    expect(defaultSeasonLabel('ice_hockey', new Date(2026, 2, 1))).toBe('2025–26 Season');
    expect(defaultSeasonLabel('soccer', new Date(2026, 2, 1))).toBe('2026 Season');
  });
});
