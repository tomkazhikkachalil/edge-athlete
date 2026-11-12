'use client';

import { Pin } from 'lucide-react';
import { pinKey, type ResolvedPin, type TrainingPin } from '@/lib/training/pins';

/**
 * The pinned showcase at the top of Training's Overview (Training redesign
 * PR 7, Nov 11 2026): up to six bests the athlete chose, each opening its own
 * page. Nothing pinned renders nothing — for the owner too (arranging one's
 * own view is done where the best is, never nagged for here).
 */
export default function PinnedBests({ pins, onOpen }: { pins: ResolvedPin[]; onOpen: (pin: TrainingPin) => void }) {
  if (pins.length === 0) return null;
  return (
    <section data-training-pins={pins.length}>
      <h3 className="flex items-center gap-2 text-sm font-bold text-primary mb-3">
        <Pin className="w-4 h-4 text-brand-fg" aria-hidden="true" />
        Pinned bests
      </h3>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {pins.map(p => (
          <li key={pinKey(p.pin)}>
            <button type="button" onClick={() => onOpen(p.pin)} className="ea-surface ea-interactive block w-full rounded-lg p-3 text-left" data-training-pin={pinKey(p.pin)}>
              <span className="block truncate text-xs font-semibold text-secondary">{p.label}</span>
              <span className="mt-0.5 block truncate text-lg font-bold text-primary tabular-nums">{p.display}</span>
              {p.kindLabel && <span className="block truncate text-xs text-muted">{p.kindLabel}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
