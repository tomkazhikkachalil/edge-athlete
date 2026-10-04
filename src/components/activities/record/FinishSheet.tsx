'use client';

import { useState } from 'react';
import { ACTIVITY_TYPE_DEFS, type ActivityType } from '@/lib/activities/catalog';
import { UNIT_METRES, type DistanceUnit } from '@/lib/activities/format';
import type { RecordingPhoto } from '@/lib/activities/record/recording';

/**
 * After Finish: a name, the distance for a timer type (typed, in the
 * athlete's unit), the photos' upload state, then Save — or Discard.
 */
export default function FinishSheet({
  type,
  defaultName,
  unit,
  photos,
  saving,
  error,
  onSave,
  onDiscard,
  onDropFailed,
}: {
  type: ActivityType;
  defaultName: string;
  unit: DistanceUnit;
  photos: RecordingPhoto[];
  saving: boolean;
  error: string | null;
  onSave: (name: string, manualDistanceM: number | null) => void;
  onDiscard: () => void;
  onDropFailed: () => void;
}) {
  const def = ACTIVITY_TYPE_DEFS[type];
  const [name, setName] = useState(defaultName);
  const [distance, setDistance] = useState('');
  const [distUnit, setDistUnit] = useState<DistanceUnit | 'm'>(def.recording === 'timer' && (type === 'swim' || type === 'row') ? 'm' : unit);
  const needsDistance = def.recording === 'timer';
  const pending = photos.filter(p => !p.url && !p.failed).length;
  const failed = photos.filter(p => p.failed).length;
  const parsedDistance = (): number | null => {
    if (!needsDistance) return null;
    const v = Number(distance.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return null;
    return Math.round(distUnit === 'm' ? v : v * UNIT_METRES[distUnit]);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Save your activity" data-record-finish-sheet="">
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl">
        <h2 className="text-lg font-bold text-primary">Save your {def.label.toLowerCase()}</h2>
        <label className="mt-3 block text-sm font-medium text-secondary" htmlFor="record-name">Name</label>
        <input id="record-name" type="text" value={name} onChange={e => setName(e.target.value.slice(0, 120))} className="mt-1 w-full min-h-[44px] rounded-lg border border-border-strong bg-surface px-3 text-base text-primary" />
        {needsDistance && (
          <div className="mt-3">
            <label className="block text-sm font-medium text-secondary" htmlFor="record-distance">Distance</label>
            <div className="mt-1 flex gap-2">
              <input id="record-distance" type="number" inputMode="decimal" min={0} value={distance} onChange={e => setDistance(e.target.value)} placeholder={distUnit === 'm' ? '1500' : '5.0'} className="min-h-[44px] flex-1 rounded-lg border border-border-strong bg-surface px-3 text-base text-primary" data-record-distance-input="" />
              <select value={distUnit} onChange={e => setDistUnit(e.target.value as DistanceUnit | 'm')} className="min-h-[44px] rounded-lg border border-border-strong bg-surface px-2 text-base text-primary" aria-label="Unit">
                <option value="m">m</option>
                <option value="km">km</option>
                <option value="mi">mi</option>
              </select>
            </div>
          </div>
        )}
        {pending > 0 && <p className="mt-3 text-sm text-secondary">Uploading {pending} photo{pending === 1 ? '' : 's'}… Save waits for them.</p>}
        {failed > 0 && (
          <p className="mt-3 text-sm text-red-700 dark:text-red-300">
            {failed} photo{failed === 1 ? '' : 's'} did not upload.{' '}
            <button type="button" onClick={onDropFailed} className="underline font-medium">Save without {failed === 1 ? 'it' : 'them'}</button>
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onDiscard} disabled={saving} className="ea-interactive min-h-[48px] rounded-lg border border-border-strong px-4 text-sm font-medium text-secondary disabled:opacity-50" data-record-discard="">
            Discard
          </button>
          <button
            type="button"
            onClick={() => onSave(name.trim(), parsedDistance())}
            disabled={saving || pending > 0 || failed > 0 || (needsDistance && parsedDistance() === null)}
            className="ea-cta min-h-[48px] flex-1 rounded-lg text-base font-semibold text-white disabled:opacity-50"
            data-record-save=""
          >
            {saving ? 'Saving…' : error ? 'Retry' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
