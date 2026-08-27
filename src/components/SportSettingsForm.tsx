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

interface SportSettingsFormProps {
  schema: SportSettingsSchema;
  values: SettingsFormValues;
  /** Field-level messages from `validateSettingsValues`, keyed by field key. */
  errors?: Record<string, string>;
  onChange: (fieldKey: string, value: string) => void;
  disabled?: boolean;
}

const CONTROL_CLASS =
  'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:bg-surface-sunken disabled:text-muted';

export default function SportSettingsForm({
  schema,
  values,
  errors = {},
  onChange,
  disabled = false,
}: SportSettingsFormProps) {
  const renderField = (field: SettingsFieldDef) => {
    const inputId = `${schema.sport_key}-${field.key}`;
    const error = errors[field.key];
    const describedBy = error ? `${inputId}-error` : field.hint ? `${inputId}-hint` : undefined;
    const borderClass = error ? 'border-red-500' : 'border-border-strong';

    // Free text needs the full row; compact controls pair up on wider screens.
    const spanClass = field.kind === 'text' ? 'md:col-span-2' : '';

    return (
      <div key={field.key} className={spanClass}>
        <label htmlFor={inputId} className="block text-sm font-medium text-secondary mb-1">
          {field.label}
        </label>

        {field.kind === 'select' ? (
          <select
            id={inputId}
            value={values[field.key] ?? field.defaultValue}
            onChange={event => onChange(field.key, event.target.value)}
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={`${CONTROL_CLASS} ${borderClass}`}
          >
            {field.options.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={inputId}
            type={field.kind === 'number' ? 'number' : 'text'}
            value={values[field.key] ?? ''}
            onChange={event => onChange(field.key, event.target.value)}
            disabled={disabled}
            placeholder={field.placeholder}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            {...(field.kind === 'number'
              ? { step: field.step, min: field.min, max: field.max }
              : { maxLength: field.maxLength })}
            className={`${CONTROL_CLASS} ${borderClass}`}
          />
        )}

        {error ? (
          <p id={`${inputId}-error`} className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : field.hint ? (
          <p id={`${inputId}-hint`} className="mt-1 text-xs text-muted">
            {field.hint}
          </p>
        ) : null}
      </div>
    );
  };

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
