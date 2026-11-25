import { describe, expect, it } from 'vitest';
import { partnerName, quickAddOffered, recentPartnerIds, RECENT_PARTNERS_MAX } from '../recent-partners';

// The Players step's QUICK ADD row (golf part 2, Nov 24 2026): the people of
// the account's latest rounds, each once, newest shared round first.
describe('recentPartnerIds', () => {
  it('orders by the newest shared round, each person once, never the account itself', () => {
    const rows = [
      { profile_id: 'old', at: '2026-10-01T10:00:00Z' },
      { profile_id: 'me', at: '2026-11-20T10:00:00Z' },
      { profile_id: 'new', at: '2026-11-20T10:00:00Z' },
      { profile_id: 'old', at: '2026-11-10T10:00:00Z' },
      { profile_id: 'mid', at: '2026-11-05T10:00:00Z' },
    ];
    expect(recentPartnerIds(rows, 'me')).toEqual(['new', 'old', 'mid']);
  });
  it('skips a person who declined the round, and rows without an id', () => {
    const rows = [
      { profile_id: 'declined', status: 'declined', at: '2026-11-20T10:00:00Z' },
      { profile_id: 'pending', status: 'pending', at: '2026-11-19T10:00:00Z' },
      { profile_id: '', at: '2026-11-18T10:00:00Z' },
      { profile_id: 42, at: '2026-11-18T10:00:00Z' },
      { at: '2026-11-18T10:00:00Z' },
    ];
    expect(recentPartnerIds(rows, 'me')).toEqual(['pending']);
  });
  it('a person who declined one round but played another is still a partner', () => {
    const rows = [
      { profile_id: 'a', status: 'declined', at: '2026-11-20T10:00:00Z' },
      { profile_id: 'a', status: 'confirmed', at: '2026-11-01T10:00:00Z' },
    ];
    expect(recentPartnerIds(rows, 'me')).toEqual(['a']);
  });
  it('a row without a usable time sorts last; ties keep the given order', () => {
    const rows = [
      { profile_id: 'untimed' },
      { profile_id: 'b', at: '2026-11-01T10:00:00Z' },
      { profile_id: 'c', at: '2026-11-01T10:00:00Z' },
      { profile_id: 'bad', at: 'not a date' },
    ];
    expect(recentPartnerIds(rows, 'me')).toEqual(['b', 'c', 'untimed', 'bad']);
  });
  it('caps the list (8 by default) and answers nothing for nothing', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ profile_id: `p${i}`, at: `2026-11-${String(i + 1).padStart(2, '0')}T10:00:00Z` }));
    expect(RECENT_PARTNERS_MAX).toBe(8);
    expect(recentPartnerIds(rows, 'me')).toHaveLength(8);
    expect(recentPartnerIds(rows, 'me')[0]).toBe('p19');
    expect(recentPartnerIds(rows, 'me', 3)).toEqual(['p19', 'p18', 'p17']);
    expect(recentPartnerIds([], 'me')).toEqual([]);
  });
});

describe('quickAddOffered — adding takes a person off the row, removing brings them back', () => {
  const suggested = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('offers the suggested people who are not partners yet, in the suggested order', () => {
    expect(quickAddOffered(suggested, [])).toEqual(suggested);
    expect(quickAddOffered(suggested, ['b'])).toEqual([{ id: 'a' }, { id: 'c' }]);
    expect(quickAddOffered(suggested, ['c', 'a', 'b'])).toEqual([]);
    expect(quickAddOffered(suggested, ['someone-else'])).toEqual(suggested);
  });
});

describe('partnerName', () => {
  it('first + last, else the full name, else the first name, else a placeholder', () => {
    expect(partnerName({ first_name: 'Ada', last_name: 'Park', full_name: 'A. Park' })).toBe('Ada Park');
    expect(partnerName({ first_name: null, last_name: null, full_name: 'A. Park' })).toBe('A. Park');
    expect(partnerName({ first_name: 'Ada' })).toBe('Ada');
    expect(partnerName({})).toBe('Unknown User');
  });
});
