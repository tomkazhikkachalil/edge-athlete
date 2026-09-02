import { describe, expect, it } from 'vitest';
import { approvalFromRow, canViewPending, shouldDeleteOnDecline, siteDraftToContact, NOT_KNOWN } from '../approval';

describe('approvalFromRow', () => {
  it('pending = approved_at NULL; a row without the column (pre-174) is not known and never pending', () => {
    expect(approvalFromRow({ id: 'c', approved_at: null, primary_sport: 'golf' })).toEqual({
      known: true,
      pending: true,
      approvedAt: null,
      primarySport: 'golf',
    });
    expect(approvalFromRow({ id: 'c', approved_at: '2026-09-02T00:00:00Z' })).toMatchObject({
      known: true,
      pending: false,
      approvedAt: '2026-09-02T00:00:00Z',
      primarySport: null,
    });
    expect(approvalFromRow({ id: 'c', name: 'Old' })).toEqual(NOT_KNOWN);
    expect(approvalFromRow(null)).toEqual(NOT_KNOWN);
  });
});

describe('shouldDeleteOnDecline', () => {
  it('deletes only a provisioned org that is still pending', () => {
    expect(shouldDeleteOnDecline({ createdOrgId: 'c', approvedAt: null })).toBe(true);
    expect(shouldDeleteOnDecline({ createdOrgId: 'c', approvedAt: undefined })).toBe(true);
    expect(shouldDeleteOnDecline({ createdOrgId: 'c', approvedAt: '2026-09-02T00:00:00Z' })).toBe(false);
    expect(shouldDeleteOnDecline({ createdOrgId: null, approvedAt: null })).toBe(false);
  });
});

describe('siteDraftToContact', () => {
  it('lifts website + phone; nothing → null; junk → null', () => {
    expect(siteDraftToContact({ contact: { website: 'https://x.example', phone: '613-555-0100' } })).toEqual({
      website: 'https://x.example',
      phone: '613-555-0100',
    });
    expect(siteDraftToContact({ sports: ['golf'] })).toBeNull();
    expect(siteDraftToContact({ contact: { website: 'http://x.example' } })).toBeNull();
    expect(siteDraftToContact(null)).toBeNull();
    expect(siteDraftToContact('garbage')).toBeNull();
  });
});

describe('canViewPending', () => {
  it('managers and admins only', () => {
    expect(canViewPending({ canManage: true, isAdmin: false })).toBe(true);
    expect(canViewPending({ canManage: false, isAdmin: true })).toBe(true);
    expect(canViewPending({ canManage: false, isAdmin: false })).toBe(false);
  });
});
