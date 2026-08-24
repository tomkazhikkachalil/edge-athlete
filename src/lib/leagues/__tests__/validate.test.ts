import { describe, expect, it } from 'vitest';
import {
  LeagueCreateSchema,
  LeagueMemberRoleSchema,
  LeagueUpdateSchema,
  placeToLeagueColumns,
  type LeaguePlace,
} from '../validate';

const OWNER = '2f1b46c8-2964-4139-9689-d1c3f736ed93';

const place: LeaguePlace = {
  placeId: '688ab18b-c24d-4d24-a93e-6478f3d4acb2',
  city: 'Ottawa',
  region: 'Ontario',
  regionCode: 'ON',
  country: 'Canada',
  countryCode: 'CA',
  lat: 45.42,
  lng: -75.69,
  label: 'Ottawa, Ontario · Canada',
};

describe('LeagueCreateSchema', () => {
  it('accepts a full valid body', () => {
    const r = LeagueCreateSchema.safeParse({
      name: 'Ottawa Junior Golf League',
      sportKey: 'golf',
      description: 'Weekly junior play',
      ownerProfileId: OWNER,
      place,
    });
    expect(r.success).toBe(true);
  });

  it('accepts the minimal body (no description, no place)', () => {
    const r = LeagueCreateSchema.safeParse({
      name: 'OJGL',
      sportKey: 'golf',
      ownerProfileId: OWNER,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBeUndefined();
  });

  it('rejects a missing name, bad owner uuid, oversize description', () => {
    expect(LeagueCreateSchema.safeParse({ sportKey: 'golf', ownerProfileId: OWNER }).success).toBe(false);
    expect(LeagueCreateSchema.safeParse({ name: 'X', sportKey: 'golf', ownerProfileId: 'not-a-uuid' }).success).toBe(false);
    expect(
      LeagueCreateSchema.safeParse({
        name: 'X', sportKey: 'golf', ownerProfileId: OWNER, description: 'a'.repeat(2001),
      }).success
    ).toBe(false);
  });
});

describe('LeagueUpdateSchema', () => {
  it('has no sportKey field — immutable in v1', () => {
    const r = LeagueUpdateSchema.safeParse({ name: 'New Name', sportKey: 'soccer' });
    expect(r.success).toBe(true);
    if (r.success) expect('sportKey' in r.data).toBe(false);
  });

  it('distinguishes place: null (clear) from absent (untouched)', () => {
    const cleared = LeagueUpdateSchema.safeParse({ place: null });
    expect(cleared.success).toBe(true);
    if (cleared.success) expect(cleared.data.place).toBeNull();

    const absent = LeagueUpdateSchema.safeParse({ name: 'X' });
    expect(absent.success).toBe(true);
    if (absent.success) expect(absent.data.place).toBeUndefined();
  });
});

describe('placeToLeagueColumns', () => {
  it('maps a full place, with location_source user', () => {
    expect(placeToLeagueColumns(place)).toEqual({
      place_id: place.placeId,
      city: 'Ottawa',
      region: 'Ontario',
      region_code: 'ON',
      country: 'Canada',
      country_code: 'CA',
      lat: 45.42,
      lng: -75.69,
      location_source: 'user',
    });
  });

  it('clears with real NULLs (not the profile-PUT empty-string convention)', () => {
    const cols = placeToLeagueColumns(null);
    expect(Object.values(cols).every(v => v === null)).toBe(true);
    expect(Object.keys(cols)).toContain('location_source');
  });
});

describe('LeagueMemberRoleSchema', () => {
  it('accepts manager and member', () => {
    expect(LeagueMemberRoleSchema.safeParse({ role: 'manager' }).success).toBe(true);
    expect(LeagueMemberRoleSchema.safeParse({ role: 'member' }).success).toBe(true);
  });

  it("rejects 'owner' and junk — ownership is not a role PATCH", () => {
    expect(LeagueMemberRoleSchema.safeParse({ role: 'owner' }).success).toBe(false);
    expect(LeagueMemberRoleSchema.safeParse({ role: 'admin' }).success).toBe(false);
    expect(LeagueMemberRoleSchema.safeParse({}).success).toBe(false);
  });
});
