'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { COPY } from '@/lib/copy';
import { useToast } from '../Toast';
import { formatHeight, validateHeight } from '@/lib/formatters';
import type { WeightUnit } from '@/lib/body-measurement';

/**
 * The Vitals tab's own quick settings — update height/weight without a trip
 * to Edit Profile. Every save appends a DATED entry to the athlete_vitals
 * timeline (kids grow; the timeline is the point), and the newest-dated
 * entry becomes the Current Vitals snapshot. Backdated entries fill history
 * without touching the snapshot — the server decides, we just explain it.
 *
 * DOB/age is deliberately absent: main profile settings only.
 *
 * Mount a FRESH instance per open (conditional render) — state seeds via
 * useState initializers, the EquipmentSettingsModal pattern. House modal
 * shape: max-h-modal flex column, scrolling body, pinned footer; every
 * user close path goes through useDirtyClose.
 */

interface CurrentVitalsSnapshot {
  heightCm: number | null;
  weightDisplay: number | null;
  weightUnit: WeightUnit | null;
}

interface VitalsSettingsModalProps {
  currentVitals: CurrentVitalsSnapshot;
  onClose: () => void;
  /** Called after a successful save; caller refetches. */
  onSaved: () => void;
}

const today = () => new Date().toISOString().split('T')[0];

