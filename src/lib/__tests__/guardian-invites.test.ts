import { describe, it, expect } from 'vitest';
import {
  generateInviteToken,
  hashInviteToken,
  normalizeInviteEmail,
} from '../guardian-invites';
import { jurisdictionFromHeaders } from '../config/minors-config';

describe('generateInviteToken', () => {
  it('produces url-safe tokens of sufficient entropy', () => {
    const t = generateInviteToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet, no padding
    expect(t.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it('never repeats (sanity)', () => {
    const seen = new Set(Array.from({ length: 50 }, generateInviteToken));
    expect(seen.size).toBe(50);
  });
});

describe('hashInviteToken', () => {
  it('is deterministic and irreversible-shaped (sha256 hex)', () => {
    const t = 'fixed-token';
    expect(hashInviteToken(t)).toBe(hashInviteToken(t));
    expect(hashInviteToken(t)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashInviteToken(t)).not.toContain(t);
  });

  it('differs for different tokens', () => {
    expect(hashInviteToken('a')).not.toBe(hashInviteToken('b'));
  });
});

describe('normalizeInviteEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeInviteEmail('  Parent@GMAIL.com ')).toBe('parent@gmail.com');
  });
});

describe('jurisdictionFromHeaders', () => {
  it('maps Quebec to CA-QC', () => {
    expect(jurisdictionFromHeaders('CA', 'QC')).toBe('CA-QC');
    expect(jurisdictionFromHeaders('ca', 'qc')).toBe('CA-QC');
  });

  it('other Canadian regions stay CA', () => {
    expect(jurisdictionFromHeaders('CA', 'ON')).toBe('CA');
  });

  it('plain countries pass through uppercased', () => {
    expect(jurisdictionFromHeaders('us', null)).toBe('US');
    expect(jurisdictionFromHeaders('DE', undefined)).toBe('DE');
  });

  it('missing country falls back to DEFAULT', () => {
    expect(jurisdictionFromHeaders(null, null)).toBe('DEFAULT');
  });
});
