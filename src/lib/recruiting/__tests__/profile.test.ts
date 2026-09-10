import { describe, expect, it } from 'vitest';
import { formatGpa, gradYearLabel, isRecruitable, parseRecruitingStatus } from '../profile';
import { RecruitingPatchSchema, parseRecruitingProfile, recruitingPatchToUpdate } from '../schema';

describe('isRecruitable — the one predicate', () => {
  const base = { email: 'a@example.com', visibility: 'public', recruiting_status: 'open' };
  it('is true for a claimed public profile that is open or committed', () => {
    expect(isRecruitable(base)).toBe(true);
    expect(isRecruitable({ ...base, recruiting_status: 'committed' })).toBe(true);
  });
  it('is false when closed, private, unclaimed, or the status is junk', () => {
    expect(isRecruitable({ ...base, recruiting_status: 'closed' })).toBe(false);
    expect(isRecruitable({ ...base, recruiting_status: null })).toBe(false);
    expect(isRecruitable({ ...base, recruiting_status: 'nope' })).toBe(false);
    expect(isRecruitable({ ...base, visibility: 'private' })).toBe(false);
    expect(isRecruitable({ ...base, email: 'x@stubs.invalid' })).toBe(false);
  });
  it('does not consult supervision (a guardian-opened supervised athlete is recruitable)', () => {
    expect(isRecruitable({ ...base, supervision_state: 'supervised' } as never)).toBe(true);
  });
});

describe('parseRecruitingProfile', () => {
  it('drops unknown keys, rounds the GPA, and empties bad input', () => {
    expect(parseRecruitingProfile({ gpa: 3.856, academic_notes: ' honours ', target_level: 'collegiate', sat: 1500 }))
      .toEqual({ gpa: 3.86, academic_notes: 'honours', target_level: 'collegiate' });
    expect(parseRecruitingProfile(null)).toEqual({ gpa: null, academic_notes: null, target_level: null });
    expect(parseRecruitingProfile({ gpa: 9 })).toEqual({ gpa: null, academic_notes: null, target_level: null });
    expect(parseRecruitingProfile({ academic_notes: '' })).toEqual({ gpa: null, academic_notes: null, target_level: null });
  });
});

describe('the PATCH contract', () => {
  it('refuses unknown top-level keys and out-of-range values', () => {
    expect(RecruitingPatchSchema.safeParse({ status: 'open', email: 'x' }).success).toBe(false);
    expect(RecruitingPatchSchema.safeParse({ status: 'maybe' }).success).toBe(false);
    expect(RecruitingPatchSchema.safeParse({ profile: { gpa: 5.5 } }).success).toBe(false);
    expect(RecruitingPatchSchema.safeParse({ school: 'x'.repeat(121) }).success).toBe(false);
  });
  it('writes only the keys sent, merging the profile over the stored one', () => {
    const current = { gpa: 3.5, academic_notes: 'ok', target_level: null };
    expect(recruitingPatchToUpdate({ status: 'open' }, current)).toEqual({ recruiting_status: 'open' });
    expect(recruitingPatchToUpdate({ school: '' }, current)).toEqual({ school: null });
    expect(recruitingPatchToUpdate({ profile: { target_level: 'club' } }, current))
      .toEqual({ recruiting_profile: { gpa: 3.5, academic_notes: 'ok', target_level: 'club' } });
  });
});

describe('labels', () => {
  it('formats the grad year and the GPA', () => {
    expect(gradYearLabel(2027)).toBe('Class of 2027');
    expect(gradYearLabel(null)).toBeNull();
    expect(formatGpa(3.8)).toBe('3.80');
    expect(formatGpa(undefined)).toBeNull();
    expect(parseRecruitingStatus(undefined)).toBe('closed');
  });
});
