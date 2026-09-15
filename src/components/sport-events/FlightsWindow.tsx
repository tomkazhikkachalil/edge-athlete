'use client';

import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import LargerWindow from '@/components/bubbles/LargerWindow';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { FLIGHT_COUNT_MAX, FLIGHT_COUNT_MIN, FLIGHT_MAX, planFlights } from '@/lib/sport-events/flights';
import type { ParticipantView } from '@/lib/sport-events/view';

/**
 * The organizer's flights window (Events program, phase 2) — the house
 * bottom sheet: every accepted, playing player with a flight input
 * (20 characters), "Auto-flight by index" (N near-equal flights from the
 * frozen indexes, lowest first — a player with no index is listed for the
 * organizer to place by hand, never guessed), Save = the whole plan in
 * one PUT. Closing with unsaved input asks first.
 */
interface Props {
  players: ParticipantView[];
  onClose: () => void;
  onSave: (assignments: Array<{ participant_id: string; flight: string | null }>) => Promise<{ ok: boolean; error: string | null }>;
}

const INPUT = 'min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-primary text-base';

export default function FlightsWindow({ players, onClose, onSave }: Props) {
  const initial = Object.fromEntries(players.map(p => [p.id, p.flight ?? '']));
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = () => players.some(p => (draft[p.id] ?? '') !== (initial[p.id] ?? ''));
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(dirty, onClose);
  const unindexed = players.filter(p => p.handicap_index === null);

  const auto = () => {
    const plan = planFlights(players.map(p => ({ participantId: p.id, handicapIndex: p.handicap_index })), { mode: 'count', count });
    setDraft(prev => {
      const next = { ...prev };
      for (const a of plan.assignments) next[a.participantId] = a.flight;
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await onSave(players.map(p => ({ participant_id: p.id, flight: (draft[p.id] ?? '').trim() || null })));
    setBusy(false);
    if (!res.ok) { setError(res.error ?? 'Could not save the flights.'); return; }
    onClose();
  };

  return (
    <>
      <LargerWindow title="Flights" subtitle="Each player's flight — the boards rank within it" onClose={requestClose} windowKey="event-flights">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2" data-flights-auto-row="">
            <label className="text-sm text-secondary inline-flex items-center gap-2">
              Flights
              <select value={count} onChange={e => setCount(Number(e.target.value))} className={`${INPUT} text-sm`} aria-label="Number of flights">
                {Array.from({ length: FLIGHT_COUNT_MAX - FLIGHT_COUNT_MIN + 1 }, (_, i) => i + FLIGHT_COUNT_MIN).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" onClick={auto} disabled={players.length - unindexed.length === 0} className="ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-flights-auto="">Auto-flight by index</button>
          </div>
          {unindexed.length > 0 && <p className="text-xs text-muted" data-flights-unindexed="">{unindexed.length === players.length ? 'Nobody has an index yet — set the flights by hand.' : `No index (set by hand): ${unindexed.map(p => p.name).join(', ')}.`}</p>}
          <ul className="divide-y divide-border-subtle">
            {players.map(p => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2" data-flights-row={p.profile_id}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-primary truncate">{p.name}</p>
                  <p className="text-xs text-muted">{p.handicap_index !== null ? `Index ${p.handicap_index}` : 'No index'}</p>
                </div>
                <input
                  value={draft[p.id] ?? ''}
                  onChange={e => setDraft(prev => ({ ...prev, [p.id]: e.target.value }))}
                  maxLength={FLIGHT_MAX}
                  placeholder="—"
                  aria-label={`Flight for ${p.name}`}
                  className={`${INPUT} w-24 text-sm`}
                  data-flight-input={p.profile_id}
                />
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" onClick={requestClose} className="ea-interactive border border-border-strong text-secondary px-4 min-h-[44px] rounded-lg text-sm font-semibold">Cancel</button>
            <button type="button" onClick={save} disabled={busy || !dirty()} className="ea-cta text-white px-5 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-flights-save="">{busy ? 'Saving…' : 'Save flights'}</button>
          </div>
        </div>
      </LargerWindow>
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  );
}
