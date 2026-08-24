import { describe, expect, it } from 'vitest';
import { resolveSignupUserType } from '../signup-user-type';

describe('resolveSignupUserType', () => {
  it('guardian actor is a parent, whatever the client requested', () => {
    expect(resolveSignupUserType('guardian', 'athlete')).toBe('parent');
    expect(resolveSignupUserType('guardian', 'league')).toBe('parent');
    expect(resolveSignupUserType('guardian', undefined)).toBe('parent');
  });

  it('self-serve signups can be athlete or fan', () => {
    expect(resolveSignupUserType('athlete', 'athlete')).toBe('athlete');
    expect(resolveSignupUserType('athlete', 'fan')).toBe('fan');
  });

  it('org and privileged types are NOT client-assignable (the closed hole)', () => {
    expect(resolveSignupUserType('athlete', 'league')).toBe('athlete');
    expect(resolveSignupUserType('athlete', 'club')).toBe('athlete');
    expect(resolveSignupUserType('athlete', 'parent')).toBe('athlete');
  });

  it('missing or garbage input defaults to athlete', () => {
    expect(resolveSignupUserType('athlete', undefined)).toBe('athlete');
    expect(resolveSignupUserType('athlete', null)).toBe('athlete');
    expect(resolveSignupUserType('athlete', 42)).toBe('athlete');
    expect(resolveSignupUserType('athlete', 'ATHLETE')).toBe('athlete');
  });
});
