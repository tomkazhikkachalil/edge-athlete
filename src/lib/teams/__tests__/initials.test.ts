import { describe, expect, it } from 'vitest';
import { teamInitials } from '../initials';

describe('teamInitials', () => {
  it('two named words → two letters', () => {
    expect(teamInitials('Kanata Rangers')).toBe('KR');
  });
  it('age and tier tokens are skipped', () => {
    expect(teamInitials('U13 Blazers')).toBe('B');
    expect(teamInitials('12U Storm')).toBe('S');
    expect(teamInitials('U15 A Rockets')).toBe('AR');
  });
  it('a name of only tokens still gets letters; empty → ?', () => {
    expect(teamInitials('U13')).toBe('U');
    expect(teamInitials('   ')).toBe('?');
  });
});
