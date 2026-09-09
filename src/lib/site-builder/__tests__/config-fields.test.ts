import { describe, expect, it } from 'vitest';
import { WEB_WIDGET_KEYS } from '../catalog';
import { contentConfigFor, effectiveConfig, instanceTitle } from '../config';
import { CONTACT_FIELDS, HERO_FIELDS, contentActionFor, fieldsFor } from '../fields';
import { ContactConfigSchema, HeroConfigSchema, InstanceOptionsSchema } from '../schemas';
import type { WidgetInstance } from '../layout';

const w = (key: WidgetInstance['key'], config: unknown = {}): WidgetInstance => ({ id: key, key, x: 0, y: 0, w: 12, h: 2, cv: 1, config, visibility: 'public' });
const site = {
  hero_config: { headline: 'Fresh' },
  contact_config: { email: 'club@example.com' },
  modules: [{ module_key: 'sponsors', config: { sponsors: [{ name: 'Acme' }] } }],
};

describe('effective config (phase 5)', () => {
  it('content comes from the org objects; instance options ride under it; a stale copy never wins', () => {
    expect(contentConfigFor(site, 'hero')).toEqual({ headline: 'Fresh' });
    expect(contentConfigFor(site, 'contact')).toEqual({ email: 'club@example.com' });
    expect(contentConfigFor(site, 'sponsors')).toEqual({ sponsors: [{ name: 'Acme' }] });
    expect(contentConfigFor(site, 'teams')).toEqual({});
    expect(effectiveConfig(site, w('hero', { headline: 'Stale', title: 'Welcome' }))).toEqual({ headline: 'Fresh', title: 'Welcome' });
    expect(effectiveConfig(site, w('teams', { title: 'Squads' }))).toEqual({ title: 'Squads' });
  });
  it('instanceTitle trims, caps and ignores blanks', () => {
    expect(instanceTitle(w('teams', { title: '  Squads ' }))).toBe('Squads');
    expect(instanceTitle(w('teams', { title: '   ' }))).toBeNull();
    expect(instanceTitle(w('teams'))).toBeNull();
    expect(instanceTitle(w('teams', { title: 'x'.repeat(80) }))!.length).toBe(60);
  });
});

describe('field descriptors are pinned to the schemas', () => {
  it('every content field names a key of its widget’s zod schema; instance fields fit the options schema', () => {
    const heroKeys = Object.keys(HeroConfigSchema.shape);
    for (const f of HERO_FIELDS) expect(heroKeys, f.name).toContain(f.name);
    const contactKeys = Object.keys(ContactConfigSchema.shape);
    for (const f of CONTACT_FIELDS) expect(contactKeys, f.name).toContain(f.name);
    for (const key of WEB_WIDGET_KEYS) {
      for (const f of fieldsFor(key)) {
        if (f.scope === 'instance' && f.kind !== 'visibility') expect(Object.keys(InstanceOptionsSchema.shape)).toContain(f.name);
        if (f.scope === 'content') expect(contentActionFor(key), `${key}.${f.name} needs a content action`).not.toBeNull();
      }
    }
    expect(InstanceOptionsSchema.safeParse({ title: 'x'.repeat(61) }).success).toBe(false);
    expect(InstanceOptionsSchema.safeParse({ title: 'Squads', legacyKey: 1 }).success).toBe(true);
  });
  it('hero has content fields only; every other widget has the title and visibility options', () => {
    expect(fieldsFor('hero').every(f => f.scope === 'content')).toBe(true);
    for (const key of WEB_WIDGET_KEYS.filter(k => k !== 'hero')) {
      const names = fieldsFor(key).map(f => f.name);
      expect(names.slice(0, 2)).toEqual(['title', 'visibility']);
    }
    expect(contentActionFor('contact')).toBe('set_contact');
    expect(contentActionFor('teams')).toBeNull();
  });
});
