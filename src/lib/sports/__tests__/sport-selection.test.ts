import { describe, it, expect } from 'vitest';
import { toggleSportSelection, MAX_SELECTED_SPORTS } from '../sport-selection';
import type { SportKey } from '../SportRegistry';

describe('toggleSportSelection', () => {
  it('adds a sport and preserves selection order (first = primary)', () => {
    let sel: SportKey[] = [];
    sel = toggleSportSelection(sel, 'basketball');
    sel = toggleSportSelection(sel, 'golf');
    expect(sel).toEqual(['basketball', 'golf']);
  });

  it('removes a selected sport; removing the primary promotes the next', () => {
    const sel = toggleSportSelection(['basketball', 'golf'] as SportKey[], 'basketball');
    expect(sel).toEqual(['golf']);
  });

  it('caps at the max and ignores additions beyond it', () => {
    const full = ['golf', 'basketball', 'soccer'] as SportKey[];
    expect(full).toHaveLength(MAX_SELECTED_SPORTS);
    expect(toggleSportSelection(full, 'baseball')).toEqual(full);
    // removal still allowed at the cap
    expect(toggleSportSelection(full, 'soccer')).toEqual(['golf', 'basketball']);
  });
});
