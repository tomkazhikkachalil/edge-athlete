import { describe, expect, it } from 'vitest';
import { computeSubdomainRedirect } from '../subdomain';

const APEX = 'edge-athlete.vercel.app';

describe('computeSubdomainRedirect', () => {
  it('passes the app host itself through', () => {
    expect(computeSubdomainRedirect(APEX, APEX, '/', '')).toBeNull();
  });

  it('passes www through', () => {
    expect(computeSubdomainRedirect(`www.${APEX}`, APEX, '/', '')).toBeNull();
  });

  it('301s a valid label at the root without a trailing slash', () => {
    expect(computeSubdomainRedirect(`blazers.${APEX}`, APEX, '/', '')).toBe(
      `https://${APEX}/org/blazers`
    );
  });

  it('preserves nested path and query', () => {
    expect(
      computeSubdomainRedirect(`blazers.${APEX}`, APEX, '/teams', '?x=1')
    ).toBe(`https://${APEX}/org/blazers/teams?x=1`);
  });

  it('case-folds and strips ports', () => {
    expect(
      computeSubdomainRedirect(`BLAZERS.${APEX.toUpperCase()}:443`, APEX, '/', '')
    ).toBe(`https://${APEX}/org/blazers`);
  });

  it('passes multi-label prefixes through', () => {
    expect(computeSubdomainRedirect(`a.b.${APEX}`, APEX, '/', '')).toBeNull();
  });

  it('rejects hyphen-edged and malformed labels', () => {
    expect(computeSubdomainRedirect(`-x.${APEX}`, APEX, '/', '')).toBeNull();
    expect(computeSubdomainRedirect(`x-.${APEX}`, APEX, '/', '')).toBeNull();
  });

  it('accepts 63-char labels, rejects 64', () => {
    const l63 = 'a'.repeat(63);
    const l64 = 'a'.repeat(64);
    expect(computeSubdomainRedirect(`${l63}.${APEX}`, APEX, '/', '')).toBe(
      `https://${APEX}/org/${l63}`
    );
    expect(computeSubdomainRedirect(`${l64}.${APEX}`, APEX, '/', '')).toBeNull();
  });

  it('passes unrelated hosts and null through', () => {
    expect(computeSubdomainRedirect('evil.example.com', APEX, '/', '')).toBeNull();
    expect(computeSubdomainRedirect(null, APEX, '/', '')).toBeNull();
    expect(computeSubdomainRedirect(`sneaky${APEX}`, APEX, '/', '')).toBeNull();
  });

  it('rejects a www label under the apex', () => {
    expect(computeSubdomainRedirect(`www.www.${APEX}`, APEX, '/', '')).toBeNull();
  });
});
