import { describe, expect, it } from 'vitest';
import { formatPlace, normalizeCountry, normalizeRegion } from '../regions';
import { COUNTRY_NAMES, US_REGIONS, CA_REGIONS } from '../iso-data';

describe('iso-data (generated from GeoNames)', () => {
  it('carries the full country table and the two subdivision tables', () => {
    expect(Object.keys(COUNTRY_NAMES).length).toBeGreaterThan(240);
    expect(COUNTRY_NAMES.CA).toBe('Canada');
    expect(COUNTRY_NAMES.US).toBe('United States');
    expect(US_REGIONS.FL).toBe('Florida');
    expect(CA_REGIONS.ON).toBe('Ontario');
    expect(Object.keys(CA_REGIONS)).toHaveLength(13);
  });
});

describe('normalizeCountry', () => {
  it('accepts ISO codes in any case and returns name + code', () => {
    expect(normalizeCountry('US')).toEqual({ name: 'United States', code: 'US' });
    expect(normalizeCountry('ca')).toEqual({ name: 'Canada', code: 'CA' });
  });

  it('accepts names and the aliases providers/people actually use', () => {
    expect(normalizeCountry('Canada')).toEqual({ name: 'Canada', code: 'CA' });
    expect(normalizeCountry('USA')?.code).toBe('US');
    expect(normalizeCountry('United States of America')?.code).toBe('US');
    expect(normalizeCountry('UK')?.code).toBe('GB');
    expect(normalizeCountry('Scotland')?.code).toBe('GB');
    expect(normalizeCountry('South Korea')?.code).toBe('KR');
    expect(normalizeCountry('Türkiye')?.code).toBe('TR');
  });

  it('never guesses: blanks, Unknown, and junk are null', () => {
    expect(normalizeCountry('')).toBeNull();
    expect(normalizeCountry('  ')).toBeNull();
    expect(normalizeCountry('Unknown')).toBeNull();
    expect(normalizeCountry('Narnia')).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
  });
});

describe('normalizeRegion', () => {
  it('expands US/CA codes and recognises names, with the code', () => {
    expect(normalizeRegion('FL', 'US')).toEqual({ name: 'Florida', code: 'FL' });
    expect(normalizeRegion('Florida', 'US')).toEqual({ name: 'Florida', code: 'FL' });
    expect(normalizeRegion('Ontario', 'CA')).toEqual({ name: 'Ontario', code: 'ON' });
    expect(normalizeRegion('on', 'ca')).toEqual({ name: 'Ontario', code: 'ON' });
    expect(normalizeRegion('Québec', 'CA')).toEqual({ name: 'Quebec', code: 'QC' });
  });

  it('keeps unknown regions as their own name with no code', () => {
    expect(normalizeRegion('Bavaria', 'DE')).toEqual({ name: 'Bavaria', code: null });
    expect(normalizeRegion('Fife', null)).toEqual({ name: 'Fife', code: null });
    expect(normalizeRegion('Unknown', 'US')).toBeNull();
    expect(normalizeRegion('', 'US')).toBeNull();
  });
});

describe('formatPlace', () => {
  it('drops missing parts and keeps the country after a middle dot', () => {
    expect(formatPlace({ city: 'Ottawa', region: 'Ontario', country: 'Canada' })).toBe('Ottawa, Ontario · Canada');
    expect(formatPlace({ city: 'Ottawa', country: 'Canada' })).toBe('Ottawa · Canada');
    expect(formatPlace({ region: 'Ontario' })).toBe('Ontario');
    expect(formatPlace({})).toBe('');
  });
});
