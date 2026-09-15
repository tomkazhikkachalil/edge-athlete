import { describe, expect, it } from 'vitest';
import { derivedSide, validateGroupsPlan } from '../groups';

const a = '11111111-1111-4111-8111-111111111111';
const b = '11111111-1111-4111-8111-111111111112';
const c = '11111111-1111-4111-8111-111111111113';
const eligible = new Set([a, b, c]);

describe('validateGroupsPlan', () => {
  it('numbers groups and positions from 1, trims names, normalises tee times', () => {
    const r = validateGroupsPlan({ groups: [{ name: ' Group A ', members: [b, a], tee_time: '2026-10-03T08:10:00Z', starting_hole: 10 }, { members: [c] }] }, eligible);
    expect(r).toEqual({ ok: true, value: [
      { sequence: 1, name: 'Group A', tee_time: '2026-10-03T08:10:00.000Z', starting_hole: 10, members: [{ participant_id: b, position: 1, side: null }, { participant_id: a, position: 2, side: null }] },
      { sequence: 2, name: null, tee_time: null, starting_hole: 1, members: [{ participant_id: c, position: 1, side: null }] },
    ] });
  });
  it('refuses a player in two groups, a non-eligible member, a bad hole, a bad shape — naming the group', () => {
    expect(validateGroupsPlan({ groups: [{ members: [a] }, { members: [a] }] }, eligible)).toMatchObject({ ok: false, error: 'Group 2: a player is in two groups' });
    expect(validateGroupsPlan({ groups: [{ members: ['11111111-1111-4111-8111-111111111199'] }] }, eligible)).toMatchObject({ ok: false, error: expect.stringContaining('not an accepted') });
    expect(validateGroupsPlan({ groups: [{ members: [a], starting_hole: 19 }] }, eligible)).toMatchObject({ ok: false, error: 'Group 1: starting_hole must be 1–18' });
    expect(validateGroupsPlan({ groups: [{ members: 'a' }] }, eligible)).toMatchObject({ ok: false, error: 'Group 1: members must be a list' });
    expect(validateGroupsPlan({}, eligible)).toMatchObject({ ok: false, error: 'groups must be a list' });
    expect(validateGroupsPlan({ groups: [] }, eligible)).toEqual({ ok: true, value: [] });
  });
  it('phase 3: a side per member on a match format — sent as {participant_id, side} or derived from the position; a stroke event refuses a side by name', () => {
    expect(derivedSide(1, 'singles')).toBe(1);
    expect(derivedSide(2, 'singles')).toBe(2);
    expect(derivedSide(3, 'singles')).toBeNull();
    expect([1, 2, 3, 4, 5].map(p => derivedSide(p, 'fourball'))).toEqual([1, 1, 2, 2, null]);
    const singles = validateGroupsPlan({ groups: [{ members: [a, b, c] }] }, eligible, { sides: 'singles' });
    expect(singles).toMatchObject({ ok: true, value: [{ members: [{ participant_id: a, position: 1, side: 1 }, { participant_id: b, position: 2, side: 2 }, { participant_id: c, position: 3, side: null }] }] });
    const explicit = validateGroupsPlan({ groups: [{ members: [{ participant_id: a, side: 2 }, { participant_id: b, side: 1 }, c] }] }, eligible, { sides: 'fourball' });
    expect(explicit).toMatchObject({ ok: true, value: [{ members: [{ participant_id: a, position: 1, side: 2 }, { participant_id: b, position: 2, side: 1 }, { participant_id: c, position: 3, side: 2 }] }] });
    expect(validateGroupsPlan({ groups: [{ members: [{ participant_id: a, side: 3 }] }] }, eligible, { sides: 'singles' })).toMatchObject({ ok: false, error: 'Group 1: side must be 1 or 2' });
    expect(validateGroupsPlan({ groups: [{ members: [{ participant_id: a, side: 1 }] }] }, eligible)).toMatchObject({ ok: false, error: 'Group 1: side is only set on a match-play event' });
    expect(validateGroupsPlan({ groups: [{ members: [{ participant_id: a }, { participant_id: a, side: 2 }] }] }, eligible, { sides: 'singles' })).toMatchObject({ ok: false, error: 'Group 1: a player is in two groups' });
    expect(validateGroupsPlan({ groups: [{ members: [{ side: 1 }] }] }, eligible, { sides: 'singles' })).toMatchObject({ ok: false, error: 'Group 1: a member must be a participant id' });
  });
});