export default function VitalsSettingsModal({
  currentVitals, onClose, onSaved,
}: VitalsSettingsModalProps) {
  const { showSuccess, showError } = useToast();
  const [saving, setSaving] = useState(false);
  const [heightError, setHeightError] = useState('');
  const [weightError, setWeightError] = useState('');

  const seededHeight = currentVitals.heightCm ? formatHeight(currentVitals.heightCm) : '';
  const seededWeight =
    currentVitals.weightDisplay != null ? String(currentVitals.weightDisplay) : '';
  const seededUnit: WeightUnit = currentVitals.weightUnit ?? 'lbs';

  const [heightInput, setHeightInput] = useState(seededHeight);
  const [weightInput, setWeightInput] = useState(seededWeight);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(seededUnit);
  const [recordedAt, setRecordedAt] = useState(today());

  useBodyScrollLock(true);

  // What actually goes in the payload: a metric is included only when it
  // parses AND differs from the current snapshot — an untouched field must
  // not spawn a duplicate timeline entry.
  const parsedHeightCm = (() => {
    if (!heightInput.trim()) return undefined;
    return validateHeight(heightInput).value;
  })();
  const heightChanged =
    parsedHeightCm !== undefined && parsedHeightCm !== currentVitals.heightCm;

  const parsedWeight = (() => {
    if (!weightInput.trim()) return undefined;
    const n = parseFloat(weightInput);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();
  const weightChanged =
    parsedWeight !== undefined &&
    (parsedWeight !== currentVitals.weightDisplay || weightUnit !== seededUnit);

  // Dirty = the user edited a field (raw comparison, so even an invalid
  // draft prompts the discard confirm). The date alone is not dirty.
  const isDirty = () =>
    heightInput !== seededHeight ||
    weightInput !== seededWeight ||
    weightUnit !== seededUnit;

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } =
    useDirtyClose(isDirty, onClose);

  const canSave = (heightChanged || weightChanged) && !saving;

  const handleSave = async () => {
    setHeightError('');
    setWeightError('');

    // Surface parse errors for touched-but-invalid fields before submitting.
    if (heightInput.trim() && parsedHeightCm === undefined) {
      setHeightError(validateHeight(heightInput).error ?? 'Invalid height');
      return;
    }
    if (weightInput.trim() && parsedWeight === undefined) {
      setWeightError('Enter a weight greater than 0');
      return;
    }
    if (!heightChanged && !weightChanged) return;

    setSaving(true);
    try {
      const response = await fetch('/api/vitals/body-measurement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          recorded_at: recordedAt,
          ...(heightChanged ? { height: { height_cm: parsedHeightCm } } : {}),
          ...(weightChanged ? { weight: { display: parsedWeight, unit: weightUnit } } : {}),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save measurements');
      }

      const submitted = [
        ...(heightChanged ? ['height' as const] : []),
        ...(weightChanged ? ['weight' as const] : []),
      ];
      const anyBackdated = submitted.some(key => !data?.profileUpdated?.[key]);
      showSuccess(
        'Saved',
        anyBackdated
          ? 'Added to your timeline — current vitals unchanged (a newer entry exists).'
          : 'Measurements updated.'
      );
      onSaved();
      // Successful save closes directly — never the discard prompt.
      onClose();
    } catch (e) {
      console.error('Failed to save body measurements:', e);
      showError('Error', e instanceof Error ? e.message : 'Failed to save measurements');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className="bg-surface-raised rounded-xl shadow-xl max-w-md w-full max-h-modal flex flex-col">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border">
          <h2 className="text-lg font-bold text-primary">Update vitals</h2>
          <button
            onClick={requestClose}
            aria-label="Close"
            className="ea-icon-btn inline-flex items-center justify-center"
          >
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
          <div>
            <label htmlFor="vitals-height" className="block text-sm font-semibold text-secondary mb-1.5">
              Height
            </label>
            <input
              id="vitals-height"
              type="text"
              value={heightInput}
              onChange={e => { setHeightInput(e.target.value); setHeightError(''); }}
              placeholder={'5\'10", 5 10, 510, or 5.10'}
              className="w-full px-3 py-2.5 border border-border-strong rounded-lg text-base"
            />
            {heightError ? (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{heightError}</p>
            ) : (
              <p className="text-xs text-faint mt-1">
                Multiple formats accepted: 5&apos;10&quot;, 5 10, 510, 5.10, 6 feet
              </p>
            )}
          </div>

          <div>
            <label htmlFor="vitals-weight" className="block text-sm font-semibold text-secondary mb-1.5">
              Weight
            </label>
            <div className="flex gap-2">
              <input
                id="vitals-weight"
                type="number"
                step="0.1"
                min="0"
                value={weightInput}
                onChange={e => { setWeightInput(e.target.value); setWeightError(''); }}
                placeholder="e.g. 152.5"
                className="flex-1 min-w-0 px-3 py-2.5 border border-border-strong rounded-lg text-base"
              />
              <select
                value={weightUnit}
                onChange={e => setWeightUnit(e.target.value as WeightUnit)}
                aria-label="Weight unit"
                className="px-3 py-2.5 border border-border-strong rounded-lg text-base bg-surface"
              >
                <option value="lbs">lbs</option>
                <option value="kg">kg</option>
                <option value="stone">stone</option>
              </select>
            </div>
            {weightError && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{weightError}</p>
            )}
          </div>

          <div>
            <label htmlFor="vitals-date" className="block text-sm font-semibold text-secondary mb-1.5">
              Date Recorded
            </label>
            <input
              id="vitals-date"
              type="date"
              value={recordedAt}
              max={today()}
              onChange={e => setRecordedAt(e.target.value)}
              className="w-full px-3 py-2.5 border border-border-strong rounded-lg text-sm"
            />
            <p className="text-xs text-faint mt-1">
              You can back-date entries to record historical measurements.
            </p>
          </div>

          <p className="text-xs text-muted border-t border-border-subtle pt-4">
            Each save adds a permanent dated entry to your timeline; your most
            recent dated entry becomes your current height and weight. Date of
            birth is edited in Edit Profile.
          </p>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 px-4 sm:px-6 py-4 border-t border-border bg-surface-muted">
          <button
            onClick={requestClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-secondary bg-surface border border-border-strong hover:bg-surface-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-brand hover:bg-brand-hover transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
        overlayZClass="z-[60]"
      />
    </div>
  );
}
