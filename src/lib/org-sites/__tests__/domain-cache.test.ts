import { describe, expect, it } from 'vitest';
import {
  bareHost,
  computeApexDomainRedirect,
  computeCustomHostRewrite,
  isAppHost,
} from '../domain-cache';

describe('domain-cache (pure)', () => {
  it('bareHost + isAppHost', () => {
    expect(bareHost('KMHA.ca:443')).toBe('kmha.ca');
    expect(bareHost(null)).toBeNull();
    expect(isAppHost('edge-athlete.vercel.app', 'edge-athlete.vercel.app')).toBe(true);
    expect(isAppHost('www.edge-athlete.vercel.app', 'edge-athlete.vercel.app')).toBe(true);
    expect(isAppHost('kmha.edge-athlete.vercel.app', 'edge-athlete.vercel.app')).toBe(true);
    expect(isAppHost('preview-abc.vercel.app', 'edge-athlete.vercel.app')).toBe(true);
    expect(isAppHost('localhost', 'edge-athlete.vercel.app')).toBe(true);
    expect(isAppHost('kmha.ca', 'edge-athlete.vercel.app')).toBe(false);
  });

  it('rewrites custom-host paths into the vanity tree', () => {
    expect(computeCustomHostRewrite('/', 'kmha')).toEqual({ kind: 'rewrite', target: '/kmha' });
    expect(computeCustomHostRewrite('/teams/abc', 'kmha')).toEqual({ kind: 'rewrite', target: '/kmha/teams/abc' });
    expect(computeCustomHostRewrite('/.well-known/edge-athlete', 'kmha')).toEqual({ kind: 'well-known' });
    expect(computeCustomHostRewrite('/sitemap.xml', 'kmha')).toEqual({ kind: 'sitemap', target: '/kmha/sitemap.xml' });
    expect(computeCustomHostRewrite('/robots.txt', 'kmha')).toEqual({ kind: 'robots', target: '/kmha/robots.txt' });
  });

  it('301s the apex paths of an active domain, single hop, with carve-outs', () => {
    expect(computeApexDomainRedirect('/kmha', '', 'kmha', 'kmha.ca')).toBe('https://kmha.ca');
    expect(computeApexDomainRedirect('/kmha/teams', '?x=1', 'kmha', 'kmha.ca')).toBe('https://kmha.ca/teams?x=1');
    expect(computeApexDomainRedirect('/org/kmha/standings', '', 'kmha', 'kmha.ca')).toBe('https://kmha.ca/standings');
    expect(computeApexDomainRedirect('/kmha/preview/tok', '', 'kmha', 'kmha.ca')).toBeNull();
    expect(computeApexDomainRedirect('/kmha/card.png', '', 'kmha', 'kmha.ca')).toBeNull();
    expect(computeApexDomainRedirect('/kmha/favicon.svg', '', 'kmha', 'kmha.ca')).toBeNull();
    expect(computeApexDomainRedirect('/kmhax', '', 'kmha', 'kmha.ca')).toBeNull();
    expect(computeApexDomainRedirect('/feed', '', 'kmha', 'kmha.ca')).toBeNull();
  });
});
