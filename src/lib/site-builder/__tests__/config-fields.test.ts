import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTENT_WIDGET_KEYS, SITE_WIDGET_KEYS } from '../catalog';
import { contentConfigFor, effectiveConfig, instanceQuery, instanceTitle } from '../config';
import { CONTACT_FIELDS, HERO_FIELDS, contentActionFor, fieldsFor } from '../fields';
import { ContactConfigSchema, HeroConfigSchema, InstanceOptionsSchema, QuerySchema, instanceSchemaFor } from '../schemas';
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
    // P10-C parity: a nested name ('social.instagram') names a key one level down.
    const contactKeys = Object.keys(ContactConfigSchema.shape);
    for (const f of CONTACT_FIELDS) expect(contactKeys, f.name).toContain(f.name.split('.')[0]);
    expect(HERO_FIELDS.map(f => f.name)).toEqual(expect.arrayContaining(['imagePath', 'imageAlt']));
    expect(CONTACT_FIELDS.map(f => f.name)).toEqual(expect.arrayContaining(['address', 'social.instagram', 'social.facebook', 'social.x', 'social.youtube']));
    for (const key of SITE_WIDGET_KEYS) {
      // Phase 6: a content widget's instance fields fit ITS instance schema
      // (options + content); a module widget's fit the options schema.
      const shape = Object.keys((instanceSchemaFor(key) as z.ZodObject).shape);
      for (const f of fieldsFor(key)) {
        // 'size' (Sep 11 2026) is a preset over the instance's `w`, not a config key.
        if (f.scope === 'instance' && f.kind !== 'visibility' && f.kind !== 'size') expect(shape, `${key}.${f.name}`).toContain(f.name);
        if (f.scope === 'content') expect(contentActionFor(key), `${key}.${f.name} needs a content action`).not.toBeNull();
      }
    }
    // Phase 9: query fields name keys of QuerySchema and only the query widgets
    // get pickers; every list has a source and every number sane bounds.
    for (const key of SITE_WIDGET_KEYS) {
      for (const f of fieldsFor(key)) {
        if (f.scope !== 'query') continue;
        expect(Object.keys(QuerySchema.shape), `${key}.${f.name}`).toContain(f.name);
        if (f.kind === 'select') expect(['competitions', 'venues']).toContain(f.source);
        if (f.kind === 'number') {
          expect(f.min).toBeLessThan(f.max);
          expect(f.placeholder).toBeGreaterThanOrEqual(f.min);
          expect(f.placeholder).toBeLessThanOrEqual(f.max);
        }
      }
    }
    expect(fieldsFor('standings').filter(f => f.scope === 'query').map(f => f.name)).toEqual(['competitionId']);
    expect(fieldsFor('schedule').filter(f => f.scope === 'query').map(f => f.name)).toEqual(['venueId', 'competitionId', 'limit']);
    expect(fieldsFor('leaders').filter(f => f.scope === 'query').map(f => f.name)).toEqual(['competitionId']);
    for (const key of ['news', 'teams', 'members'] as const) expect(fieldsFor(key).filter(f => f.scope === 'query').map(f => f.name)).toEqual(['limit']);
    for (const key of ['staff', 'venues', 'contact', 'text'] as const) expect(fieldsFor(key).some(f => f.scope === 'query')).toBe(false);
    for (const key of CONTENT_WIDGET_KEYS) {
      const kinds = fieldsFor(key).map(f => f.kind);
      // Program 2, D: a form widget's own field is its intro (a textarea).
      expect(kinds, key).toContain(key === 'text' ? 'blocks' : key === 'contact_form' || key === 'interest_form' ? 'textarea' : key);
      expect(fieldsFor(key).every(f => f.scope === 'instance'), `${key} is all instance`).toBe(true);
      expect(contentActionFor(key)).toBeNull();
    }
    expect(InstanceOptionsSchema.safeParse({ title: 'x'.repeat(61) }).success).toBe(false);
    expect(InstanceOptionsSchema.safeParse({ title: 'Squads', legacyKey: 1 }).success).toBe(true);
  });
  it('phase 9: the query rides the instance options — uuids, a bounded limit, loose for future keys', () => {
    const uuid = '0f1e2d3c-4b5a-4978-8f6e-5d4c3b2a1908';
    expect(InstanceOptionsSchema.safeParse({ query: { competitionId: uuid, limit: 5 } }).success).toBe(true);
    expect(InstanceOptionsSchema.safeParse({ query: { venueId: uuid } }).success).toBe(true);
    expect(InstanceOptionsSchema.safeParse({ query: { limit: 0 } }).success).toBe(false);
    expect(InstanceOptionsSchema.safeParse({ query: { limit: 51 } }).success).toBe(false);
    expect(InstanceOptionsSchema.safeParse({ query: { competitionId: 'nope' } }).success).toBe(false);
    expect(InstanceOptionsSchema.safeParse({ query: { teamId: uuid } }).success).toBe(true);
    for (const key of ['standings', 'schedule', 'leaders', 'text'] as const) {
      expect(Object.keys((instanceSchemaFor(key) as z.ZodObject).shape)).toContain('query');
    }
    expect(instanceQuery({ id: 'a', key: 'standings', x: 0, y: 0, w: 6, h: 4, cv: 1, config: { query: { competitionId: uuid, limit: 3, venueId: '' } }, visibility: 'public' })).toEqual({ competitionId: uuid, limit: 3 });
    expect(instanceQuery({ id: 'a', key: 'standings', x: 0, y: 0, w: 6, h: 4, cv: 1, config: { query: 'junk' }, visibility: 'public' })).toEqual({});
  });
  it('hero has content fields only; every other widget has the title, size and visibility options', () => {
    expect(fieldsFor('hero').every(f => f.scope === 'content')).toBe(true);
    for (const key of SITE_WIDGET_KEYS.filter(k => k !== 'hero')) {
      const names = fieldsFor(key).map(f => f.name);
      // Sep 11 2026: size sits between title and visibility (a preset over `w`, never a config key).
      expect(names.slice(0, 3)).toEqual(['title', 'size', 'visibility']);
    }
    expect(contentActionFor('contact')).toBe('set_contact');
    expect(contentActionFor('teams')).toBeNull();
  });
});
