import { describe, it, expect } from 'vitest';
import { sanitizeEquipmentPrefs, orderSportKeys } from '../equipment-prefs';

describe('sanitizeEquipmentPrefs', () => {
  it('returns {} for anything non-object (never throws)', () => {
    for (const raw of [null, undefined, 'x', 42, [], true]) {
      expect(sanitizeEquipmentPrefs(raw)).toEqual({});
    }
  });

  it('keeps only known keys with valid values', () => {
    expect(sanitizeEquipmentPrefs({
      sportOrder: ['golf', 'ice_hockey'],
      defaultSort: 'brand',
      defaultView: 2024,
      hideHistory: true,
      hiddenSports: ['soccer'],
      cardDetail: 'compact',
      evil: 'ignored',
    })).toEqual({
      sportOrder: ['golf', 'ice_hockey'],
      defaultSort: 'brand',
      defaultView: 2024,
      hideHistory: true,
      hiddenSports: ['soccer'],
      cardDetail: 'compact',
    });
  });

  it('drops invalid enum/range values instead of guessing', () => {
    expect(sanitizeEquipmentPrefs({
      defaultSort: 'chaos',
      defaultView: 1200,
      cardDetail: 'huge',
      hideHistory: 'yes',
    })).toEqual({});
    expect(sanitizeEquipmentPrefs({ defaultView: 'now' })).toEqual({ defaultView: 'now' });
  });

  it('sanitizes sport lists: strings only, trimmed, deduped, capped', () => {
    const prefs = sanitizeEquipmentPrefs({
      sportOrder: [' golf ', 'golf', 7, '', 'soccer'],
      hiddenSports: Array.from({ length: 30 }, (_, i) => `sport${i}`),
    });
    expect(prefs.sportOrder).toEqual(['golf', 'soccer']);
    expect(prefs.hiddenSports).toHaveLength(20);
  });
});

describe('orderSportKeys', () => {
  it('applies preferred order first, appends the rest in fallback order', () => {
    expect(orderSportKeys(['golf', 'ice_hockey', 'soccer'], { sportOrder: ['ice_hockey', 'golf'] }))
      .toEqual(['ice_hockey', 'golf', 'soccer']);
  });

  it('ignores preferred sports not present', () => {
    expect(orderSportKeys(['golf'], { sportOrder: ['tennis', 'golf'] })).toEqual(['golf']);
  });

  it('is the identity with no prefs', () => {
    expect(orderSportKeys(['a', 'b'], {})).toEqual(['a', 'b']);
  });
});
