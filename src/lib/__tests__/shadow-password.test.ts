import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SHADOW_PASSWORD_SUFFIX, hasEveryPasswordClass, shadowPassword } from '../auth/shadow-password';

// Nov 7 2026: production's Auth enforces the strongest Supabase password
// policy; the shadow users the app mints (roster stubs, supervised minors, a
// transferred athlete's rotated credentials) carried a bare base64url string
// that missed a symbol one time in four — `422 Password should contain at
// least one character of each…` on the roster import's production probe.

describe('shadowPassword', () => {
  it('has every class, every time', () => {
    for (let i = 0; i < 2_000; i += 1) expect(hasEveryPasswordClass(shadowPassword())).toBe(true);
  });
  it('is 256 random bits plus the suffix, and never repeats', () => {
    const a = shadowPassword();
    const b = shadowPassword();
    expect(a).toHaveLength(43 + SHADOW_PASSWORD_SUFFIX.length);
    expect(a.endsWith(SHADOW_PASSWORD_SUFFIX)).toBe(true);
    expect(a).not.toBe(b);
    expect(hasEveryPasswordClass(SHADOW_PASSWORD_SUFFIX)).toBe(true);
  });
  it('the rule names the four classes', () => {
    expect(hasEveryPasswordClass('abcDEF123')).toBe(false); // no symbol — the base64url failure shape
    expect(hasEveryPasswordClass('abc-def-123')).toBe(false); // no upper
    expect(hasEveryPasswordClass('ABC_DEF_123')).toBe(false); // no lower
    expect(hasEveryPasswordClass('abcDEF_-')).toBe(false); // no digit
    expect(hasEveryPasswordClass('aB3_')).toBe(true);
    expect(hasEveryPasswordClass('')).toBe(false);
  });
});

describe('every account the code mints or rotates uses it', () => {
  const files = [
    'src/lib/orgs/roster-import.ts',
    'src/app/api/guardian/athletes/route.ts',
    'src/lib/transfers.ts',
    'e2e/helpers/qa-user.ts',
    'e2e/teardown.spec.ts',
    'e2e/athlete-claim.spec.ts',
  ];
  for (const f of files) {
    it(f, () => {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      expect(src).toContain('shadowPassword()');
      expect(src).not.toMatch(/password: randomBytes\(/);
    });
  }
  it('no other createUser / password rotation in src hands Auth a raw random string', () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return d.name === 'node_modules' || d.name === '__tests__' ? [] : walk(p);
      return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
    });
    const offenders = walk(path.join(process.cwd(), 'src')).filter(p => /password:\s*randomBytes\(/.test(fs.readFileSync(p, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
