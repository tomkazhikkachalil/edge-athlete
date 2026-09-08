import { describe, expect, it } from 'vitest';
import { LISTING_NOT_KNOWN, isListed, isListingStatus, listingFromRow } from '../listing';

describe('listingFromRow', () => {
  it('179 row: listing_status wins, approved_at rides along as the timestamp', () => {
    expect(listingFromRow({ id: 'c', listing_status: 'unlisted', approved_at: null })).toEqual({
      known: true,
      status: 'unlisted',
      approvedAt: null,
      primarySport: null,
    });
    expect(
      listingFromRow({ id: 'c', listing_status: 'listed', approved_at: '2026-09-08T00:00:00Z', primary_sport: 'golf' })
    ).toEqual({ known: true, status: 'listed', approvedAt: '2026-09-08T00:00:00Z', primarySport: 'golf' });
    // A listed org whose timestamp was never stamped (born listed by DEFAULT) is still listed.
    expect(listingFromRow({ id: 'c', listing_status: 'listed', approved_at: null })).toMatchObject({
      status: 'listed',
      approvedAt: null,
    });
  });

  it('pre-179 row (approved_at only): derives today\'s semantics — NULL is pending, stamped is listed', () => {
    expect(listingFromRow({ id: 'c', approved_at: null })).toMatchObject({ known: true, status: 'pending' });
    expect(listingFromRow({ id: 'c', approved_at: '2026-09-02T00:00:00Z' })).toMatchObject({
      known: true,
      status: 'listed',
      approvedAt: '2026-09-02T00:00:00Z',
    });
  });

  it('pre-174 row (neither column) and a missing org are not known and read as listed', () => {
    expect(listingFromRow({ id: 'c', name: 'Old' })).toEqual(LISTING_NOT_KNOWN);
    expect(listingFromRow({ id: 'c', name: 'Old', primary_sport: 'golf' })).toEqual({
      ...LISTING_NOT_KNOWN,
      primarySport: 'golf',
    });
    expect(listingFromRow(null)).toEqual(LISTING_NOT_KNOWN);
    expect(listingFromRow(undefined)).toEqual(LISTING_NOT_KNOWN);
  });

  it('an unknown listing_status value falls back to the approved_at derivation, never throws', () => {
    expect(listingFromRow({ id: 'c', listing_status: 'bogus', approved_at: null })).toMatchObject({ status: 'pending' });
    expect(listingFromRow({ id: 'c', listing_status: 7, approved_at: 'x' })).toMatchObject({ status: 'listed' });
  });
});

describe('isListed / isListingStatus', () => {
  it('only a listed org is discoverable; not-known stays listed so old databases never hide a live org', () => {
    expect(isListed({ status: 'listed' })).toBe(true);
    expect(isListed({ status: 'pending' })).toBe(false);
    expect(isListed({ status: 'unlisted' })).toBe(false);
    expect(isListed(LISTING_NOT_KNOWN)).toBe(true);
  });
  it('guards the three values', () => {
    expect(isListingStatus('listed')).toBe(true);
    expect(isListingStatus('approved')).toBe(false);
    expect(isListingStatus(null)).toBe(false);
  });
});
