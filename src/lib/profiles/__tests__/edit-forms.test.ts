import { describe, expect, it } from 'vitest';
import type { Profile } from '@/lib/supabase';
import {
  UNSEEDED,
  formsFromProfile,
  justOpened,
  recruitingAcademics,
  seedKeyChanged,
  shouldSeed,
} from '../edit-forms';

// Sep 30 2026: Edit Profile opened blank on production. The forms were
// filled only when the profile prop CHANGED after mount, and every host
// mounts the modal with the profile already loaded. These pin the rule that
// replaced it: fill on open and on a different profile, never on a
// same-profile refresh while open.

const open = (profileId: string | null) => ({ isOpen: true, profileId });
const closed = (profileId: string | null) => ({ isOpen: false, profileId });

describe('shouldSeed', () => {
  it('a modal that MOUNTS open with the profile loaded is filled (the Sep 30 bug)', () => {
    expect(shouldSeed(UNSEEDED, open('p1'))).toBe(true);
    expect(justOpened(UNSEEDED, open('p1'))).toBe(true);
  });
  it('mounting closed fills nothing; the later open does', () => {
    expect(shouldSeed(UNSEEDED, closed('p1'))).toBe(false);
    expect(shouldSeed(closed('p1'), open('p1'))).toBe(true);
    expect(justOpened(closed('p1'), open('p1'))).toBe(true);
  });
  it('a same-profile refresh while open is NOT a reason to refill', () => {
    expect(seedKeyChanged(open('p1'), open('p1'))).toBe(false);
    expect(shouldSeed(open('p1'), open('p1'))).toBe(false);
  });
  it('the profile arriving, or becoming another profile, while open refills', () => {
    expect(shouldSeed(open(null), open('p1'))).toBe(true);
    expect(shouldSeed(open('p1'), open('p2'))).toBe(true);
    expect(justOpened(open('p1'), open('p2'))).toBe(false);
  });
  it('closing never fills, and a reopen always does (Discard really discards)', () => {
    expect(shouldSeed(open('p1'), closed('p1'))).toBe(false);
    expect(seedKeyChanged(open('p1'), closed('p1'))).toBe(true);
    expect(shouldSeed(closed('p1'), open('p1'))).toBe(true);
  });
});

// The row /api/signup writes (route.ts, the profile insert) plus what a
// later edit adds.
const signupRow = {
  id: 'p1',
  email: 'a@example.com',
  user_type: 'athlete',
  created_at: '2026-09-30T00:00:00Z',
  updated_at: '2026-09-30T00:00:00Z',
  first_name: 'Tom',
  last_name: 'Kay',
  full_name: 'Tom Kay',
  handle: 'tomkay',
  birthday: '1990-04-02',
  dob: '1990-04-02',
  location: 'Toronto, ON',
  visibility: 'private',
  nickname: 'TK',
  phone: '416-555-0100',
  gender: 'male',
  postal_code: 'M5V 2T6',
} as Profile;

describe('formsFromProfile', () => {
  it('a signup-shaped row fills what signup collected', () => {
    const f = formsFromProfile(signupRow);
    expect(f.basic).toMatchObject({ first_name: 'Tom', last_name: 'Kay', full_name: 'Tom Kay', handle: 'tomkay', visibility: 'private', avatar_file: null });
    expect(f.vitals).toMatchObject({ dob: '1990-04-02', location: 'Toronto, ON', weight_unit: 'lbs', place: null });
    // …including the four no screen used to show after sign-up.
    expect(f.basic).toMatchObject({ nickname: 'TK', phone: '416-555-0100', gender: 'male', postal_code: 'M5V 2T6' });
  });
  it('a gender outside the column\'s values reads as not set', () => {
    expect(formsFromProfile({ ...signupRow, gender: 'unknown' } as unknown as Profile).basic.gender).toBe('');
  });
  it('an edited row fills every tab', () => {
    const f = formsFromProfile({
      ...signupRow,
      middle_name: 'J',
      bio: 'Golfer.',
      height_cm: 180,
      weight_display: 82,
      weight_unit: 'kg',
      class_year: 2027,
      social_twitter: '@tom',
      social_instagram: 'tom.kay',
      school: 'Northview HS',
      recruiting_status: 'open',
      recruiting_profile: { gpa: 3.8, academic_notes: 'Honours', target_level: 'collegiate' },
    } as Profile);
    expect(f.basic).toMatchObject({ middle_name: 'J', bio: 'Golfer.' });
    expect(f.vitals).toMatchObject({ height_cm: `5'11"`, weight_kg: '82', weight_unit: 'kg', class_year: '2027' });
    expect(f.socials).toMatchObject({ social_twitter: 'tom', social_instagram: 'tom.kay', social_facebook: '', social_tiktok: '' });
    expect(f.recruiting).toEqual({ status: 'open', school: 'Northview HS', gpa: '3.8', academic_notes: 'Honours', target_level: 'collegiate' });
  });
  it('date of birth falls back to `birthday` (org registration writes only that column)', () => {
    expect(formsFromProfile({ ...signupRow, dob: undefined } as Profile).vitals.dob).toBe('1990-04-02');
    expect(formsFromProfile({ ...signupRow, dob: '1991-01-01' } as Profile).vitals.dob).toBe('1991-01-01');
  });
  it('no profile: the empty forms, with the defaults the controls need', () => {
    const f = formsFromProfile(null);
    expect(f.basic).toMatchObject({ first_name: '', last_name: '', handle: '', bio: '', visibility: 'public', nickname: '', phone: '', gender: '', postal_code: '' });
    expect(f.vitals).toMatchObject({ height_cm: '', weight_kg: '', weight_unit: 'lbs', dob: '', class_year: '' });
    expect(f.recruiting).toEqual({ status: 'closed', school: '', gpa: '', academic_notes: '', target_level: '' });
  });
});

describe('recruitingAcademics', () => {
  it('reads the stored academics; anything off-contract is empty', () => {
    expect(recruitingAcademics({ gpa: 3.5, academic_notes: 'AP', target_level: 'club' })).toEqual({ gpa: '3.5', academic_notes: 'AP', target_level: 'club' });
    expect(recruitingAcademics({ gpa: null, academic_notes: null, target_level: 'varsity' })).toEqual({ gpa: '', academic_notes: '', target_level: '' });
    expect(recruitingAcademics(undefined)).toEqual({ gpa: '', academic_notes: '', target_level: '' });
  });
});
