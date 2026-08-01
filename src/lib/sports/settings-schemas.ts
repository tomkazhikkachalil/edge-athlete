/**
 * Per-sport ATHLETE SETTINGS schemas — single source of truth for the
 * sport tabs in Edit Profile (`EditProfileTabs` → `SportSettingsForm`).
 *
 * Data model ("build for today, architect for tomorrow"):
 * Every sport's settings live as one JSONB object in `sport_settings`
 * (`profile_id` + `sport_key` + `settings`), served by the already
 * sport-agnostic `/api/sport-settings`. Zero DDL to add a sport — the row
 * shape does not change, only the schema below.
 *
 * This file exists because the settings UI used to be a hand-written golf
 * form plus a `switch` in `EditProfileTabs`. Sports whose key was missing a
 * `case` fell through to `default: return null` and rendered a BLANK tab —
 * which is what basketball, soccer and baseball did in production, with a
 * Save button that silently did nothing. Rendering from a schema removes
 * that failure mode by construction: a sport either has a schema (real
 * form) or does not (explicit "coming soon"), and there is no third state.
 *
 * ADDING A SPORT'S SETTINGS = 1 edit: add an entry to SPORT_SETTINGS_SCHEMAS.
 * No component, API, type or migration changes.
 *
 * These schemas describe INTAKE-DECLARED preferences (position, jersey
 * number, handedness). They are deliberately NOT performance stats — those
 * are computed from real activity (see `/api/golf/trends`, which derives a
 * WHS-style handicap from logged rounds and is what the app actually
 * displays). A number typed here is a self-reported preference, nothing more.
 *
 * Gear does NOT belong here. Equipment is a first-class, sport-agnostic
 * feature backed by the `athlete_equipment` table — see
 * `src/lib/equipment-config.ts` and the profile's Equipment tab.
 */

import type { SportKey } from './SportRegistry';

/** A choice in a `select` field. */
export interface SettingsSelectOption {
  value: string;
  label: string;
}

interface SettingsFieldBase {
  key: string;
  label: string;
  /** Short helper rendered under the input. */
  hint?: string;
  /**
   * Label used on the PROFILE (read-only), falling back to `label`.
   * A form label reads in context, under a hint and beside its input; a
   * profile chip has to read alone.
   */
  displayLabel?: string;
}

export type SettingsFieldDef =
  | (SettingsFieldBase & {
      kind: 'text';
      placeholder?: string;
      maxLength?: number;
    })
  | (SettingsFieldBase & {
      kind: 'number';
      placeholder?: string;
      step?: number;
      min?: number;
      max?: number;
    })
  | (SettingsFieldBase & {
      kind: 'select';
      options: SettingsSelectOption[];
      /** Value used when the athlete has saved nothing yet. */
      defaultValue: string;
    });

export interface SportSettingsSchema {
  sport_key: SportKey;
  /** Fields shown in the sport's Edit Profile tab, in order. */
  fields: SettingsFieldDef[];
}

/** Every form value is held as a string; the schema drives coercion on save. */
export type SettingsFormValues = Record<string, string>;

/**
 * The first option of EVERY select, and every select's default.
 *
 * Selects used to default to a real value (`right`, `white`, `PG`), which
 * `formValuesToSettings` then persisted whether or not the athlete had chosen
 * it — so merely opening a sport tab and pressing Save recorded preferences
 * nobody stated. That was invisible while these values were write-only. Now
 * that they render on a public profile, it would present a guess as a declared
 * fact, so "not specified" has to be a real, selectable state.
 *
 * Blank values are dropped by `formValuesToSettings` and skipped by
 * `settingsToDisplayItems`, so an untouched form saves nothing and shows
 * nothing. A test pins exactly that.
 */
const NOT_SPECIFIED: SettingsSelectOption = { value: '', label: '— Not specified' };

// Reused across team sports so the numbering rule stays consistent.
const jerseyNumberField = (): SettingsFieldDef => ({
  key: 'jersey_number',
  label: 'Jersey Number',
  kind: 'number',
  placeholder: '23',
  step: 1,
  min: 0,
  max: 99,
});

const dominantHandField = (label = 'Dominant Hand'): SettingsFieldDef => ({
  key: 'dominant_hand',
  label,
  kind: 'select',
  defaultValue: NOT_SPECIFIED.value,
  options: [
    NOT_SPECIFIED,
    { value: 'right', label: 'Right-handed' },
    { value: 'left', label: 'Left-handed' },
  ],
});

