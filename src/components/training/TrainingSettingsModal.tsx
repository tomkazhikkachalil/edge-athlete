'use client';

import { useState } from 'react';
import SectionInfo from '@/components/SectionInfo';
import { X } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { COPY } from '@/lib/copy';
import { useToast } from '../Toast';
import { formatHeight, validateHeight } from '@/lib/formatters';
import type { WeightUnit } from '@/lib/body-measurement';
import { localDayKey } from '@/lib/calendar/grid';
import {
  DEFAULT_TRAINING_PRIVACY,
  type TrainingAspect,
  type TrainingPrivacy,
} from '@/lib/training-privacy';

/**
 * The Training tab's own quick settings — update height/weight without a trip
 * to Edit Profile. Every save appends a DATED entry to the athlete_vitals
 * timeline (kids grow; the timeline is the point), and the newest-dated
 * entry becomes the Current Body Metrics snapshot. Backdated entries fill history
 * without touching the snapshot — the server decides, we just explain it.
 *
 * DOB/age is deliberately absent: main profile settings only.
 *
 * Mount a FRESH instance per open (conditional render) — state seeds via
 * useState initializers, the EquipmentSettingsModal pattern. House modal
 * shape: max-h-modal flex column, scrolling body, pinned footer; every
 * user close path goes through useDirtyClose.
 */

interface CurrentBodyMetricsSnapshot {
  heightCm: number | null;
  weightDisplay: number | null;
  weightUnit: WeightUnit | null;
}

interface TrainingSettingsModalProps {
  currentBodyMetrics: CurrentBodyMetricsSnapshot;
  /** Owner's current privacy (from GET /api/vitals); null hides the section
   *  (payload predates the field — next refetch supplies it). */
  trainingPrivacy?: TrainingPrivacy | null;
  onClose: () => void;
  /** Called after a successful save; caller refetches. */
  onSaved: () => void;
  /** Opens the workout-routines manager (the caller swaps modals). */
  onManageRoutines?: () => void;
}

const PRIVACY_ASPECTS: Array<{ key: TrainingAspect; label: string; sub: string }> = [
  { key: 'body', label: 'Body measurements', sub: 'Height, weight, and growth history' },
  { key: 'records', label: 'Personal bests & metrics', sub: 'Trophy wall and performance history' },
  { key: 'workouts', label: 'Workouts', sub: 'Workout log and weekly activity' },
];

const today = () => localDayKey(new Date());

