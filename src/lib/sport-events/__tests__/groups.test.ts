import { describe, expect, it } from 'vitest';
import { validateGroupsPlan } from '../groups';

const a = '11111111-1111-4111-8111-111111111111';
const b = '11111111-1111-4111-8111-111111111112';
const c = '11111111-1111-4111-8111-111111111113';
const eligible = new Set([a, b, c]);

describe('validateGroupsPlan', () => {
  it('numbers groups and positions from 1, trims names, normalises tee times', () => {
    const r = validateGroupsPlan({ groups: [{ name: ' Group A ', members: [b, a], tee_time: '2026-10-03T08:10:00Z', starting_hole: 10 }, { members: [c] }] }, eligible);
    expect(r).toEqual({ ok: true, value: [
      { sequence: 1, name: 'Group A', tee_time: '2026-10-03T08:10:00.000Z', starting_hole: 10, members: [{ participant_id: b, position: 1 }, { participant_id: a, position: 2 }] },
      { sequence: 2, name: null, tee_time: null, starting_hole: 1, members: [{ participant_id: c, position: 1 }] },
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
});