/**
 * Schemas by sport key. A sport absent from this map is not broken — its tab
 * renders an explicit "coming soon" panel (see `SportSettingsForm`'s caller).
 */
export const SPORT_SETTINGS_SCHEMAS: Partial<Record<SportKey, SportSettingsSchema>> = {
  golf: {
    sport_key: 'golf',
    fields: [
      {
        key: 'handicap',
        label: 'Handicap Index',
        // The profile also shows a WHS-style estimate derived from logged
        // rounds (`/api/golf/trends`), labelled there as "Handicap est." and
        // "not an official index". "Official" is the symmetric word, so the
        // two numbers can never be read as the same measurement.
        displayLabel: 'Official Handicap',
        kind: 'number',
        placeholder: '12.4',
        step: 0.1,
        // WHS bounds: the maximum index is 54.0, and elite players go plus.
        min: -10,
        max: 54,
        hint: 'Your official USGA index. Edge Athlete also estimates one from your logged rounds.',
      },
      {
        key: 'home_course',
        label: 'Home Course',
        kind: 'text',
        placeholder: 'Pebble Beach Golf Links',
        maxLength: 120,
      },
      {
        key: 'tee_preference',
        label: 'Preferred Tee',
        kind: 'select',
        defaultValue: NOT_SPECIFIED.value,
        options: [
          NOT_SPECIFIED,
          { value: 'black', label: 'Black (Championship)' },
          { value: 'blue', label: 'Blue (Back/Tips)' },
          { value: 'white', label: "White (Men's Regular)" },
          { value: 'red', label: 'Red (Forward/Ladies)' },
          { value: 'gold', label: 'Gold (Senior)' },
        ],
      },
      dominantHandField(),
    ],
  },

  ice_hockey: {
    sport_key: 'ice_hockey',
    fields: [
      {
        key: 'position',
        label: 'Position',
        kind: 'select',
        defaultValue: NOT_SPECIFIED.value,
        options: [
          NOT_SPECIFIED,
          { value: 'C', label: 'Centre' },
          { value: 'LW', label: 'Left Wing' },
          { value: 'RW', label: 'Right Wing' },
          { value: 'D', label: 'Defence' },
          { value: 'G', label: 'Goaltender' },
        ],
      },
      jerseyNumberField(),
      {
        key: 'shoots',
        label: 'Shoots',
        kind: 'select',
        defaultValue: NOT_SPECIFIED.value,
        options: [
          NOT_SPECIFIED,
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
        ],
      },
    ],
  },

  basketball: {
    sport_key: 'basketball',
    fields: [
      {
        key: 'position',
        label: 'Position',
        kind: 'select',
        defaultValue: NOT_SPECIFIED.value,
        options: [
          NOT_SPECIFIED,
          { value: 'PG', label: 'Point Guard' },
          { value: 'SG', label: 'Shooting Guard' },
          { value: 'SF', label: 'Small Forward' },
          { value: 'PF', label: 'Power Forward' },
          { value: 'C', label: 'Center' },
        ],
      },
      jerseyNumberField(),
      dominantHandField(),
    ],
  },

  soccer: {
    sport_key: 'soccer',
    fields: [
      {
        key: 'position',
        label: 'Position',
        kind: 'select',
        defaultValue: NOT_SPECIFIED.value,
        options: [
          NOT_SPECIFIED,
          { value: 'GK', label: 'Goalkeeper' },
          { value: 'DF', label: 'Defender' },
          { value: 'MF', label: 'Midfielder' },
          { value: 'FW', label: 'Forward' },
        ],
      },
      jerseyNumberField(),
      {
        key: 'preferred_foot',
        label: 'Preferred Foot',
        kind: 'select',
        defaultValue: NOT_SPECIFIED.value,
        options: [
          NOT_SPECIFIED,
          { value: 'right', label: 'Right' },
          { value: 'left', label: 'Left' },
          { value: 'both', label: 'Both' },
        ],
      },
    ],
  },

  baseball: {
    sport_key: 'baseball',
    fields: [
      {
        key: 'position',
        label: 'Primary Position',
        kind: 'select',
        defaultValue: NOT_SPECIFIED.value,
        options: [
          NOT_SPECIFIED,
          { value: 'P', label: 'Pitcher' },
          { value: 'C', label: 'Catcher' },
          { value: '1B', label: 'First Base' },
          { value: '2B', label: 'Second Base' },
          { value: '3B', label: 'Third Base' },
          { value: 'SS', label: 'Shortstop' },
          { value: 'LF', label: 'Left Field' },
          { value: 'CF', label: 'Center Field' },
          { value: 'RF', label: 'Right Field' },
          { value: 'DH', label: 'Designated Hitter' },
        ],
      },
      jerseyNumberField(),
      {
        key: 'bats',
        label: 'Bats',
        kind: 'select',
        defaultValue: NOT_SPECIFIED.value,
        options: [
          NOT_SPECIFIED,
          { value: 'right', label: 'Right' },
          { value: 'left', label: 'Left' },
          { value: 'switch', label: 'Switch' },
        ],
      },
      {
        key: 'throws',
        label: 'Throws',
        kind: 'select',
        defaultValue: NOT_SPECIFIED.value,
        options: [
          NOT_SPECIFIED,
          { value: 'right', label: 'Right' },
          { value: 'left', label: 'Left' },
        ],
      },
    ],
  },

  volleyball: {
    sport_key: 'volleyball',
    fields: [
      {
        key: 'position',
        label: 'Position',
        kind: 'select',
        defaultValue: NOT_SPECIFIED.value,
        options: [
          NOT_SPECIFIED,
          { value: 'OH', label: 'Outside Hitter' },
          { value: 'OPP', label: 'Opposite' },
          { value: 'MB', label: 'Middle Blocker' },
          { value: 'S', label: 'Setter' },
          { value: 'L', label: 'Libero' },
          { value: 'DS', label: 'Defensive Specialist' },
        ],
      },
      jerseyNumberField(),
      dominantHandField('Hitting Arm'),
    ],
  },
};

