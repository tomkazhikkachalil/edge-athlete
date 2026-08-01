import { describe, it, expect } from 'vitest';
import {
  EQUIPMENT_SPEC_FIELDS,
  getSpecFields,
  findUnknownSpecCategories,
} from '@/lib/equipment-specs';

const keysFor = (sport: string, category: string) => getSpecFields(sport, category).map(f => f.key);

describe('getSpecFields', () => {
  it('gives golf clubs exactly the fields the old hardcoded block did', () => {
    // Byte-identical keys: equipment saved before this change must keep
    // rendering with the same labels.
    expect(keysFor('golf', 'driver')).toEqual(['loft', 'shaft', 'flex', 'length', 'grip']);
    expect(keysFor('golf', 'iron_set')).toEqual(['loft', 'shaft', 'flex', 'length', 'lie', 'grip']);
  });

  it('scopes fields to the categories they make sense for', () => {
    expect(keysFor('golf', 'ball')).toEqual(['compression']);
    expect(keysFor('golf', 'ball')).not.toContain('lie');
    expect(keysFor('golf', 'shoes')).toEqual(['size']);
  });

  it('asks a hockey stick about curve, flex and lie — and skates about size', () => {
    expect(keysFor('ice_hockey', 'stick')).toEqual(['curve', 'flex', 'lie', 'hand']);
    expect(keysFor('ice_hockey', 'skates')).toEqual(['size', 'holder']);
  });

  it('asks a bat about length, drop and certification', () => {
    expect(keysFor('baseball', 'bat')).toEqual(['length', 'weight_drop', 'certification']);
    expect(keysFor('baseball', 'glove')).toEqual(['web', 'hand', 'size']);
  });

  it('asks soccer cleats about stud type and keeper gloves about cut', () => {
    expect(keysFor('soccer', 'cleats')).toEqual(['stud_type', 'size']);
    expect(keysFor('soccer', 'gloves')).toEqual(['cut', 'size']);
  });

  it('returns the most identifying spec first — cards show only three', () => {
    expect(keysFor('ice_hockey', 'stick')[0]).toBe('curve');
    expect(keysFor('baseball', 'bat')[0]).toBe('length');
    expect(keysFor('golf', 'driver')[0]).toBe('loft');
  });

  it('never throws for General, unknown sports or free-text categories', () => {
    expect(getSpecFields('general', 'yoga mat')).toEqual([]);
    expect(getSpecFields('quidditch', 'broom')).toEqual([]);
    expect(getSpecFields('golf', 'something the user typed')).toEqual([]);
  });
});

describe('spec field hygiene', () => {
  it('uses snake_case keys — they become JSONB keys and display labels', () => {
    for (const [sportKey, fields] of Object.entries(EQUIPMENT_SPEC_FIELDS)) {
      for (const field of fields) {
        expect(field.key, `${sportKey}.${field.key}`).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
      }
    }
  });

  it('only references categories that exist for that sport', () => {
    // Fires the day someone adds a category and forgets its spec fields, or
    // typos one — otherwise the inputs would silently never render.
    expect(findUnknownSpecCategories()).toEqual([]);
  });

  it('has no duplicate keys within a sport', () => {
    for (const [sportKey, fields] of Object.entries(EQUIPMENT_SPEC_FIELDS)) {
      const keys = fields.map(f => f.key);
      expect(new Set(keys).size, `${sportKey} has duplicate spec keys`).toBe(keys.length);
    }
  });
});
