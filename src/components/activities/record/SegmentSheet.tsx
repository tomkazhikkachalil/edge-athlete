'use client';

import { useState } from 'react';
import { SEGMENT_KIND_LABELS, SEGMENT_KINDS, SEGMENT_LABEL_MAX, type SegmentKind } from '@/lib/activities/segments';

/** The second Mark tap: what was that? A dismissed sheet keeps the segment as an interval. */
export default function SegmentSheet({ seconds, onPick, onDismiss }: { seconds: number; onPick: (kind: SegmentKind, label: string | null) => void; onDismiss: () => void }) {
  const [label, setLabel] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" role="dialog" aria-modal="true" aria-label="What was that segment?" data-record-segment-sheet="">
      <button type="button" className="absolute inset-0" aria-label="Keep as an interval" onClick={onDismiss} />
      <div className="relative w-full rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl">
        <h2 className="text-lg font-bold text-primary">
          What was that? <span className="text-secondary font-normal">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
        </h2>
        <div className="mt-3 grid grid-cols-5 gap-2">
          {SEGMENT_KINDS.map(kind => (
            <button
              key={kind}
              type="button"
              onClick={() => onPick(kind, label.trim() || null)}
              className="ea-interactive ea-surface min-h-[56px] rounded-lg text-sm font-semibold text-primary"
              data-record-segment-kind={kind}
            >
              {SEGMENT_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value.slice(0, SEGMENT_LABEL_MAX))}
          placeholder="A name (optional) — Hill, 400s, …"
          className="mt-3 w-full min-h-[44px] rounded-lg border border-border-strong bg-surface px-3 text-base text-primary"
          aria-label="Segment name"
        />
        <button type="button" onClick={onDismiss} className="ea-interactive mt-3 w-full min-h-[44px] rounded-lg text-sm font-medium text-secondary">
          Keep as an interval
        </button>
      </div>
    </div>
  );
}
