import { describe, expect, it } from 'vitest';
import { siteHead } from '../metadata';

// Program 2, C (Sep 11 2026): ONE head builder — the manager's SEO config
// with the platform defaults as fallbacks; the icon rule token → logo → svg.

const SITE = '11111111-1111-4111-8111-111111111111';
const base = { id: SITE, orgName: 'Riverside Golf Club', subdomain: 'riverside', theme_token_set: {}, seo_config: {} };

describe('siteHead', () => {
  it('defaults: the org name, the platform description, card.png, the generated favicon', () => {
    const h = siteHead(base);
    expect(h.title).toBe('Riverside Golf Club');
    expect(h.description).toBe('Riverside Golf Club on Edge Athlete — schedule, standings, and teams.');
    expect(h.canonical).toMatch(/\/org\/riverside$/);
    expect(h.image).toMatch(/\/org\/riverside\/card\.png$/);
    expect(h.icon).toBe('/org/riverside/favicon.svg');
  });
  it('the SEO config wins: title, description, an uploaded social image through the streamer; a foreign image path is ignored', () => {
    const h = siteHead({ ...base, seo_config: { title: 'Riverside GC — golf on the river', description: 'Weekly league, open to all.', imagePath: `org-media/${SITE}/social.jpg` } });
    expect(h.title).toBe('Riverside GC — golf on the river');
    expect(h.description).toBe('Weekly league, open to all.');
    expect(h.image).toBe(`/api/media/org-media/${SITE}/social.jpg`);
    const foreign = siteHead({ ...base, seo_config: { imagePath: 'org-media/22222222-2222-4222-8222-222222222222/x.jpg' } });
    expect(foreign.image).toMatch(/card\.png$/);
  });
  it('a page heads with its title over the SEO title, its own description or the platform line, its own canonical, the site image', () => {
    const h = siteHead({ ...base, seo_config: { title: 'Riverside GC', imagePath: `org-media/${SITE}/social.jpg` } }, { title: 'About us', slug: 'about-us' });
    expect(h.title).toBe('About us — Riverside GC');
    expect(h.description).toBe('About us — Riverside Golf Club on Edge Athlete.');
    expect(h.canonical).toMatch(/\/org\/riverside\/about-us$/);
    expect(h.image).toBe(`/api/media/org-media/${SITE}/social.jpg`);
    expect(siteHead(base, { title: 'Rules', slug: 'rules', description: 'House rules.' }).description).toBe('House rules.');
  });
  it('the icon: the chosen token, else the uploaded logo, else the generated favicon', () => {
    expect(siteHead({ ...base, theme_token_set: { iconPath: `org-media/${SITE}/icon.png` }, logo_path: `org-logos/${SITE}/logo.png` }).icon).toBe(`/api/media/org-media/${SITE}/icon.png`);
    expect(siteHead({ ...base, logo_path: `org-logos/${SITE}/logo.png` }).icon).toContain('/api/media/');
    expect(siteHead({ ...base, theme_token_set: { iconPath: 'org-media/22222222-2222-4222-8222-222222222222/x.png' } }).icon).toBe('/org/riverside/favicon.svg');
  });
});
