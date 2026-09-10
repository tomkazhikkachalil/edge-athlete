import { describe, expect, it } from 'vitest';
import { isScoutAccount } from '../scout-access';

describe('isScoutAccount', () => {
  it('is a claimed, unsupervised scout-typed profile', () => {
    expect(isScoutAccount({ user_type: 'scout', supervision_state: 'self', email: 's@example.com' })).toBe(true);
    expect(isScoutAccount({ user_type: 'scout' })).toBe(true);
  });
  it('refuses every other type, a supervised profile, a stub, and nothing', () => {
    expect(isScoutAccount({ user_type: 'athlete' })).toBe(false);
    expect(isScoutAccount({ user_type: 'organizer' })).toBe(false);
    expect(isScoutAccount({ user_type: 'scout', supervision_state: 'supervised' })).toBe(false);
    expect(isScoutAccount({ user_type: 'scout', email: 'x@stubs.invalid' })).toBe(false);
    expect(isScoutAccount(null)).toBe(false);
  });
});
