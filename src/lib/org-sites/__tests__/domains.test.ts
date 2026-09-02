import { describe, expect, it } from 'vitest';
import {
  dnsInstructions,
  domainState,
  isReservedDomain,
  isValidCustomDomain,
  normalizeHostname,
  txtRecordsCarryToken,
  verificationRecordName,
} from '../domains';

describe('custom domains (pure)', () => {
  it('normalizes what people paste', () => {
    expect(normalizeHostname(' HTTPS://KMHA.ca/standings?x=1 ')).toBe('kmha.ca');
    expect(normalizeHostname('kmha.ca.')).toBe('kmha.ca');
    expect(normalizeHostname('www.kmha.ca:443')).toBe('www.kmha.ca');
  });

  it('validates hostnames', () => {
    expect(isValidCustomDomain('kmha.ca')).toBe(true);
    expect(isValidCustomDomain('hockey.kmha.on.ca')).toBe(true);
    expect(isValidCustomDomain('kmha')).toBe(false);
    expect(isValidCustomDomain('-bad.ca')).toBe(false);
    expect(isValidCustomDomain('a'.repeat(252) + '.ca')).toBe(false);
  });

  it('reserves our own and platform hosts', () => {
    const app = 'edge-athlete.vercel.app';
    expect(isReservedDomain('edge-athlete.vercel.app', app)).toBe(true);
    expect(isReservedDomain('kmha.edge-athlete.vercel.app', app)).toBe(true);
    expect(isReservedDomain('anything.vercel.app', app)).toBe(true);
    expect(isReservedDomain('x.supabase.co', app)).toBe(true);
    expect(isReservedDomain('localhost', app)).toBe(true);
    expect(isReservedDomain('kmha.ca', app)).toBe(false);
    expect(isReservedDomain('team.edgeathlete.ca', 'edgeathlete.ca')).toBe(true);
  });

  it('walks the lifecycle', () => {
    expect(domainState(null)).toBe('none');
    expect(domainState({ custom_domain: null, domain_verified_at: null })).toBe('none');
    expect(domainState({ custom_domain: 'kmha.ca', domain_verified_at: null })).toBe('pending');
    expect(domainState({ custom_domain: 'kmha.ca', domain_verified_at: 'now' })).toBe('verified');
    expect(
      domainState({ custom_domain: 'kmha.ca', domain_verified_at: 'now', domain_vercel_state: 'pending' })
    ).toBe('attaching');
    expect(
      domainState({ custom_domain: 'kmha.ca', domain_verified_at: 'now', domain_vercel_state: 'attached' })
    ).toBe('attached');
    expect(
      domainState({ custom_domain: 'kmha.ca', domain_verified_at: 'now', domain_vercel_state: 'failed' })
    ).toBe('failed');
    expect(
      domainState({ custom_domain: 'kmha.ca', domain_verified_at: 'now', domain_vercel_state: 'attached', domain_active_at: 'now' })
    ).toBe('active');
  });

  it('prescribes TXT + CNAME (A for an apex) and matches chunked TXT answers', () => {
    expect(verificationRecordName('kmha.ca')).toBe('_edgeathlete.kmha.ca');
    const sub = dnsInstructions('hockey.kmha.ca', 'tok');
    expect(sub.map(i => i.type)).toEqual(['TXT', 'CNAME']);
    expect(sub[1].value).toBe('cname.vercel-dns.com');
    expect(dnsInstructions('kmha.ca', 'tok').map(i => i.type)).toEqual(['TXT', 'A']);
    expect(txtRecordsCarryToken([['abc'], ['to', 'k']], 'tok')).toBe(true);
    expect(txtRecordsCarryToken([['tok2']], 'tok')).toBe(false);
  });
});
