import { describe, it, expect } from 'vitest';
import { computeActiveSports } from '../active-sports';

const base = { declaredSport: null, postSportKeys: [], settingsSportKeys: [] };

describe('computeActiveSports', () => {
  it('returns empty for a blank profile', () => {
    expect(computeActiveSports(base)).toEqual([]);
  });

  it('declared display name leads the order', () => {
    const result = computeActiveSports({
      ...base,
      declaredSport: 'Basketball',
      postSportKeys: ['golf'],
    });
    expect(result).toEqual(['basketball', 'golf']);
  });

  it('unions posted and settings-declared sports, deduped, registry order', () => {
    const result = computeActiveSports({
      ...base,
      postSportKeys: ['soccer', 'soccer', 'golf'],
      settingsSportKeys: ['ice_hockey', 'golf'],
    });
    // no declared → pure registry declaration order
    expect(result).toEqual(['golf', 'ice_hockey', 'soccer']);
  });

  it("excludes 'general' and 'training' (post categories, not sports)", () => {
    const result = computeActiveSports({
      ...base,
      postSportKeys: ['general', 'training', 'golf', null],
      settingsSportKeys: ['training'],
    });
    expect(result).toEqual(['golf']);
  });

  it('excludes disabled sports even when declared or in settings', () => {
    const result = computeActiveSports({
      ...base,
      declaredSport: 'Tennis',
      settingsSportKeys: ['swimming'],
      postSportKeys: ['basketball'],
    });
    expect(result).toEqual(['basketball']);
  });

  it('ignores unknown sport strings safely', () => {
    const result = computeActiveSports({
      ...base,
      declaredSport: 'Cricket',
      postSportKeys: ['quidditch'],
      settingsSportKeys: ['golfing'],
    });
    expect(result).toEqual([]);
  });
});
