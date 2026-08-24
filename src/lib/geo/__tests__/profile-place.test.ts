import { describe, expect, it } from 'vitest';
import { placeToProfileFields, profileToPlace } from '../profile-place';

const ottawa = {
  place_id: 'p1', city: 'Ottawa', region: 'Ontario', region_code: 'ON',
  country: 'Canada', country_code: 'CA', lat: 45.42, lng: -75.69,
};

describe('profileToPlace', () => {
  it('rebuilds the picker value from a picked profile', () => {
    expect(profileToPlace(ottawa)).toEqual({
      placeId: 'p1', city: 'Ottawa', region: 'Ontario', regionCode: 'ON', country: 'Canada', countryCode: 'CA',
      lat: 45.42, lng: -75.69, label: 'Ottawa, Ontario · Canada',
    });
  });

  it('is null for free-text-only profiles and for partial rows', () => {
    expect(profileToPlace({ city: 'Ottawa' })).toBeNull();
    expect(profileToPlace({ ...ottawa, lat: null })).toBeNull();
    expect(profileToPlace(null)).toBeNull();
  });
});

describe('placeToProfileFields', () => {
  it('writes every column for a pick and CLEARS every column for free text', () => {
    const v = profileToPlace(ottawa)!;
    expect(placeToProfileFields(v)).toEqual({
      place_id: 'p1', city: 'Ottawa', region: 'Ontario', region_code: 'ON', country: 'Canada', country_code: 'CA',
      lat: 45.42, lng: -75.69, location_source: 'user',
    });
    const cleared = placeToProfileFields(null);
    expect(Object.values(cleared).every(x => x === '')).toBe(true);
    expect(Object.keys(cleared)).toContain('location_source');
  });
});
