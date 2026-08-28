import { describe, it, expect } from 'vitest';
import { contactState, earliestIso, volumeBand, VOLUME_BAND_LABEL } from '../contact-roster';

describe('volumeBand', () => {
  it('boundaries: 0/1/9 few, 10/99 regular, 100+ frequent', () => {
    expect(volumeBand(0)).toBe('few');
    expect(volumeBand(1)).toBe('few');
    expect(volumeBand(9)).toBe('few');
    expect(volumeBand(10)).toBe('regular');
    expect(volumeBand(99)).toBe('regular');
    expect(volumeBand(100)).toBe('frequent');
    expect(volumeBand(5000)).toBe('frequent');
  });

  it('every band has a label', () => {
    for (const band of ['few', 'regular', 'frequent'] as const) {
      expect(VOLUME_BAND_LABEL[band]).toBeTruthy();
    }
  });
});

describe('contactState precedence: blocked > held > denied > approved', () => {
  it('blocked wins everything', () => {
    expect(contactState({ blocked: true, held: true, ledgerStatus: 'denied' })).toBe('blocked');
  });
  it('held beats the ledger', () => {
    expect(contactState({ blocked: false, held: true, ledgerStatus: 'approved' })).toBe('held');
    expect(contactState({ blocked: false, held: true, ledgerStatus: 'denied' })).toBe('held');
  });
  it('denied beats approved-by-default', () => {
    expect(contactState({ blocked: false, held: false, ledgerStatus: 'denied' })).toBe('denied');
  });
  it('otherwise approved', () => {
    expect(contactState({ blocked: false, held: false, ledgerStatus: 'approved' })).toBe('approved');
    expect(contactState({ blocked: false, held: false, ledgerStatus: null })).toBe('approved');
  });
});

describe('earliestIso', () => {
  it('nulls tolerated, earlier wins', () => {
    expect(earliestIso(null, null)).toBeNull();
    expect(earliestIso('2026-01-02', null)).toBe('2026-01-02');
    expect(earliestIso(null, '2026-01-02')).toBe('2026-01-02');
    expect(earliestIso('2026-01-02', '2026-01-01')).toBe('2026-01-01');
  });
});
