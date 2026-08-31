import { describe, expect, it } from 'vitest';
import { parseRosterImport } from '../roster-import';
import { isStubEmail, makeStubEmail } from '@/lib/config/stubs-config';
import { isSyntheticEmail } from '@/lib/config/minors-config';

describe('parseRosterImport', () => {
  it('parses names, multi-word last names, optional emails; first-comma split', () => {
    const { rows, errors } = parseRosterImport(
      [
        'Rory Marchand',
        'Jean Paul de la Croix, jp@example.com',
        'Cher',
        '  Maya  Chen ,  Maya.Chen@Example.COM ',
      ].join('\n')
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { firstName: 'Rory', lastName: 'Marchand', email: null },
      { firstName: 'Jean', lastName: 'Paul de la Croix', email: 'jp@example.com' },
      { firstName: 'Cher', lastName: null, email: null },
      { firstName: 'Maya', lastName: 'Chen', email: 'maya.chen@example.com' },
    ]);
  });

  it('bad lines land in errors and never abort the batch; blanks + CRLF skipped', () => {
    const { rows, errors } = parseRosterImport(
      'Good Athlete\r\n\r\n, only-an-email@example.com\r\nBad Email, not-an-email\r\nAnother Good\r\n'
    );
    expect(rows.map(r => r.firstName)).toEqual(['Good', 'Another']);
    expect(errors).toEqual([
      { line: 3, text: ', only-an-email@example.com', reason: 'Missing name' },
      { line: 4, text: 'Bad Email, not-an-email', reason: 'Invalid email' },
    ]);
  });

  it('empty input → empty parse', () => {
    expect(parseRosterImport('')).toEqual({ rows: [], errors: [] });
  });
});

describe('stubs-config', () => {
  it('isStubEmail / makeStubEmail round-trip; disjoint from isSyntheticEmail', () => {
    const email = makeStubEmail('abc-123');
    expect(email).toBe('abc-123@stubs.invalid');
    expect(isStubEmail(email)).toBe(true);
    expect(isStubEmail('ABC@STUBS.INVALID')).toBe(true);
    expect(isStubEmail('kid@minors.invalid')).toBe(false);
    expect(isStubEmail(null)).toBe(false);
    // The invariant: the two synthetic domains never overlap.
    expect(isSyntheticEmail(email)).toBe(false);
  });
});
