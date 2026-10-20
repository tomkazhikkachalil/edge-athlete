import { describe, it, expect } from 'vitest';
import { SPORT_SETTINGS_SCHEMAS, type SportSettingsSchema } from '../settings-schemas';
import { PB_STEP_FIELDS_MAX, REVIEW_STEP_ID, STEP_FIELDS_MAX, isPersonalBestKey, stepIndexForKey, stepsForSchema, summaryLine } from '../settings-steps';

// Program D (Oct 2026): a sport's setup is a few short steps DERIVED from its
// schema. These pins hold the derivation for every sport that has one.

const schemas = Object.entries(SPORT_SETTINGS_SCHEMAS).filter((e): e is [string, SportSettingsSchema] => !!e[1]);

describe('stepsForSchema — short steps from the schema', () => {
  it('every sport with a schema yields a content step and Review, and Review owns no field', () => {
    expect(schemas.length).toBeGreaterThan(5);
    for (const [key, schema] of schemas) {
      const steps = stepsForSchema(schema, key);
      expect(steps.length, key).toBeGreaterThanOrEqual(2);
      expect(steps[steps.length - 1]).toEqual({ id: REVIEW_STEP_ID, label: 'Review', keys: [] });
      expect(steps.filter(s => s.id === REVIEW_STEP_ID)).toHaveLength(1);
    }
  });
  it('no key is lost or duplicated across the steps', () => {
    for (const [key, schema] of schemas) {
      const keys = stepsForSchema(schema, key).flatMap(s => s.keys);
      expect([...keys].sort(), key).toEqual(schema.fields.map(f => f.key).sort());
      expect(new Set(keys).size, key).toBe(keys.length);
    }
  });
  it('no step carries more than five fields — personal bests up to eight', () => {
    for (const [key, schema] of schemas) {
      for (const s of stepsForSchema(schema, key)) {
        const cap = s.id.startsWith('bests') ? PB_STEP_FIELDS_MAX : STEP_FIELDS_MAX;
        expect(s.keys.length, `${key}/${s.id}`).toBeLessThanOrEqual(cap);
        if (s.id.startsWith('bests')) expect(s.keys.every(isPersonalBestKey)).toBe(true);
        else expect(s.keys.some(isPersonalBestKey)).toBe(false);
      }
    }
  });
  it('an empty group yields no step: swimming is Competitive profile + Review; golf starts with About you', () => {
    expect(stepsForSchema(SPORT_SETTINGS_SCHEMAS.swimming!, 'Swimming').map(s => s.label)).toEqual(['Competitive profile', 'Review']);
    const golf = stepsForSchema(SPORT_SETTINGS_SCHEMAS.golf!, 'Golf');
    expect(golf[0].label).toBe('About you in Golf');
    expect(golf.map(s => s.id)).toContain('competitive');
  });
  it('track & field: Competitive profile, Personal bests (the five events), Review', () => {
    const steps = stepsForSchema(SPORT_SETTINGS_SCHEMAS.track_field!, 'Track & Field');
    expect(steps.map(s => s.label)).toEqual(['Competitive profile', 'Personal bests', 'Review']);
    expect(steps[1].keys.length).toBe(5);
    expect(steps[1].keys.every(k => k.startsWith('pb_'))).toBe(true);
  });
  it('a field maps back to the step that owns it; an unknown key goes to the first step', () => {
    const steps = stepsForSchema(SPORT_SETTINGS_SCHEMAS.golf!, 'Golf');
    expect(stepIndexForKey(steps, 'competitive_level')).toBe(steps.findIndex(s => s.id === 'competitive'));
    expect(stepIndexForKey(steps, 'nope')).toBe(0);
  });
});

describe("summaryLine — the row's one line", () => {
  it('is empty when nothing is set, and joins the first three set values with " · "', () => {
    const golf = SPORT_SETTINGS_SCHEMAS.golf!;
    expect(summaryLine(golf, null)).toBe('');
    expect(summaryLine(golf, {})).toBe('');
    const values: Record<string, unknown> = {};
    for (const f of golf.fields.slice(0, 4)) values[f.key] = f.kind === 'select' ? f.options.find(o => o.value !== '')!.value : f.kind === 'number' ? 7 : 'Seven';
    const line = summaryLine(golf, values);
    expect(line.split(' · ')).toHaveLength(3);
    expect(summaryLine(golf, values, 4).split(' · ')).toHaveLength(4);
  });
});
