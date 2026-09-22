import { describe, expect, it } from 'vitest';
import { buildPublicHead, type PublicHeadProfile } from '../public-head';

// Round 4: the public profile's <head>. A private profile gives nothing
// away (generic title, noindex); a public one gets name + handle, the
// sport/school line or the bio, a canonical URL, and the avatar as the
// social image only when it is an https URL.

const base: PublicHeadProfile = { id: 'p1', handle: 'edgealpha', display_name: 'Edge Alpha', full_name: null, first_name: 'Edge', last_name: 'Alpha', bio: null, sport: 'ice_hockey', school: 'Northview HS', avatar_url: 'https://cdn.example/a.jpg', visibility: 'public', updated_at: null };

describe('buildPublicHead', () => {
  it('a private or missing profile: generic and noindex', () => {
    expect(buildPublicHead(null)).toMatchObject({ title: 'Athlete · Edge Athlete', robots: { index: false } });
    expect(buildPublicHead({ ...base, visibility: 'private' })).toMatchObject({ robots: { index: false } });
    expect(JSON.stringify(buildPublicHead({ ...base, visibility: 'private' }))).not.toContain('Edge Alpha');
  });
  it('a public profile: name, handle, the sport · school line, canonical, the https avatar', () => {
    const m = buildPublicHead(base);
    expect(m.title).toBe('Edge Alpha (@edgealpha) · Edge Athlete');
    expect(m.description).toBe('Edge Alpha — Ice Hockey · Northview HS on Edge Athlete.');
    expect(m.alternates?.canonical).toMatch(/\/u\/edgealpha$/);
    expect((m.openGraph as { images?: Array<{ url: string }> }).images?.[0].url).toBe('https://cdn.example/a.jpg');
  });
  it('the bio\'s first line wins as the description; a proxied avatar is not a crawler image', () => {
    const m = buildPublicHead({ ...base, bio: 'Left wing, 2027.\nSecond line.', avatar_url: '/api/media/abc' });
    expect(m.description).toBe('Left wing, 2027.');
    expect((m.openGraph as { images?: unknown }).images).toBeUndefined();
  });
  it('falls back through the name fields to the handle', () => {
    expect(buildPublicHead({ ...base, display_name: null, first_name: null, last_name: null }).title).toBe('@edgealpha (@edgealpha) · Edge Athlete');
  });
});
