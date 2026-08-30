import { describe, it, expect } from 'vitest';
import { rosterDeleteOutcome } from '../roster-server';

describe('rosterDeleteOutcome', () => {
  it('maps the four (isSelf × status) cases to their outcomes', () => {
    expect(rosterDeleteOutcome({ isSelf: true, status: 'pending' })).toBe('declined');
    expect(rosterDeleteOutcome({ isSelf: true, status: 'active' })).toBe('left');
    expect(rosterDeleteOutcome({ isSelf: false, status: 'pending' })).toBe('cancelled');
    expect(rosterDeleteOutcome({ isSelf: false, status: 'active' })).toBe('removed');
  });
});
