// Moved from src/lib/clubs/__tests__ in Round 5 step F — the schemas live in orgs/validate.ts (E-1).
import { describe, expect, it } from 'vitest';
import {
  ClubCreateSchema,
  OrgMemberRoleSchema,
  ClubRequestSchema,
  OrgRequestDecisionSchema,
  placeToOrgColumns,
  type OrgPlace,
} from '../validate';

const OWNER = '2f1b46c8-2964-4139-9689-d1c3f736ed93';

const place: OrgPlace = {
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

describe('ClubCreateSchema', () => {
  it('accepts a full body — and has NO sportKey (clubs are multi-sport)', () => {
    const r = ClubCreateSchema.safeParse({
      name: 'Ottawa Athletics Club',
      description: 'All sports welcome',
      ownerProfileId: OWNER,
      place,
    });
    expect(r.success).toBe(true);
    // A sportKey is stripped, not accepted — the designed divergence.
    const withSport = ClubCreateSchema.safeParse({
      name: 'X', ownerProfileId: OWNER, sportKey: 'golf',
    });
    expect(withSport.success).toBe(true);
    if (withSport.success) expect('sportKey' in withSport.data).toBe(false);
  });

  it('rejects missing name / bad owner uuid / oversize description', () => {
    expect(ClubCreateSchema.safeParse({ ownerProfileId: OWNER }).success).toBe(false);
    expect(ClubCreateSchema.safeParse({ name: 'X', ownerProfileId: 'nope' }).success).toBe(false);
    expect(
      ClubCreateSchema.safeParse({ name: 'X', ownerProfileId: OWNER, description: 'a'.repeat(2001) }).success
    ).toBe(false);
  });
});

describe('ClubRequestSchema', () => {
  it('strips a client-sent ownerProfileId — the requester is the session user', () => {
    const r = ClubRequestSchema.safeParse({ name: 'Wannabe Club', ownerProfileId: OWNER });
    expect(r.success).toBe(true);
    if (r.success) expect('ownerProfileId' in r.data).toBe(false);
  });
});

describe('OrgRequestDecisionSchema', () => {
  const REQ = '2f1b46c8-2964-4139-9689-d1c3f736ed93';
  it('decline requires a reason; approve does not', () => {
    expect(OrgRequestDecisionSchema.safeParse({ requestId: REQ, decision: 'approve' }).success).toBe(true);
    expect(OrgRequestDecisionSchema.safeParse({ requestId: REQ, decision: 'decline' }).success).toBe(false);
    expect(
      OrgRequestDecisionSchema.safeParse({ requestId: REQ, decision: 'decline', reason: 'Duplicate' }).success
    ).toBe(true);
  });
});

describe('OrgMemberRoleSchema', () => {
  it("allows manager/member, never 'owner'", () => {
    expect(OrgMemberRoleSchema.safeParse({ role: 'manager' }).success).toBe(true);
    expect(OrgMemberRoleSchema.safeParse({ role: 'owner' }).success).toBe(false);
  });
});

describe('placeToOrgColumns', () => {
  it('maps a full place and clears with real NULLs', () => {
    expect(placeToOrgColumns(place).city).toBe('Ottawa');
    expect(placeToOrgColumns(place).location_source).toBe('user');
    expect(Object.values(placeToOrgColumns(null)).every(v => v === null)).toBe(true);
  });
});
