'use client';

import { useEffect, useState } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useUnitSystem } from '@/hooks/useUnitSystem';
import { readingFor, type StatPlateData } from '@/lib/posts/attachment';
import { plateColour } from '@/components/posts/StatPlate';
import { CloseIcon } from '@/components/golf/scoring/icons';

/**
 * The Attach activity picker (Tom's General post spec, Nov 26 2026 — D2,
 * A1): the author's recent logged activities, newest first — finished golf
 * rounds, finished workouts, tracked activities, game stat lines; never one
 * hidden from the profile or marked Only me (GET /api/posts/attachable).
 * One per post: a tap attaches it and closes the picker. Mounted only while
 * open: each opening reads the list afresh.
 */
interface AttachPickerProps {
  onClose: () => void;
  /** The posting profile when acting for an athlete (a guardian); own otherwise. */
  profileId?: string | null;
  /** The activity attached now, drawn as selected. */
  current: StatPlateData | null;
  onPick: (plate: StatPlateData) => void;
}

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; activities: StatPlateData[] };

export default function AttachPicker({ onClose, profileId, current, onPick }: AttachPickerProps) {
  useBodyScrollLock(true);
  const { sys } = useUnitSystem();
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  // Bumped by "Try again": the read runs once more.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/posts/attachable${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`, { credentials: 'include', signal: abort.signal })
      .then(res => (res.ok ? (res.json() as Promise<{ activities?: StatPlateData[] }>) : Promise.reject(new Error(String(res.status)))))
      .then(data => setLoad({ state: 'ready', activities: data.activities ?? [] }))
      .catch((e: { name?: string }) => {
        if (e.name !== 'AbortError') setLoad({ state: 'failed' });
      });
    return () => abort.abort();
  }, [profileId, attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="ea-mech ea-mech-overlay fixed inset-0 z-[60] flex items-center justify-center p-4" data-attach-picker="">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="attach-picker-title"
        className="flex max-h-modal w-full min-w-0 max-w-[400px] flex-col gap-3 rounded-[20px] p-4"
        style={{ backgroundColor: 'var(--mech-panel)', border: '1px solid var(--mech-outline-off)', boxShadow: 'var(--mech-dialog-depth)' }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between">
          <h2 id="attach-picker-title" className="text-lg font-bold text-[color:var(--mech-text)]">Attach activity</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ea-mech-close inline-flex items-center justify-center">
            <CloseIcon size={16} />
          </button>
        </div>

        {load.state === 'loading' && (
          <p role="status" className="py-6 text-center text-sm text-[color:var(--mech-text-soft)]">Loading your activities</p>
        )}
        {load.state === 'failed' && (
          <div className="flex flex-col items-center gap-2 py-4" role="alert">
            <p className="text-sm text-[color:var(--mech-text-soft)]">Your activities did not load.</p>
            <button type="button" onClick={() => { setLoad({ state: 'loading' }); setAttempt(n => n + 1); }} className="ea-mech-btn inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold text-[color:var(--mech-accent-light)]">Try again</button>
          </div>
        )}
        {load.state === 'ready' && load.activities.length === 0 && (
          <p className="py-6 text-center text-sm text-[color:var(--mech-text-soft)]" data-attach-empty="">No finished activities yet</p>
        )}
        {load.state === 'ready' && load.activities.length > 0 && (
          <ul className="ea-mech-scroll -mr-2 flex min-h-0 flex-col gap-2 overflow-y-auto pr-2" data-attach-list="">
            {load.activities.map(plate => {
              const selected = current?.kind === plate.kind && current.id === plate.id;
              const reading = readingFor(plate, sys === 'imperial' ? 'mi' : 'km');
              const colour = plateColour(plate);
              return (
                <li key={`${plate.kind}:${plate.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(plate);
                      onClose();
                    }}
                    aria-pressed={selected}
                    className="ea-mech-btn flex min-h-[64px] w-full min-w-0 items-center gap-3 rounded-[14px] px-3 py-2 text-left"
                    style={selected
                      ? { backgroundColor: 'var(--mech-selected-fill)', boxShadow: 'inset 0 0 0 1.5px var(--mech-selected-border)' }
                      : { backgroundColor: 'var(--mech-tile)' }}
                    data-attach-option={plate.kind}
                  >
                    <span aria-hidden="true" className="h-9 w-1 shrink-0 rounded-full" style={{ backgroundColor: colour }} />
                    <span className="min-w-0 flex-1">
                      <span className="ea-mech-micro block truncate" style={{ color: colour }}>{plate.sport}</span>
                      <span className="block truncate text-sm font-semibold text-[color:var(--mech-text)]">{plate.name}</span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-1">
                      <span className="ea-mech-readout text-xl text-[color:var(--mech-text)]">{reading.headline}</span>
                      {reading.unit && <span className="text-xs text-[color:var(--mech-text-soft)]">{reading.unit}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
