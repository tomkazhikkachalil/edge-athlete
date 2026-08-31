import { describe, expect, it } from 'vitest';
import { FacilityCreateSchema, VenueCreateSchema, placeToVenueColumns } from '../validate';

const PLACE = {
  placeId: '2f1b46c8-2964-4139-9689-d1c3f736ed93',
  city: 'Kanata',
  region: 'Ontario',
  regionCode: 'ON',
  country: 'Canada',
  countryCode: 'CA',
  lat: 45.3,
  lng: -75.9,
  label: 'Kanata, Ontario, Canada',
};

describe('VenueCreateSchema', () => {
  it('accepts a minimal venue and trims the name', () => {
    const parsed = VenueCreateSchema.parse({ name: '  Kanata Rec Complex  ' });
    expect(parsed.name).toBe('Kanata Rec Complex');
    expect(parsed.facilities).toBeUndefined();
  });

  it('accepts place, golf link and facilities; rejects garbage', () => {
    const parsed = VenueCreateSchema.parse({
      name: 'Rink',
      place: PLACE,
      golfClubId: PLACE.placeId,
      facilities: [{ name: 'Pad A' }, { name: 'Pad B', kind: 'rink' }],
    });
    expect(parsed.facilities).toHaveLength(2);
    expect(VenueCreateSchema.safeParse({ name: '' }).success).toBe(false);
    expect(VenueCreateSchema.safeParse({ name: 'X', golfClubId: 'nope' }).success).toBe(false);
    expect(
      VenueCreateSchema.safeParse({
        name: 'X',
        facilities: Array.from({ length: 21 }, (_, i) => ({ name: `F${i}` })),
      }).success
    ).toBe(false);
  });

  it('facility kind is optional and bounded', () => {
    expect(FacilityCreateSchema.safeParse({ name: 'Court 3' }).success).toBe(true);
    expect(FacilityCreateSchema.safeParse({ name: 'Court 3', kind: 'x'.repeat(41) }).success).toBe(false);
  });
});

describe('placeToVenueColumns', () => {
  it('maps a pick to columns and a clear to NULLs (no location_source — venues have none)', () => {
    const cols = placeToVenueColumns(PLACE);
    expect(cols.place_id).toBe(PLACE.placeId);
    expect(cols.city).toBe('Kanata');
    expect(cols.region_code).toBe('ON');
    expect(cols).not.toHaveProperty('location_source');
    const cleared = placeToVenueColumns(null);
    expect(cleared.place_id).toBeNull();
    expect(cleared.lat).toBeNull();
  });
});