/** The schema for a sport, or null when it has none (tab shows "coming soon"). */
export function getSportSettingsSchema(sportKey: SportKey): SportSettingsSchema | null {
  return SPORT_SETTINGS_SCHEMAS[sportKey] ?? null;
}

export function hasSportSettingsSchema(sportKey: SportKey): boolean {
  return getSportSettingsSchema(sportKey) !== null;
}

/**
 * Form values for a sport with nothing saved yet: selects take their default,
 * text/number start empty. Used so inputs are controlled from first paint.
 */
export function emptySettingsValues(schema: SportSettingsSchema): SettingsFormValues {
  const values: SettingsFormValues = {};
  for (const field of schema.fields) {
    values[field.key] = field.kind === 'select' ? field.defaultValue : '';
  }
  return values;
}

/**
 * Hydrate form values from a stored `sport_settings.settings` object.
 * Unknown stored keys are ignored (the schema owns the shape) and missing
 * ones fall back to the empty/default value, so a schema can gain a field
 * without breaking rows written before it existed.
 */
export function settingsToFormValues(
  schema: SportSettingsSchema,
  settings: Record<string, unknown> | null | undefined
): SettingsFormValues {
  const values = emptySettingsValues(schema);
  if (!settings) return values;

  for (const field of schema.fields) {
    const stored = settings[field.key];
    if (stored === null || stored === undefined || stored === '') continue;

    if (field.kind === 'select') {
      // Only accept a stored value the schema still offers — a removed
      // option must not leave the <select> showing a value it cannot render.
      const allowed = field.options.some(option => option.value === stored);
      if (allowed) values[field.key] = String(stored);
      continue;
    }

    values[field.key] = String(stored);
  }

  return values;
}

/** One label/value pair ready to render on a profile. */
export interface SettingsDisplayItem {
  key: string;
  /** `field.displayLabel ?? field.label`. */
  label: string;
  /** Already human-readable: selects resolve to their option label. */
  value: string;
}

/**
 * Turn a stored settings object into display pairs for a profile.
 *
 * Iterates the SCHEMA's fields, never `Object.entries(settings)`. Rows can
 * hold keys no schema declares — `mergeSettingsForSave` deliberately
 * preserves them, and rows written by the retired golf-equipment tab still
 * carry `driver_brand`/`ball_brand`. Walking the stored object would leak
 * those dead keys onto public profiles.
 *
 * Returns `[]` for an empty/absent settings object, which matters more than
 * it looks: onboarding writes an empty `{}` row for every sport an athlete
 * declares, so most rows have nothing in them and must render nothing at all
 * — not an empty labelled block.
 */
