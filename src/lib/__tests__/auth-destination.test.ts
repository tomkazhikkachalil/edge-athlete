import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { destinationFor, stampsOnboardingOnConfirm, COMPLETE_PROFILE_PATH } from '../auth-destination';

describe('where a freshly signed-in account goes (Nov 2 2026)', () => {
  it('no profile row → complete-profile', () => {
    expect(destinationFor(null)).toBe(COMPLETE_PROFILE_PATH);
    expect(destinationFor(undefined)).toBe('/auth/complete-profile');
  });
  it('every account type, before and after onboarding', () => {
    const at = '2026-11-02T00:00:00Z';
    expect(destinationFor({ user_type: 'parent', onboarded_at: null })).toBe('/app/guardian/add-athlete');
    expect(destinationFor({ user_type: 'parent', onboarded_at: at })).toBe('/app/guardian');
    expect(destinationFor({ user_type: 'organizer', onboarded_at: null })).toBe('/club/start');
    expect(destinationFor({ user_type: 'organizer', onboarded_at: at })).toBe('/feed');
    expect(destinationFor({ user_type: 'scout', onboarded_at: null })).toBe('/app/scout');
    expect(destinationFor({ user_type: 'scout', onboarded_at: at })).toBe('/app/scout');
    expect(destinationFor({ user_type: 'athlete', onboarded_at: null })).toBe('/onboarding');
    expect(destinationFor({ user_type: 'athlete', onboarded_at: at })).toBe('/athlete');
    expect(destinationFor({ user_type: null, onboarded_at: null })).toBe('/onboarding');
  });
  it('the confirmation route stamps onboarding only for the types whose wizard is the sign-up', () => {
    expect(stampsOnboardingOnConfirm('scout')).toBe(true);
    expect(stampsOnboardingOnConfirm('organizer')).toBe(true);
    expect(stampsOnboardingOnConfirm('athlete')).toBe(false);
    expect(stampsOnboardingOnConfirm('parent')).toBe(false);
    expect(stampsOnboardingOnConfirm(null)).toBe(false);
  });
  it('the rule imports nothing; the OAuth callback and the confirmation link both use it', () => {
    const rule = fs.readFileSync(path.join(process.cwd(), 'src/lib/auth-destination.ts'), 'utf8');
    expect(rule).not.toMatch(/^import /m);
    for (const rel of ['src/app/(app)/auth/callback/route.ts', 'src/app/(app)/auth/confirm/route.ts']) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      expect(src, rel).toContain("from '@/lib/auth-destination'");
      expect(src, rel).toContain('destinationFor(');
    }
    const confirm = fs.readFileSync(path.join(process.cwd(), 'src/app/(app)/auth/confirm/route.ts'), 'utf8');
    expect(confirm).toContain('supabase.auth.verifyOtp({ token_hash');
    const signup = fs.readFileSync(path.join(process.cwd(), 'src/app/api/signup/route.ts'), 'utf8');
    expect(signup).toContain('confirmationRequired: !data.session');
    expect(signup).toContain("emailRedirectTo: `${appUrl}/auth/confirm`");
  });
});
