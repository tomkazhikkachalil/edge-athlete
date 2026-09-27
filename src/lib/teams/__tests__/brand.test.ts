import { describe, expect, it } from 'vitest';
import { teamLook } from '../brand';
import { contrastRatio, APP_SURFACE_DARK, APP_SURFACE_LIGHT } from '@/lib/org-sites/accent-contrast';

const TEAM = '11111111-1111-4111-8111-111111111111';
const org = {
  siteId: 's', subdomain: 'x', published: true,
  logoUrl: '/api/media/org-logo/s?v=a.png',
  hero: { imageUrl: null, imageAlt: '', headline: '', tagline: '' },
  accent: { fill: '#0ea5e9', fillStrong: '#0369a1', fgLight: '#0369a1', fgDark: '#0ea5e9' },
};

describe('teamLook', () => {
  it("the team's colours win, each text colour readable on its surface", () => {
    const look = teamLook({ id: TEAM, primary_color: '#fde047', secondary_color: '#facc15' }, org);
    expect(look.source).toBe('team');
    expect(look.accent!.fill).toBe('#fde047');
    expect(contrastRatio(look.accent!.fgLight, APP_SURFACE_LIGHT)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(look.accent!.fgDark, APP_SURFACE_DARK)).toBeGreaterThanOrEqual(4.5);
  });
  it("no team colours → the club's accent; no club accent → the app palette", () => {
    expect(teamLook({ id: TEAM }, org)).toMatchObject({ source: 'org', accent: org.accent });
    expect(teamLook({ id: TEAM }, { ...org, accent: null })).toMatchObject({ source: null, accent: null });
    expect(teamLook({ id: TEAM }, null)).toMatchObject({ source: null, accent: null, logoUrl: null });
  });
  it("the team's logo wins; else the club's; a path outside team-logos/{id}/ is no logo", () => {
    expect(teamLook({ id: TEAM, logo_path: `team-logos/${TEAM}/1.png` }, org).logoUrl).toBe(`/api/media/team-logo/${TEAM}?v=1.png`);
    expect(teamLook({ id: TEAM }, org).logoUrl).toBe(org.logoUrl);
    expect(teamLook({ id: TEAM, logo_path: 'org-logos/other/1.png' }, null).logoUrl).toBeNull();
  });
  it('one colour alone deepens itself for the strong end; junk colours are ignored', () => {
    const look = teamLook({ id: TEAM, primary_color: '#7c3aed' }, null);
    expect(look.accent!.fillStrong).not.toBe('#7c3aed');
    expect(teamLook({ id: TEAM, primary_color: 'red' }, org).source).toBe('org');
  });
});
