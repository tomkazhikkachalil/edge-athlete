import { describe, it, expect } from 'vitest';
import { guardianRecipients } from '../guardian-notify';

describe('guardianRecipients', () => {
  it('empty rows → empty list', () => {
    expect(guardianRecipients([])).toEqual([]);
  });

  it('dedupes repeated guardian rows', () => {
    expect(guardianRecipients([{ user_id: 'a' }, { user_id: 'a' }, { user_id: 'b' }]))
      .toEqual(['a', 'b']);
  });

  it('excludes the acting guardian — no self-notification', () => {
    expect(guardianRecipients([{ user_id: 'a' }, { user_id: 'b' }], 'a')).toEqual(['b']);
  });

  it('exclusion of the only guardian leaves nobody (caller inserts nothing)', () => {
    expect(guardianRecipients([{ user_id: 'a' }], 'a')).toEqual([]);
  });

  it('drops empty user_ids defensively', () => {
    expect(guardianRecipients([{ user_id: '' }, { user_id: 'b' }])).toEqual(['b']);
  });

  it('null exclude keeps everyone', () => {
    expect(guardianRecipients([{ user_id: 'a' }, { user_id: 'b' }], null)).toEqual(['a', 'b']);
  });
});
