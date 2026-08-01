import { describe, it, expect } from 'vitest';
import {
  SPORT_SETTINGS_SCHEMAS,
  getSportSettingsSchema,
  hasSportSettingsSchema,
  emptySettingsValues,
  settingsToFormValues,
  formValuesToSettings,
  mergeSettingsForSave,
  validateSettingsValues,
  settingsToDisplayItems,
  getSportSettingsDisplay,
} from '../settings-schemas';
import { FEATURE_FLAGS } from '@/lib/features';
import type { SportKey } from '../SportRegistry';

describe('SPORT_SETTINGS_SCHEMAS coverage', () => {
  /**
   * THE REGRESSION GUARD. Every feature-enabled sport gets a clickable tab in
   * Edit Profile; before this schema existed, sports with no hand-written
   * `case` rendered a blank panel with a Save button that silently did
   * nothing (basketball, soccer and baseball shipped that way). Enabling a
   * sport without giving it a schema must fail the gate, not ship an empty tab.
   */
  it('every feature-enabled sport has a settings schema', () => {
    const missing = FEATURE_FLAGS.FEATURE_SPORTS.filter(key => !hasSportSettingsSchema(key));
    expect(missing).toEqual([]);
  });

  it('each schema is keyed by the sport it declares', () => {
    for (const [key, schema] of Object.entries(SPORT_SETTINGS_SCHEMAS)) {
      expect(schema!.sport_key).toBe(key);
    }
  });

  it('each schema has at least one field and no duplicate field keys', () => {
    for (const schema of Object.values(SPORT_SETTINGS_SCHEMAS)) {
      expect(schema!.fields.length).toBeGreaterThan(0);
      const keys = schema!.fields.map(f => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('every select field default is one of its own options', () => {
    for (const schema of Object.values(SPORT_SETTINGS_SCHEMAS)) {
      for (const field of schema!.fields) {
        if (field.kind !== 'select') continue;
        const values = field.options.map(o => o.value);
        expect(values).toContain(field.defaultValue);
      }
    }
  });

  it('returns null rather than throwing for a sport with no schema', () => {
    expect(getSportSettingsSchema('training' as SportKey)).toBeNull();
    expect(hasSportSettingsSchema('tennis' as SportKey)).toBe(false);
  });
});

describe('emptySettingsValues', () => {
  it('leaves every field blank — selects default to "not specified"', () => {
    // Selects deliberately do NOT preselect a real value. See NOT_SPECIFIED.
    const golf = getSportSettingsSchema('golf')!;
    expect(emptySettingsValues(golf)).toEqual({
      handicap: '',
      home_course: '',
      tee_preference: '',
      dominant_hand: '',
    });
  });

  it('produces a value for every field so inputs stay controlled', () => {
    for (const schema of Object.values(SPORT_SETTINGS_SCHEMAS)) {
      const values = emptySettingsValues(schema!);
      for (const field of schema!.fields) {
        expect(typeof values[field.key]).toBe('string');
      }
    }
  });
});

describe('settingsToFormValues', () => {
  const golf = getSportSettingsSchema('golf')!;

  it('hydrates stored values, coercing numbers to strings', () => {
    expect(
      settingsToFormValues(golf, {
        handicap: 12.4,
        home_course: 'Eagle Creek',
        tee_preference: 'blue',
        dominant_hand: 'left',
      })
    ).toEqual({
      handicap: '12.4',
      home_course: 'Eagle Creek',
      tee_preference: 'blue',
      dominant_hand: 'left',
    });
  });

  it('falls back to defaults for missing, null and empty values', () => {
    expect(settingsToFormValues(golf, { handicap: null, home_course: '' })).toEqual(
      emptySettingsValues(golf)
    );
    expect(settingsToFormValues(golf, null)).toEqual(emptySettingsValues(golf));
    expect(settingsToFormValues(golf, undefined)).toEqual(emptySettingsValues(golf));
  });

  it('ignores stored keys the schema does not declare', () => {
    // Rows written by the removed golf-equipment form still carry these.
    const values = settingsToFormValues(golf, {
      handicap: 8,
      driver_brand: 'Titleist',
      ball_brand: 'Pro V1',
    });
    expect(values.driver_brand).toBeUndefined();
    expect(values.ball_brand).toBeUndefined();
    expect(values.handicap).toBe('8');
  });

  it('rejects a select value the schema no longer offers', () => {
    // A <select> must never be handed a value it cannot render.
    const values = settingsToFormValues(golf, { tee_preference: 'purple' });
    expect(values.tee_preference).toBe('');
  });

  it('preserves zero, which is falsy but meaningful for jersey numbers', () => {
    const basketball = getSportSettingsSchema('basketball')!;
    expect(settingsToFormValues(basketball, { jersey_number: 0 }).jersey_number).toBe('0');
  });
});

describe('formValuesToSettings', () => {
  const golf = getSportSettingsSchema('golf')!;

  it('coerces number fields and trims text', () => {
    expect(
      formValuesToSettings(golf, {
        handicap: '12.4',
        home_course: '  Eagle Creek  ',
        tee_preference: 'red',
        dominant_hand: 'left',
      })
    ).toEqual({
      handicap: 12.4,
      home_course: 'Eagle Creek',
      tee_preference: 'red',
      dominant_hand: 'left',
    });
  });

  it('drops blank fields instead of persisting empty strings', () => {
    const settings = formValuesToSettings(golf, {
      handicap: '',
      home_course: '   ',
      tee_preference: 'white',
      dominant_hand: 'right',
    });
    expect(settings).not.toHaveProperty('handicap');
    expect(settings).not.toHaveProperty('home_course');
    expect(settings.tee_preference).toBe('white');
  });

  it('keeps a jersey number of 0', () => {
    const basketball = getSportSettingsSchema('basketball')!;
    const settings = formValuesToSettings(basketball, {
      ...emptySettingsValues(basketball),
      jersey_number: '0',
    });
    expect(settings.jersey_number).toBe(0);
  });

  it('round-trips through settingsToFormValues without drift', () => {
    const original = {
      handicap: 4.2,
      home_course: 'Pebble Beach',
      tee_preference: 'black',
      dominant_hand: 'left',
    };
    expect(formValuesToSettings(golf, settingsToFormValues(golf, original))).toEqual(original);
  });
});

describe('settingsToDisplayItems', () => {
  const golf = getSportSettingsSchema('golf')!;
  const basketball = getSportSettingsSchema('basketball')!;

  it('returns nothing for an empty, null or undefined settings object', () => {
    // Onboarding writes an empty `{}` row for every declared sport, so this
    // is the COMMON case — it must render no block at all, not an empty one.
    expect(settingsToDisplayItems(golf, {})).toEqual([]);
    expect(settingsToDisplayItems(golf, null)).toEqual([]);
    expect(settingsToDisplayItems(golf, undefined)).toEqual([]);
  });

  it('ignores stored keys the schema does not declare', () => {
    // Rows written by the retired golf-equipment tab still carry these, and
    // mergeSettingsForSave deliberately preserves them. They must never
    // reach a public profile.
    const legacy = { driver_brand: 'Titleist', ball_brand: 'Pro V1', irons_brand: 'Ping' };
    expect(settingsToDisplayItems(golf, legacy)).toEqual([]);

    const withReal = settingsToDisplayItems(golf, { ...legacy, handicap: 12.4 });
    expect(withReal).toEqual([{ key: 'handicap', label: 'Official Handicap', value: '12.4' }]);
  });

  it('resolves a select to its option label, not its raw value', () => {
    expect(settingsToDisplayItems(basketball, { position: 'PG' })).toEqual([
      { key: 'position', label: 'Position', value: 'Point Guard' },
    ]);
    expect(settingsToDisplayItems(golf, { tee_preference: 'white' })).toEqual([
      { key: 'tee_preference', label: 'Preferred Tee', value: "White (Men's Regular)" },
    ]);
  });

  it('skips a stored select value the schema no longer offers', () => {
    // Not rendered raw, and not silently swapped for a default.
    expect(settingsToDisplayItems(basketball, { position: 'ZZ' })).toEqual([]);
  });

  it('never renders the "not specified" placeholder as a value', () => {
    expect(settingsToDisplayItems(golf, { tee_preference: '', dominant_hand: '' })).toEqual([]);
  });

  it('renders a jersey number of 0', () => {
    // 0 is a legal jersey number and is falsy — a truthiness check would
    // silently drop it. This is the whole reason the helper tests typeof.
    expect(settingsToDisplayItems(basketball, { jersey_number: 0 })).toEqual([
      { key: 'jersey_number', label: 'Jersey Number', value: '0' },
    ]);
  });

  it('skips non-finite numbers, non-scalars and whitespace-only text', () => {
    expect(settingsToDisplayItems(basketball, { jersey_number: NaN })).toEqual([]);
    expect(settingsToDisplayItems(basketball, { jersey_number: Infinity })).toEqual([]);
    expect(settingsToDisplayItems(golf, { home_course: '   ' })).toEqual([]);
    expect(settingsToDisplayItems(golf, { home_course: { name: 'x' } })).toEqual([]);
    expect(settingsToDisplayItems(golf, { home_course: ['x'] })).toEqual([]);
    expect(settingsToDisplayItems(golf, { home_course: true })).toEqual([]);
  });

  it('emits items in schema field order, not stored key order', () => {
    const items = settingsToDisplayItems(golf, {
      dominant_hand: 'left',
      handicap: 3,
      home_course: 'Eagle Creek',
    });
    expect(items.map(i => i.key)).toEqual(['handicap', 'home_course', 'dominant_hand']);
  });

  it('uses displayLabel only where a schema declares one', () => {
    expect(settingsToDisplayItems(golf, { handicap: 1 })[0].label).toBe('Official Handicap');
    expect(settingsToDisplayItems(golf, { home_course: 'X' })[0].label).toBe('Home Course');
  });

  it('maps every select option in every schema back to its label', () => {
    for (const schema of Object.values(SPORT_SETTINGS_SCHEMAS)) {
      for (const field of schema!.fields) {
        if (field.kind !== 'select') continue;
        for (const option of field.options) {
          const items = settingsToDisplayItems(schema!, { [field.key]: option.value });
          if (option.value === '') {
            expect(items).toEqual([]);
          } else {
            expect(items).toEqual([
              { key: field.key, label: field.displayLabel ?? field.label, value: option.label },
            ]);
          }
        }
      }
    }
  });

  it('shows nothing for a form that was opened and saved but never filled in', () => {
    // THE HONESTY GUARANTEE. Selects used to preselect a real value that
    // saving then persisted, so an untouched form would have published
    // "Right-handed" / "White tees" as declared facts. This pins the whole
    // round trip: empty form -> saved payload -> profile display.
    for (const schema of Object.values(SPORT_SETTINGS_SCHEMAS)) {
      const saved = formValuesToSettings(schema!, emptySettingsValues(schema!));
      expect(saved).toEqual({});
      expect(settingsToDisplayItems(schema!, saved)).toEqual([]);
    }
  });
});

describe('getSportSettingsDisplay', () => {
  it('resolves the schema by sport key', () => {
    expect(getSportSettingsDisplay('basketball', { position: 'C' })).toEqual([
      { key: 'position', label: 'Position', value: 'Center' },
    ]);
  });

  it('returns [] for a sport with no schema rather than throwing', () => {
    expect(getSportSettingsDisplay('training' as SportKey, { position: 'C' })).toEqual([]);
  });
});

describe('mergeSettingsForSave', () => {
  const golf = getSportSettingsSchema('golf')!;

  it('preserves stored keys the schema does not declare', () => {
    // Written by the retired golf-equipment form. Saving the golf tab must
    // not delete them as a side effect.
    const stored = { handicap: 20, driver_brand: 'Titleist', ball_brand: 'Pro V1' };
    const merged = mergeSettingsForSave(golf, stored, {
      ...emptySettingsValues(golf),
      handicap: '12.4',
    });
    expect(merged.driver_brand).toBe('Titleist');
    expect(merged.ball_brand).toBe('Pro V1');
    expect(merged.handicap).toBe(12.4);
  });

  it('still clears a schema field the athlete emptied', () => {
    // The whole point of deleting schema keys before merging: a blank field
    // must not be resurrected from the stored row.
    const merged = mergeSettingsForSave(
      golf,
      { handicap: 20, home_course: 'Eagle Creek' },
      { ...emptySettingsValues(golf), handicap: '', home_course: '' }
    );
    expect(merged).not.toHaveProperty('handicap');
    expect(merged).not.toHaveProperty('home_course');
  });

  it('handles a sport with no stored row yet', () => {
    const merged = mergeSettingsForSave(golf, undefined, {
      ...emptySettingsValues(golf),
      handicap: '5',
    });
    expect(merged.handicap).toBe(5);
    // Untouched selects are blank, so nothing is persisted for them.
    expect(merged).not.toHaveProperty('tee_preference');
  });

  it('does not mutate the stored object it was given', () => {
    const stored = { handicap: 20, driver_brand: 'Ping' };
    mergeSettingsForSave(golf, stored, { ...emptySettingsValues(golf), handicap: '' });
    expect(stored).toEqual({ handicap: 20, driver_brand: 'Ping' });
  });
});

describe('validateSettingsValues', () => {
  const golf = getSportSettingsSchema('golf')!;
  const basketball = getSportSettingsSchema('basketball')!;

  it('accepts empty values — settings are preferences, not required intake', () => {
    expect(validateSettingsValues(golf, emptySettingsValues(golf))).toEqual({});
  });

  it('rejects a non-numeric number field', () => {
    const errors = validateSettingsValues(golf, { ...emptySettingsValues(golf), handicap: 'scratch' });
    expect(errors.handicap).toMatch(/must be a number/);
  });

  it('enforces min and max bounds', () => {
    expect(
      validateSettingsValues(golf, { ...emptySettingsValues(golf), handicap: '99' }).handicap
    ).toMatch(/at most 54/);
    expect(
      validateSettingsValues(golf, { ...emptySettingsValues(golf), handicap: '-40' }).handicap
    ).toMatch(/at least -10/);
    expect(
      validateSettingsValues(basketball, { ...emptySettingsValues(basketball), jersey_number: '150' })
        .jersey_number
    ).toMatch(/at most 99/);
  });

  it('accepts a plus handicap, which is a real negative index', () => {
    expect(
      validateSettingsValues(golf, { ...emptySettingsValues(golf), handicap: '-2.4' })
    ).toEqual({});
  });

  it('enforces text maxLength', () => {
    const errors = validateSettingsValues(golf, {
      ...emptySettingsValues(golf),
      home_course: 'x'.repeat(200),
    });
    expect(errors.home_course).toMatch(/characters or fewer/);
  });
});
