'use client';

import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import SportSettingsField from '@/components/SportSettingsField';
import StepFlow from '@/components/StepFlow';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { formValuesToSettings, settingsToDisplayItems, type SettingsFormValues, type SportSettingsSchema } from '@/lib/sports/settings-schemas';
import { stepIndexForKey, stepsForSchema } from '@/lib/sports/settings-steps';

export type SportSetupSaveResult = { ok: true } | { ok: false; errors: Record<string, string>; message?: string };

interface SportSetupFlowProps {
  sportKey: string;
  sportName: string;
  schema: SportSettingsSchema;
  /** The sport's values as the editor holds them (the flow edits a copy). */
  values: SettingsFormValues;
  /** The ONE save: validate → merge → PUT, the editor's state and snapshot updated by the caller. */
  onSave: (values: SettingsFormValues) => Promise<SportSetupSaveResult>;
  onClose: () => void;
}

/**
 * A sport's setup as short steps (Program D, Oct 2026): StepFlow over
 * `stepsForSchema`, each step's fields through the SAME SportSettingsField
 * the one-page form used, a Review step that lists every answer ("Not set"
 * when blank), then ONE Save. Nothing is written before Save; closing with
 * unsaved answers asks first. A full-screen sheet on a phone, a centred
 * panel from `sm`; it sits over the editor (z-[70]) and its confirm above
 * itself (z-[80]).
 */
export default function SportSetupFlow({ sportKey, sportName, schema, values, onSave, onClose }: SportSetupFlowProps) {
  const steps = stepsForSchema(schema, sportName);
  const [index, setIndex] = useState(0);
  const [local, setLocal] = useState<SettingsFormValues>(() => ({ ...values }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isDirty = () => JSON.stringify(local) !== JSON.stringify(values);
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, onClose);

  const step = steps[index] ?? steps[0];
  const fields = schema.fields.filter(f => step.keys.includes(f.key));
  const set = (key: string, value: string) => {
    setLocal(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => { const next = { ...prev }; delete next[key]; return next; });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await onSave(local);
      if (result.ok) {
        onClose();
        return;
      }
      setErrors(result.errors);
      if (result.message) setMessage(result.message);
      const first = Object.keys(result.errors)[0];
      if (first) setIndex(stepIndexForKey(steps, first));
    } finally {
      setSaving(false);
    }
  };

  // Review: every field, set or "Not set", in schema order.
  const display = new Map(settingsToDisplayItems(schema, formValuesToSettings(schema, local)).map(i => [i.key, i.value]));

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={`Set up ${sportName}`} data-sport-setup={sportKey}>
      <ConfirmModal
        isOpen={confirmOpen}
        title={`Discard your ${sportName} setup?`}
        message="What you answered in these steps has not been saved."
        confirmText="Discard"
        cancelText="Keep editing"
        overlayZClass="z-[80]"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      <div className="w-full sm:max-w-md h-[92vh] sm:h-auto sm:max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-surface shadow-xl">
        <div className="flex items-center gap-3 px-4 pt-4">
          <h2 className="flex-1 min-w-0 truncate text-lg font-bold text-primary">{sportName}</h2>
          <button type="button" onClick={requestClose} disabled={saving} className="ea-icon-btn" aria-label="Close" data-sport-setup-close="">
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>
        <StepFlow id={`sport-setup-${sportKey}`} steps={steps} index={index} onIndex={setIndex} finishLabel="Save" onFinish={() => void save()} busy={saving} className="flex-1 min-h-0">
          {step.keys.length > 0 ? (
            <div className="space-y-4 py-2">
              {step.id === 'competitive' && <p className="text-sm text-muted">Shown on your profile, labeled as self-reported. Every answer is optional.</p>}
              {fields.map(field => (
                <SportSettingsField key={field.key} sportKey={sportKey} field={field} values={local} error={errors[field.key]} onChange={set} disabled={saving} />
              ))}
            </div>
          ) : (
            <dl className="divide-y divide-border-subtle py-2" data-sport-setup-review="">
              {schema.fields.map(field => {
                const value = display.get(field.key);
                return (
                  <div key={field.key} className="flex items-baseline justify-between gap-3 py-2 text-sm" data-review-field={field.key}>
                    <dt className="text-secondary">{field.displayLabel ?? field.label}</dt>
                    <dd className={`text-right ${value ? 'font-semibold text-primary' : 'text-faint'}`}>{value ?? 'Not set'}</dd>
                  </div>
                );
              })}
            </dl>
          )}
          {message && <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">{message}</p>}
        </StepFlow>
      </div>
    </div>
  );
}
