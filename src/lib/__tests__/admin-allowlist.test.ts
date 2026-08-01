import { describe, it, expect } from 'vitest';
import { isAdminEmail } from '../auth-server';

// The admin gate is one string comparison, and it guards /api/admin/* —
// user listing, moderation reports, consent reviews, guardian support and the
// storage sweep. It had no test until Aug 2026, which is how a security
// document ends up describing a guarantee nobody checks.
//
// Verified live at the same time (signed-in stranger against production):
// GET /api/admin/users and /api/admin/reports both 403 for a normal account.

describe('isAdminEmail — fail closed', () => {
  it('denies everyone when ADMIN_EMAILS is unset', () => {
    // THE important case. If a deploy loses the env var, the gate must shut,
    // not open. `[].includes(x)` is already false, but that is an accident of
    // implementation — this pins it as the contract.
    expect(isAdminEmail('tom@example.com', undefined)).toBe(false);
  });

  it('denies everyone when ADMIN_EMAILS is empty or whitespace', () => {
    for (const allowlist of ['', '   ', ',', ' , , ', '\t\n']) {
      expect(isAdminEmail('tom@example.com', allowlist), JSON.stringify(allowlist)).toBe(false);
    }
  });

  it('denies a user with no email even when an allowlist exists', () => {
    for (const email of [null, undefined, '']) {
      expect(isAdminEmail(email, 'tom@example.com')).toBe(false);
    }
  });
});

describe('isAdminEmail — matching', () => {
  const LIST = 'tom@example.com, Admin@Example.COM ,ops@example.com';

  it('admits a listed address', () => {
    expect(isAdminEmail('tom@example.com', LIST)).toBe(true);
    expect(isAdminEmail('ops@example.com', LIST)).toBe(true);
  });

  it('ignores case and surrounding whitespace on BOTH sides', () => {
    expect(isAdminEmail('TOM@EXAMPLE.COM', LIST)).toBe(true);
    expect(isAdminEmail('  tom@example.com  ', LIST)).toBe(true);
    expect(isAdminEmail('admin@example.com', LIST)).toBe(true); // listed as Admin@Example.COM
  });

  it('denies an unlisted address', () => {
    expect(isAdminEmail('attacker@example.com', LIST)).toBe(false);
  });

  it('matches whole entries, never substrings', () => {
    // The bug this guards: a naive `allowlist.includes(email)` on the raw
    // string would admit every one of these.
    expect(isAdminEmail('om@example.com', LIST)).toBe(false);
    expect(isAdminEmail('example.com', LIST)).toBe(false);
    expect(isAdminEmail('tom@example.co', LIST)).toBe(false);
    expect(isAdminEmail('tom@example.com.attacker.net', LIST)).toBe(false);
    expect(isAdminEmail('xtom@example.com', LIST)).toBe(false);
  });

  it('handles a single-entry allowlist with no commas', () => {
    expect(isAdminEmail('solo@example.com', 'solo@example.com')).toBe(true);
    expect(isAdminEmail('other@example.com', 'solo@example.com')).toBe(false);
  });
});
