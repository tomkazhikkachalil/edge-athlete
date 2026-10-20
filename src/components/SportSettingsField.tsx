'use client';

/**
 * ONE sport-settings field, rendered from its schema entry — shared by the
 * sport setup's steps (SportSetupFlow) and the one-page form
 * (SportSettingsForm) so the two cannot drift (Program D, Oct 2026).
 * Sport-agnostic: it reads a `SettingsFieldDef` and nothing else.
 */

import type { SettingsFieldDef, SettingsFormValues } from '@/lib/sports/settings-schemas';

export const SETTINGS_CONTROL_CLASS =
  'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:bg-surface-sunken disabled:text-muted';

interface SportSettingsFieldProps {
  sportKey: string;
  field: SettingsFieldDef;
  values: SettingsFormValues;
  /** The field's message from `validateSettingsValues`, if any. */
  error?: string;
  onChange: (fieldKey: string, value: string) => void;
  disabled?: boolean;
  /** Extra classes on the wrapper (the grid span the one-page form uses). */
  className?: string;
}

export default function SportSettingsField({ sportKey, field, values, error, onChange, disabled = false, className = '' }: SportSettingsFieldProps) {
  const inputId = `${sportKey}-${field.key}`;
  const describedBy = error ? `${inputId}-error` : field.hint ? `${inputId}-hint` : undefined;
  const borderClass = error ? 'border-red-500' : 'border-border-strong';

  return (
    <div className={className} data-settings-field={field.key}>
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
          className={`${SETTINGS_CONTROL_CLASS} ${borderClass}`}
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
          className={`${SETTINGS_CONTROL_CLASS} ${borderClass}`}
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
}
