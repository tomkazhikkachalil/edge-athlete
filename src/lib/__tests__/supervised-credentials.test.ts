import { describe, it, expect, vi } from 'vitest';

vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret-key');

import {
  isPinShaped,
  derivePinPassword,
  validateSupervisedHandle,
} from '../supervised-credentials';

describe('isPinShaped', () => {
  it('accepts 4-6 digits only', () => {
    expect(isPinShaped('1234')).toBe(true);
    expect(isPinShaped('123456')).toBe(true);
    expect(isPinShaped('123')).toBe(false);
    expect(isPinShaped('1234567')).toBe(false);
    expect(isPinShaped('12a4')).toBe(false);
    expect(isPinShaped('password')).toBe(false);
  });
});

describe('derivePinPassword', () => {
  it('is deterministic per profile+pin and differs across profiles/pins', () => {
    const a = derivePinPassword('profile-1', '1234');
    expect(derivePinPassword('profile-1', '1234')).toBe(a);
    expect(derivePinPassword('profile-2', '1234')).not.toBe(a);
    expect(derivePinPassword('profile-1', '4321')).not.toBe(a);
  });

  it('never contains the raw pin and meets Supabase minimum length', () => {
    const derived = derivePinPassword('profile-1', '1234');
    expect(derived).not.toContain('1234');
    expect(derived.length).toBeGreaterThanOrEqual(6);
  });
});

describe('validateSupervisedHandle', () => {
  it('blocks full-name handles', () => {
    expect(validateSupervisedHandle('emma.smith', 'Emma', 'Smith', 2015).ok).toBe(false);
    expect(validateSupervisedHandle('emmasmith22', 'Emma', 'Smith', 2015).ok).toBe(false);
  });

  it('blocks name + birth-year combinations', () => {
    expect(validateSupervisedHandle('emma2015', 'Emma', 'Smith', 2015).ok).toBe(false);
    expect(validateSupervisedHandle('smith.15', 'Emma', 'Smith', 2015).ok).toBe(false);
  });

  it('allows safe handles', () => {
    expect(validateSupervisedHandle('speedy.striker', 'Emma', 'Smith', 2015).ok).toBe(true);
    expect(validateSupervisedHandle('em.golfs', 'Emma', 'Smith', 2015).ok).toBe(true);
    expect(validateSupervisedHandle('ace2015', 'Emma', 'Smith', 2015).ok).toBe(true); // year w/o name
  });

  it('tolerates missing dob year', () => {
    expect(validateSupervisedHandle('emma2015', 'Emma', 'Smith', null).ok).toBe(true);
  });
});
