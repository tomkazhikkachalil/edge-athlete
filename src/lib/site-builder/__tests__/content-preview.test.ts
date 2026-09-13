import { describe, expect, it } from 'vitest';
import { parseContact } from '@/lib/org-sites/validate';
import { applyContentPreview } from '../content-preview';
import { contactRenderOrder } from '../display';

// Program 3, H3 — the live content preview and the contact field order.

const site = () => ({
  hero_config: { headline: 'Saved' } as unknown,
  contact_config: { email: 'saved@example.com' } as unknown,
  modules: [{ module_key: 'sponsors', enabled: true, sort_order: 0, config: { sponsors: [{ name: 'Saved Co' }], legacy: 1 } }],
});

describe('applyContentPreview', () => {
  it('no preview → the same site reference; a preview replaces only its own object', () => {
    const s = site();
    expect(applyContentPreview(s, null)).toBe(s);
    const hero = applyContentPreview(s, { key: 'hero', value: { headline: 'Typed' } });
    expect(hero.hero_config).toEqual({ headline: 'Typed' });
    expect(hero.contact_config).toBe(s.contact_config);
    expect(hero.modules).toBe(s.modules);
    const contact = applyContentPreview(s, { key: 'contact', value: { email: 'typed@example.com', order: ['phone', 'email'] } });
    expect(contact.contact_config).toEqual({ email: 'typed@example.com', order: ['phone', 'email'] });
    expect(s.contact_config).toEqual({ email: 'saved@example.com' }); // untouched
  });
  it('sponsors: the module row keeps its other keys; a site without the row gains one', () => {
    const s = site();
    const next = applyContentPreview(s, { key: 'sponsors', value: { sponsors: [{ name: 'Typed Co', tier: 'gold' }] } });
    expect(next.modules[0].config).toEqual({ sponsors: [{ name: 'Typed Co', tier: 'gold' }], legacy: 1 });
    const bare = applyContentPreview({ ...s, modules: [] as typeof s.modules }, { key: 'sponsors', value: { sponsors: [{ name: 'Typed Co' }] } });
    expect(bare.modules).toHaveLength(1);
    expect(bare.modules[0].module_key).toBe('sponsors');
  });
});

describe('the contact field order', () => {
  it('contactRenderOrder: the stored order first (known keys, once), the rest in today\'s order; empty = today', () => {
    expect(contactRenderOrder(undefined)).toEqual(['address', 'hours', 'directions', 'email', 'phone', 'website', 'social']);
    expect(contactRenderOrder(['phone', 'email', 'phone', 'nope'])).toEqual(['phone', 'email', 'address', 'hours', 'directions', 'website', 'social']);
  });
  it('parseContact keeps a valid order and drops strangers; the schema takes the known keys only', () => {
    expect(parseContact({ email: 'a@b.co', order: ['phone', 'bogus', 'email', 'email'] }).order).toEqual(['phone', 'email']);
    expect(parseContact({ email: 'a@b.co', order: 'phone' }).order).toBeUndefined();
    expect(parseContact({ email: 'a@b.co', order: [] }).order).toBeUndefined();
  });
});
