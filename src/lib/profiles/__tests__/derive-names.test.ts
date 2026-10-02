import { describe, expect, it } from 'vitest';
import { deriveNameColumns, derivedNameUpdate, mirrorDob, touchesNames } from '../derive-names';

// Sep 30 2026: a name edit never reached full_name / display_name — the
// modal sent the loaded full_name back and the trigger only fills an empty
// one. PUT /api/profile now derives both, with signup's rule.

describe('deriveNameColumns — signup\'s rule', () => {
  it('full name is first + last; the display name is the nickname, else the full name, else the handle', () => {
    expect(deriveNameColumns({ first_name: 'Tom', last_name: 'Kay' })).toEqual({ full_name: 'Tom Kay', display_name: 'Tom Kay' });
    expect(deriveNameColumns({ first_name: 'Tom', last_name: 'Kay', nickname: 'TK' })).toEqual({ full_name: 'Tom Kay', display_name: 'TK' });
    expect(deriveNameColumns({ first_name: null, last_name: null, handle: 'tomkay' })).toEqual({ full_name: null, display_name: 'tomkay' });
  });
  it('trims, and one part alone is the full name', () => {
    expect(deriveNameColumns({ first_name: '  Tom ', last_name: '' })).toEqual({ full_name: 'Tom', display_name: 'Tom' });
    expect(deriveNameColumns({ first_name: 'Tom', last_name: 'Kay', nickname: '   ' }).display_name).toBe('Tom Kay');
  });
  it('nothing at all: both null (the caller never writes an empty display name)', () => {
    expect(deriveNameColumns({})).toEqual({ full_name: null, display_name: null });
  });
});

describe('derivedNameUpdate — a partial update over the stored row', () => {
  const stored = { first_name: 'Tom', last_name: 'Kay', nickname: null, handle: 'tomkay', full_name: 'Tom Kay', display_name: 'Tom Kay' };

  it('a payload with no name part writes nothing derived', () => {
    expect(touchesNames({ bio: 'x' })).toBe(false);
    expect(derivedNameUpdate({ bio: 'x', full_name: 'Stale Name' }, stored)).toEqual({});
  });
  it('a first-name edit alone re-derives from the STORED last name (the Sep 30 bug)', () => {
    expect(derivedNameUpdate({ first_name: 'Thomas' }, stored)).toEqual({ full_name: 'Thomas Kay', display_name: 'Thomas Kay' });
  });
  it('the modal\'s payload: both parts', () => {
    expect(derivedNameUpdate({ first_name: 'Thomas', middle_name: 'J', last_name: 'Kazh' }, stored)).toEqual({ full_name: 'Thomas Kazh', display_name: 'Thomas Kazh' });
  });
  it('a stored nickname keeps leading the display name; clearing it hands the lead back', () => {
    const nick = { ...stored, nickname: 'TK', display_name: 'TK' };
    expect(derivedNameUpdate({ first_name: 'Thomas' }, nick)).toEqual({ full_name: 'Thomas Kay', display_name: 'TK' });
    expect(derivedNameUpdate({ nickname: null }, nick)).toEqual({ full_name: 'Tom Kay', display_name: 'Tom Kay' });
    expect(derivedNameUpdate({ nickname: 'Tommy' }, stored)).toEqual({ full_name: 'Tom Kay', display_name: 'Tommy' });
  });
  it('emptying both parts never writes an empty derived value; the handle still shows', () => {
    expect(derivedNameUpdate({ first_name: null, last_name: null }, stored)).toEqual({ display_name: 'tomkay' });
    expect(derivedNameUpdate({ first_name: '', last_name: '' }, { handle: null })).toEqual({});
  });
  it('no stored row (the read failed): derives from the payload alone', () => {
    expect(derivedNameUpdate({ first_name: 'A', last_name: 'B' }, null)).toEqual({ full_name: 'A B', display_name: 'A B' });
  });
});

describe('mirrorDob', () => {
  it('a dob in the payload is written to birthday too', () => {
    expect(mirrorDob({ dob: '1990-04-02' })).toEqual({ birthday: '1990-04-02' });
  });
  it('clearing clears both', () => {
    expect(mirrorDob({ dob: null })).toEqual({ birthday: null });
    expect(mirrorDob({ dob: '' })).toEqual({ birthday: null });
  });
  it('no dob in the payload (never sent, or stripped for a supervised / locked profile): nothing', () => {
    expect(mirrorDob({ bio: 'x' })).toEqual({});
  });
});
