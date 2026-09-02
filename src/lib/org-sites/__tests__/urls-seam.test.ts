import { describe, expect, it } from 'vitest';
import { siteAbsoluteUrl, siteBasePath, siteDomainActive } from '../urls';

describe('siteBasePath / siteAbsoluteUrl (C2 seam)', () => {
  it('falls back to the canonical org path without an active domain', () => {
    expect(siteDomainActive({ subdomain: 'kmha' })).toBe(false);
    expect(siteDomainActive({ subdomain: 'kmha', custom_domain: 'kmha.ca', domain_active_at: null })).toBe(false);
    expect(siteBasePath({ subdomain: 'kmha', custom_domain: 'kmha.ca' })).toMatch(/\/kmha$/);
    expect(siteAbsoluteUrl({ subdomain: 'kmha' })).toMatch(/^https?:\/\/.+\/kmha$/);
  });

  it('goes host-relative + absolute-on-the-domain once active', () => {
    const site = { subdomain: 'kmha', custom_domain: 'kmha.ca', domain_active_at: '2026-09-01T00:00:00Z' };
    expect(siteDomainActive(site)).toBe(true);
    expect(siteBasePath(site)).toBe('');
    expect(siteAbsoluteUrl(site)).toBe('https://kmha.ca');
  });
});