export function settingsToDisplayItems(
  schema: SportSettingsSchema,
  settings: Record<string, unknown> | null | undefined
): SettingsDisplayItem[] {
  if (!settings) return [];

  const items: SettingsDisplayItem[] = [];

  for (const field of schema.fields) {
    const stored = settings[field.key];
    if (stored === null || stored === undefined) continue;

    let value: string;

    if (field.kind === 'select') {
      // Only render an option the schema still offers. A retired option is
      // dropped from the edit form too, so showing its raw value would
      // display something the athlete can no longer see or confirm.
      const option = field.options.find(o => o.value !== '' && o.value === String(stored));
      if (!option) continue;
      value = option.label;
    } else if (typeof stored === 'number') {
      // Number.isFinite, not truthiness — jersey number 0 is legal.
      if (!Number.isFinite(stored)) continue;
      value = String(stored);
    } else if (typeof stored === 'string') {
      value = stored.trim();
      if (value === '') continue;
    } else {
      // The JSONB column is not shape-enforced; ignore anything else.
      continue;
    }

    items.push({ key: field.key, label: field.displayLabel ?? field.label, value });
  }

  return items;
}

/**
 * Display pairs for a sport key, or `[]` when that sport has no schema.
 * Convenience wrapper for callers iterating rows straight out of the table.
 */
export function getSportSettingsDisplay(
  sportKey: SportKey,
  settings: Record<string, unknown> | null | undefined
): SettingsDisplayItem[] {
  const schema = getSportSettingsSchema(sportKey);
  return schema ? settingsToDisplayItems(schema, settings) : [];
}

/**
 * Serialize form values for the API. Numbers are coerced; blanks become
 * `undefined` so a cleared field is dropped from the JSONB rather than
 * persisted as an empty string.
 */
export function formValuesToSettings(
  schema: SportSettingsSchema,
  values: SettingsFormValues
): Record<string, string | number> {
  const settings: Record<string, string | number> = {};

  for (const field of schema.fields) {
    const raw = (values[field.key] ?? '').trim();
    if (raw === '') continue;

    if (field.kind === 'number') {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) continue;
      settings[field.key] = parsed;
      continue;
    }

    settings[field.key] = raw;
  }

  return settings;
}

/**
 * Build the object to persist, preserving stored keys the schema does not
 * declare.
 *
 * Why not just write `formValuesToSettings` output: rows can hold keys no
 * current schema knows about — the retired golf-equipment form wrote
 * `driver_brand`/`ball_brand` into the same JSONB. Overwriting wholesale
 * would delete those as a silent side effect of saving an unrelated field.
 *
 * Schema-owned keys are cleared first so emptying a field still clears it;
 * only genuinely foreign keys survive.
 */
export function mergeSettingsForSave(
  schema: SportSettingsSchema,
  stored: Record<string, unknown> | null | undefined,
  values: SettingsFormValues
): Record<string, unknown> {
  const preserved: Record<string, unknown> = { ...(stored ?? {}) };
  for (const field of schema.fields) {
    delete preserved[field.key];
  }
  return { ...preserved, ...formValuesToSettings(schema, values) };
}

/**
 * Validate form values against the schema. Returns field key → message for
 * anything the athlete must fix; an empty object means valid.
 *
 * Every field is optional — settings are preferences, not required intake —
 * so validation only rejects values that are present AND wrong.
 */
export function validateSettingsValues(
  schema: SportSettingsSchema,
  values: SettingsFormValues
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of schema.fields) {
    const raw = (values[field.key] ?? '').trim();
    if (raw === '') continue;

    if (field.kind === 'number') {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        errors[field.key] = `${field.label} must be a number`;
        continue;
      }
      if (field.min !== undefined && parsed < field.min) {
        errors[field.key] = `${field.label} must be at least ${field.min}`;
        continue;
      }
      if (field.max !== undefined && parsed > field.max) {
        errors[field.key] = `${field.label} must be at most ${field.max}`;
      }
      continue;
    }

    if (field.kind === 'text' && field.maxLength !== undefined && raw.length > field.maxLength) {
      errors[field.key] = `${field.label} must be ${field.maxLength} characters or fewer`;
    }
  }

  return errors;
}
