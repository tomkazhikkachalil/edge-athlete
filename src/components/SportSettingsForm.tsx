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
  'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500';

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
    const borderClass = error ? 'border-red-500' : 'border-gray-300';

    // Free text needs the full row; compact controls pair up on wider screens.
    const spanClass = field.kind === 'text' ? 'md:col-span-2' : '';

    return (
      <div key={field.key} className={spanClass}>
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 mb-1">
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
          <p id={`${inputId}-error`} className="mt-1 text-xs text-red-600">
            {error}
          </p>
        ) : field.hint ? (
          <p id={`${inputId}-hint`} className="mt-1 text-xs text-gray-500">
            {field.hint}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {schema.fields.map(renderField)}
    </div>
  );
}
