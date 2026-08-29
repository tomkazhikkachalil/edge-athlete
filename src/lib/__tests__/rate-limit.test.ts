import { describe, it, expect } from 'vitest';
import {
  RATE_LIMITS,
  buildRateLimitKey,
  clampRetryAfter,
  firstForwardedIp,
  validateRateLimitConfig,
  type RateLimitRule,
} from '../rate-limit-core';

describe('firstForwardedIp', () => {
  it('takes the first hop of a multi-hop header', () => {
    expect(firstForwardedIp('1.2.3.4, 5.6.7.8')).toBe('1.2.3.4');
  });

  it('trims whitespace', () => {
    expect(firstForwardedIp(' 1.2.3.4 ')).toBe('1.2.3.4');
  });

  it('passes a single IP through', () => {
    expect(firstForwardedIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('returns null for absent or empty headers', () => {
    expect(firstForwardedIp(null)).toBeNull();
    expect(firstForwardedIp('')).toBeNull();
    expect(firstForwardedIp(', ,')).toBeNull();
    expect(firstForwardedIp('   ')).toBeNull();
  });
});

describe('buildRateLimitKey', () => {
  it('joins action and identifier', () => {
    expect(buildRateLimitKey('like', 'u123')).toBe('like:u123');
  });

  it('appends extraKey when given', () => {
    expect(buildRateLimitKey('username-login', '1.2.3.4', 'tomk')).toBe(
      'username-login:1.2.3.4:tomk'
    );
  });
});

describe('clampRetryAfter', () => {
  it('floors garbage to 1', () => {
    expect(clampRetryAfter(-5)).toBe(1);
    expect(clampRetryAfter(0)).toBe(1);
    expect(clampRetryAfter(NaN)).toBe(1);
    expect(clampRetryAfter(undefined)).toBe(1);
    expect(clampRetryAfter('nonsense')).toBe(1);
    expect(clampRetryAfter(Infinity)).toBe(1);
  });

  it('caps at one day', () => {
    expect(clampRetryAfter(1e9)).toBe(86400);
  });

  it('passes normal values through, ceiling fractions', () => {
    expect(clampRetryAfter(42)).toBe(42);
    expect(clampRetryAfter(1.2)).toBe(2);
    expect(clampRetryAfter('30')).toBe(30);
  });
});

describe('validateRateLimitConfig', () => {
  it('accepts the live config', () => {
    expect(validateRateLimitConfig(RATE_LIMITS)).toEqual([]);
  });

  it('flags bad rules', () => {
    const bad: Record<string, RateLimitRule> = {
      'colon:action': { max: 5, windowSeconds: 60, keyBy: 'ip' },
      'zero-max': { max: 0, windowSeconds: 60, keyBy: 'ip' },
      'float-window': { max: 5, windowSeconds: 1.5, keyBy: 'user' },
      'bad-keyby': { max: 5, windowSeconds: 60, keyBy: 'nope' as 'ip' },
    };
    const violations = validateRateLimitConfig(bad);
    expect(violations.some(v => v.includes('colon:action'))).toBe(true);
    expect(violations.some(v => v.startsWith('zero-max'))).toBe(true);
    expect(violations.some(v => v.startsWith('float-window'))).toBe(true);
    expect(violations.some(v => v.startsWith('bad-keyby'))).toBe(true);
  });
});

describe('RATE_LIMITS shape guards', () => {
  it('keeps the pooled actions the routes rely on', () => {
    expect(RATE_LIMITS.upload).toBeDefined();
    expect(RATE_LIMITS.like).toBeDefined();
  });

  it('per-IP username-login bucket is looser than the per-username one', () => {
    expect(RATE_LIMITS['username-login-ip'].max).toBeGreaterThan(
      RATE_LIMITS['username-login'].max
    );
    expect(RATE_LIMITS['username-login-ip'].windowSeconds).toBe(
      RATE_LIMITS['username-login'].windowSeconds
    );
  });

  it('guardian day-window buckets are split per route family', () => {
    // Wave 6: athlete-create, block-add and household-apply each get their
    // own budget — one setup evening must never starve athlete creation.
    for (const action of [
      'guardian-athlete-create',
      'guardian-block',
      'guardian-household-apply',
    ] as const) {
      expect(RATE_LIMITS[action].keyBy).toBe('user');
      expect(RATE_LIMITS[action].windowSeconds).toBe(86400);
    }
    // Blocking is a safety action; its budget stays the loosest of the three.
    expect(RATE_LIMITS['guardian-block'].max).toBeGreaterThan(
      RATE_LIMITS['guardian-household-apply'].max
    );
    expect(RATE_LIMITS['guardian-household-apply'].max).toBeGreaterThan(
      RATE_LIMITS['guardian-athlete-create'].max
    );
  });

  it('unauthenticated actions are IP-keyed', () => {
    for (const action of ['contact', 'waitlist', 'signup', 'activate', 'reauth'] as const) {
      expect(RATE_LIMITS[action].keyBy).toBe('ip');
    }
  });
});
