import { describe, expect, it } from 'vitest';
import { resolveSignupActorRole, resolveSignupUserType } from '../signup-user-type';

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
    expect(resolveSignupUserType('athlete', 'organizer')).toBe('athlete');
  });

  it('organizer actor is an organizer, whatever the client requested (mig 178)', () => {
    expect(resolveSignupUserType('organizer', 'athlete')).toBe('organizer');
    expect(resolveSignupUserType('organizer', 'league')).toBe('organizer');
    expect(resolveSignupUserType('organizer', undefined)).toBe('organizer');
  });

  it('actorRole resolves to exactly three values; garbage is an athlete', () => {
    expect(resolveSignupActorRole('guardian')).toBe('guardian');
    expect(resolveSignupActorRole('organizer')).toBe('organizer');
    expect(resolveSignupActorRole('athlete')).toBe('athlete');
    expect(resolveSignupActorRole('admin')).toBe('athlete');
    expect(resolveSignupActorRole(undefined)).toBe('athlete');
    expect(resolveSignupActorRole(1)).toBe('athlete');
  });

  it('missing or garbage input defaults to athlete', () => {
    expect(resolveSignupUserType('athlete', undefined)).toBe('athlete');
    expect(resolveSignupUserType('athlete', null)).toBe('athlete');
    expect(resolveSignupUserType('athlete', 42)).toBe('athlete');
    expect(resolveSignupUserType('athlete', 'ATHLETE')).toBe('athlete');
  });
});
