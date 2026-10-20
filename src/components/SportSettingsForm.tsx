'use client';

/**
 * Renders one sport's Edit Profile settings tab from its schema.
 *
 * Purely presentational and sport-agnostic: it knows nothing about golf,
 * hockey or any other sport — it reads `SPORT_SETTINGS_SCHEMAS` entries
 * (see `src/lib/sports/settings-schemas.ts`). Adding a sport's settings is
 * a schema edit; this component never changes.
 */

import type { SettingsFieldDef, SettingsFormValues, SportSettingsSchema } from '@/lib/sports/settings-schemas';
import SportSettingsField from '@/components/SportSettingsField';

interface SportSettingsFormProps {
  schema: SportSettingsSchema;
  values: SettingsFormValues;
  /** Field-level messages from `validateSettingsValues`, keyed by field key. */
  errors?: Record<string, string>;
  onChange: (fieldKey: string, value: string) => void;
  disabled?: boolean;
}

export default function SportSettingsForm({
  schema,
  values,
  errors = {},
  onChange,
  disabled = false,
}: SportSettingsFormProps) {
  // The field itself is SportSettingsField (shared with the step flow — Program D).
  // Free text needs the full row; compact controls pair up on wider screens.
  const renderField = (field: SettingsFieldDef) => (
    <SportSettingsField
      key={field.key}
      sportKey={schema.sport_key}
      field={field}
      values={values}
      error={errors[field.key]}
      onChange={onChange}
      disabled={disabled}
      className={field.kind === 'text' ? 'md:col-span-2' : ''}
    />
  );

  // Preferences vs competitive profile: same schema, two visually separated
  // sections. Competitive entries are self-reported credentials that render
  // on the public profile, and the athlete should know that while typing.
  const preferenceFields = schema.fields.filter(f => (f.group ?? 'preferences') === 'preferences');
  const competitiveFields = schema.fields.filter(f => f.group === 'competitive');

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {preferenceFields.map(renderField)}
      </div>

      {competitiveFields.length > 0 && (
        <div className="mt-6 pt-6 border-t border-border-subtle">
          <h3 className="text-lg font-semibold text-primary">Competitive profile</h3>
          <p className="mt-1 mb-6 text-sm text-muted">
            Shown on your profile, labeled as self-reported.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {competitiveFields.map(renderField)}
          </div>
        </div>
      )}
    </div>
  );
}
