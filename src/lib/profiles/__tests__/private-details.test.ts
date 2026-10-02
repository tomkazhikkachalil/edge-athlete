import { describe, expect, it } from 'vitest';
import { GENDERS, NICKNAME_MAX, PHONE_MAX, POSTAL_CODE_MAX, cleanPrivateDetails } from '../private-details';

// The sign-up details (nickname, phone, gender, postal code) became editable
// in Edit Profile on Sep 30 2026. PUT /api/profile cleans them with this rule.

describe('cleanPrivateDetails', () => {
  it('names nothing: nothing to write', () => {
    expect(cleanPrivateDetails({ bio: 'x' })).toEqual({ update: {} });
  });
  it('trims; empty and null clear', () => {
    expect(cleanPrivateDetails({ nickname: '  TK ', phone: '', gender: null, postal_code: '   ' })).toEqual({
      update: { nickname: 'TK', phone: null, gender: null, postal_code: null },
    });
  });
  it('gender is one of the column\'s three values, or a refusal by name', () => {
    for (const g of GENDERS) expect(cleanPrivateDetails({ gender: g })).toEqual({ update: { gender: g } });
    expect(cleanPrivateDetails({ gender: 'other' })).toEqual({ update: {}, error: 'Gender must be Female, Male or Custom' });
  });
  it('a value too long to store is refused by name — never truncated', () => {
    expect(cleanPrivateDetails({ nickname: 'n'.repeat(NICKNAME_MAX + 1) }).error).toBe(`Nickname must be ${NICKNAME_MAX} characters or fewer`);
    expect(cleanPrivateDetails({ phone: '1'.repeat(PHONE_MAX + 1) }).error).toBe(`Phone number must be ${PHONE_MAX} characters or fewer`);
    expect(cleanPrivateDetails({ postal_code: 'A'.repeat(POSTAL_CODE_MAX + 1) }).error).toBe(`Postal code must be ${POSTAL_CODE_MAX} characters or fewer`);
    expect(cleanPrivateDetails({ phone: '1'.repeat(PHONE_MAX) }).update.phone).toHaveLength(PHONE_MAX);
  });
  it('a non-string is refused, and a refusal writes NONE of the fields', () => {
    expect(cleanPrivateDetails({ nickname: 'ok', phone: 5551234 })).toEqual({ update: {}, error: 'Phone number is not valid' });
    expect(cleanPrivateDetails({ gender: { a: 1 } })).toEqual({ update: {}, error: 'Gender is not valid' });
  });
});
