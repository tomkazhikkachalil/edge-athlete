import { describe, expect, it } from 'vitest';
import { ORG_SECTIONS } from '../authz';
import { describeGrant, mergeSections, normalizeSections, StaffGrantSchema, StaffInviteCreateSchema } from '../staff-validate';
import { grantFromInput } from '../staff-invites';
import { parseParkedOrgInvite } from '@/lib/org-invite-parked';

describe('StaffGrantSchema (178 shape rule)', () => {
  it('admin ⇒ org scope, no sections', () => {
    expect(StaffGrantSchema.safeParse({ role: 'admin' }).success).toBe(true);
    expect(StaffGrantSchema.safeParse({ role: 'admin', sections: ['teams'] }).success).toBe(false);
    expect(StaffGrantSchema.safeParse({ role: 'admin', scopeType: 'division', scopeId: '11111111-1111-4111-8111-111111111111' }).success).toBe(false);
  });

  it('staff ⇒ at least one known section; scope id iff a sub-scope', () => {
    expect(StaffGrantSchema.safeParse({ role: 'staff', sections: [] }).success).toBe(false);
    expect(StaffGrantSchema.safeParse({ role: 'staff', sections: ['payments'] }).success).toBe(false);
    expect(StaffGrantSchema.safeParse({ role: 'staff', sections: ['teams'] }).success).toBe(true);
    expect(StaffGrantSchema.safeParse({ role: 'staff', sections: ['teams'], scopeType: 'division' }).success).toBe(false);
    expect(StaffGrantSchema.safeParse({ role: 'staff', sections: ['teams'], scopeType: 'org', scopeId: '11111111-1111-4111-8111-111111111111' }).success).toBe(false);
    expect(StaffGrantSchema.safeParse({ role: 'staff', sections: ['teams'], scopeType: 'team', scopeId: '11111111-1111-4111-8111-111111111111' }).success).toBe(true);
  });

  it('the invite lower-cases and trims the email', () => {
    const parsed = StaffInviteCreateSchema.safeParse({ email: '  Coach@Example.COM ', grant: { role: 'staff', sections: ['roster'] } });
    expect(parsed.success && parsed.data.email).toBe('coach@example.com');
    expect(StaffInviteCreateSchema.safeParse({ email: 'nope', grant: { role: 'admin' } }).success).toBe(false);
  });
});

describe('sections helpers (pure)', () => {
  it('normalizeSections dedupes in ORG_SECTIONS order and drops unknowns', () => {
    expect(normalizeSections(['venues', 'teams', 'teams', 'payments', 'website'])).toEqual(['website', 'teams', 'venues']);
    expect(normalizeSections(null)).toEqual([]);
  });
  it('mergeSections is the union (grants are additive)', () => {
    expect(mergeSections(['teams'], ['venues', 'teams'])).toEqual(['teams', 'venues']);
    expect(mergeSections(null, ['roster'])).toEqual(['roster']);
    expect(mergeSections([...ORG_SECTIONS], ['teams'])).toEqual([...ORG_SECTIONS]);
  });
  it('describeGrant reads as a human line', () => {
    expect(describeGrant({ role: 'admin' })).toBe('Admin (every section)');
    expect(describeGrant({ role: 'staff', sections: ['venues', 'teams'] })).toBe('Teams, Venues');
    expect(describeGrant({ role: 'staff', sections: [] })).toBe('No sections');
  });
  it('grantFromInput pins the row shape: admin has null sections; org scope has null scope id', () => {
    expect(grantFromInput({ role: 'admin', scopeType: 'org' })).toEqual({ role: 'admin', sections: null, scopeType: 'org', scopeId: null, seasonId: null });
    expect(grantFromInput({ role: 'staff', sections: ['teams', 'teams'], scopeType: 'org', scopeId: 'x' })).toMatchObject({ sections: ['teams'], scopeId: null });
    expect(grantFromInput({ role: 'staff', sections: ['teams'], scopeType: 'division', scopeId: 'd1', seasonId: 's1' })).toMatchObject({ scopeType: 'division', scopeId: 'd1', seasonId: 's1' });
  });
});

describe('parseParkedOrgInvite (the parked-invite recipe)', () => {
  const now = 1_800_000_000_000;
  const tok = 'a'.repeat(32);
  it('round-trips a fresh park; rejects stale, short, or foreign payloads', () => {
    expect(parseParkedOrgInvite(JSON.stringify({ v: 1, savedAt: now - 1000, token: tok, orgName: 'Kanata GC' }), now)).toEqual({ token: tok, orgName: 'Kanata GC' });
    expect(parseParkedOrgInvite(JSON.stringify({ v: 1, savedAt: now - 31 * 86_400_000, token: tok }), now)).toBeNull();
    expect(parseParkedOrgInvite(JSON.stringify({ v: 1, savedAt: now, token: 'short' }), now)).toBeNull();
    expect(parseParkedOrgInvite(JSON.stringify({ v: 2, savedAt: now, token: tok }), now)).toBeNull();
    expect(parseParkedOrgInvite('not json', now)).toBeNull();
    expect(parseParkedOrgInvite(null, now)).toBeNull();
  });
});