export default function TrainingSettingsModal({
  currentBodyMetrics, trainingPrivacy = null, onClose, onSaved, onManageRoutines,
}: TrainingSettingsModalProps) {
  const { showError, showNotice } = useToast();
  const [saving, setSaving] = useState(false);
  const [heightError, setHeightError] = useState('');
  const [weightError, setWeightError] = useState('');

  const seededHeight = currentBodyMetrics.heightCm ? formatHeight(currentBodyMetrics.heightCm) : '';
  const seededWeight =
    currentBodyMetrics.weightDisplay != null ? String(currentBodyMetrics.weightDisplay) : '';
  const seededUnit: WeightUnit = currentBodyMetrics.weightUnit ?? 'lbs';

  const [heightInput, setHeightInput] = useState(seededHeight);
  const [weightInput, setWeightInput] = useState(seededWeight);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(seededUnit);
  const [recordedAt, setRecordedAt] = useState(today());
  const seededPrivacy = trainingPrivacy ?? DEFAULT_TRAINING_PRIVACY;
  const [privacy, setPrivacy] = useState<TrainingPrivacy>(seededPrivacy);

  useBodyScrollLock(true);

  // What actually goes in the payload: a metric is included only when it
  // parses AND differs from the current snapshot — an untouched field must
  // not spawn a duplicate timeline entry.
  const parsedHeightCm = (() => {
    if (!heightInput.trim()) return undefined;
    return validateHeight(heightInput).value;
  })();
  const heightChanged =
    parsedHeightCm !== undefined && parsedHeightCm !== currentBodyMetrics.heightCm;

  const parsedWeight = (() => {
    if (!weightInput.trim()) return undefined;
    const n = parseFloat(weightInput);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  })();
  const weightChanged =
    parsedWeight !== undefined &&
    (parsedWeight !== currentBodyMetrics.weightDisplay || weightUnit !== seededUnit);

  const privacyChanged =
    privacy.hidden !== seededPrivacy.hidden ||
    privacy.body !== seededPrivacy.body ||
    privacy.records !== seededPrivacy.records ||
    privacy.workouts !== seededPrivacy.workouts;

  // Dirty = the user edited a field (raw comparison, so even an invalid
  // draft prompts the discard confirm). The date alone is not dirty.
  const isDirty = () =>
    heightInput !== seededHeight ||
    weightInput !== seededWeight ||
    weightUnit !== seededUnit ||
    privacyChanged;

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } =
    useDirtyClose(isDirty, onClose);

  const canSave = (heightChanged || weightChanged || privacyChanged) && !saving;

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
    if (!heightChanged && !weightChanged && !privacyChanged) return;

    setSaving(true);
    try {
      if (privacyChanged) {
        const privacyRes = await fetch('/api/settings/vitals-privacy', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(privacy),
        });
        if (!privacyRes.ok) {
          const data = await privacyRes.json().catch(() => null);
          throw new Error(data?.error || 'Failed to save privacy settings');
        }
      }

      let anyBackdated = false;
      if (heightChanged || weightChanged) {
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
        anyBackdated = submitted.some(key => !data?.profileUpdated?.[key]);
      }

      // A backdated entry lands in the timeline, not in the numbers on screen.
      if (anyBackdated) showNotice('Added to your timeline', 'Current measurements unchanged — a newer entry exists.');
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
        <SectionInfo
          heading="Update body metrics"
          headingClassName="text-lg font-bold text-primary"
          className="shrink-0 px-4 sm:px-6 py-4 border-b border-border"
          trailing={
            <button
              onClick={requestClose}
              aria-label="Close"
              className="ea-icon-btn inline-flex items-center justify-center"
            >
              <X className="w-5 h-5 text-muted" />
            </button>
          }
        >
          <p>
            Each save adds a permanent dated entry to your timeline; your most
            recent dated entry becomes your current height and weight. Date of
            birth is edited in Edit Profile.
          </p>
        </SectionInfo>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
          <div>
            <label htmlFor="body-metrics-height" className="block text-sm font-semibold text-secondary mb-1.5">
              Height
            </label>
            <input
              id="body-metrics-height"
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
            <label htmlFor="body-metrics-weight" className="block text-sm font-semibold text-secondary mb-1.5">
              Weight
            </label>
            <div className="flex gap-2">
              <input
                id="body-metrics-weight"
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
            <label htmlFor="body-metrics-date" className="block text-sm font-semibold text-secondary mb-1.5">
              Date Recorded
            </label>
            <input
              id="body-metrics-date"
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

          {trainingPrivacy !== null && (
            <div className="border-t border-border-subtle pt-4">
              <SectionInfo as="p" heading="Privacy" label="training privacy" headingClassName="text-sm font-semibold text-primary" dense className="mb-3">
                <p>
                  Your profile can stay public while any of this stays just for
                  you — hide whatever you&rsquo;re not comfortable showing.
                </p>
              </SectionInfo>
              <div className="space-y-2">
                <label className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={privacy.hidden}
                    onChange={() => setPrivacy(p => ({ ...p, hidden: !p.hidden }))}
                    className="w-5 h-5 rounded"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-primary">Hide all of Training</span>
                    <span className="block text-xs text-muted">Only you can see anything on this tab</span>
                  </span>
                </label>
                {PRIVACY_ASPECTS.map(aspect => (
                  <label
                    key={aspect.key}
                    className={`flex items-center gap-3 rounded-xl border border-border px-3 py-2.5 ${
                      privacy.hidden ? 'opacity-50' : 'cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={privacy.hidden || privacy[aspect.key]}
                      disabled={privacy.hidden}
                      onChange={() => setPrivacy(p => ({ ...p, [aspect.key]: !p[aspect.key] }))}
                      className="w-5 h-5 rounded"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-primary">Hide {aspect.label.toLowerCase()}</span>
                      <span className="block text-xs text-muted">{aspect.sub}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {onManageRoutines && (
            <div className="border-t border-border-subtle pt-4">
              <button
                onClick={onManageRoutines}
                className="w-full flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-surface-muted transition-colors"
              >
                <span>
                  <span className="block text-sm font-semibold text-primary">Workout routines</span>
                  <span className="block text-xs text-muted">Saved presets for starting workouts</span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-brand-fg">Manage</span>
              </button>
            </div>
          )}
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
