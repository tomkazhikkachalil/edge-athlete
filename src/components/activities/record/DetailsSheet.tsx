'use client';

/**
 * Details while recording (Program E, Oct 2026): the same questions the
 * Finish asks — effort, notes, the type's own — answered mid-session and
 * kept in the recording. Every change is an event into the engine (an
 * IndexedDB put), so typing is debounced 300 ms and flushed on close. A
 * climb's scale is the log's, never asked here. No store, GPS, wake lock or
 * dirty-close imports (session-retention.test.ts).
 */

import { useEffect, useRef, useState } from 'react';
import type { ActivityType } from '@/lib/activities/catalog';
import type { DistanceUnit } from '@/lib/activities/format';
import type { RecordingAnswers } from '@/lib/activities/record/recording';
import { unitSystemOf } from '@/lib/activities/units';
import FinishDetailsForm from '@/components/activities/FinishDetailsForm';

const DEBOUNCE_MS = 300;

export default function DetailsSheet({ type, value, unit, onChange, onClose }: { type: ActivityType; value: RecordingAnswers; unit: DistanceUnit; onChange: (answers: RecordingAnswers) => void; onClose: () => void }) {
  const [local, setLocal] = useState<RecordingAnswers>(value);
  const pending = useRef<RecordingAnswers | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current) {
      onChange(pending.current);
      pending.current = null;
    }
  };
  const change = (next: RecordingAnswers) => {
    setLocal(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, DEBOUNCE_MS);
  };
  // Unmount flushes what the debounce still holds.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => flushRef.current(), []);
  const close = () => {
    flush();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Details" data-record-details-sheet="">
      <div className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl">
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-lg font-bold text-primary">Details</h2>
          <button type="button" onClick={close} className="ea-icon-btn" aria-label="Done" data-record-details-close="">
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1 text-sm text-secondary">Everything here is optional and saved with the activity.</p>
        <div className="mt-4">
          <FinishDetailsForm type={type} value={local} onChange={change} sys={unitSystemOf(unit)} omit={type === 'climb' ? ['scale'] : undefined} />
        </div>
        <button type="button" onClick={close} className="ea-cta mt-4 min-h-[48px] w-full rounded-lg text-base font-semibold text-white" data-record-details-done="">
          Done
        </button>
      </div>
    </div>
  );
}
