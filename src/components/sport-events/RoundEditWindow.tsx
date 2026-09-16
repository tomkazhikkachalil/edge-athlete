'use client';

import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import LargerWindow from '@/components/bubbles/LargerWindow';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { emptyRoundDraft, roundBodyFrom, roundDraftFrom, validateRoundDraft, type RoundDraft } from '@/lib/sport-events/wizard';
import RoundFields from './RoundFields';
import GameFields from './GameFields';
import type { SportEventSport } from '@/lib/sport-events/types';

/**
 * Add or edit a round from the event page (Events program, phase 2) — the
 * house bottom sheet (LargerWindow: a sheet on a phone, a card from `sm:`)
 * over RoundFields. Validation is the wizard's (validateRoundDraft); Save
 * hands the route body to the shell, which owns the call and the refetch.
 * Closing with unsaved input asks first (useDirtyClose + ConfirmModal).
 */
export interface RoundEditTarget {
  id: string;
  sequence: number;
  scheduled_on: string;
  course_id: string | null;
  course_name: string;
  tee: string | null;
  holes: number;
  starting_hole: number;
}

interface Props {
  /** Phase 4: a team sport's round is a place + a start (GameFields); golf keeps RoundFields. */
  sport?: SportEventSport;
  /** Null = add a new round (`nextSequence` names it). */
  round: RoundEditTarget | null;
  nextSequence: number;
  onClose: () => void;
  onSave: (body: ReturnType<typeof roundBodyFrom>) => Promise<{ ok: boolean; error: string | null }>;
}

export default function RoundEditWindow({ round, nextSequence, onClose, onSave, sport = 'golf' }: Props) {
  const [initial] = useState<RoundDraft>(() => (round ? roundDraftFrom(round) : emptyRoundDraft()));
  const [draft, setDraft] = useState<RoundDraft>(initial);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(initial);
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(dirty, onClose);
  const sequence = round?.sequence ?? nextSequence;

  const save = async () => {
    const r = validateRoundDraft(draft, sport);
    setRefusal(r);
    if (r) return;
    setBusy(true);
    const res = await onSave(roundBodyFrom(draft, sport));
    setBusy(false);
    if (!res.ok) { setRefusal(res.error ?? 'Could not save the round.'); return; }
    // A successful save never asks to discard.
    onClose();
  };

  return (
    <>
      <LargerWindow title={round ? `Round ${sequence}` : `Add round ${sequence}`} subtitle={round ? 'Change the date, the course or the holes' : 'Rounds run in date order'} onClose={requestClose} windowKey="round-edit">
        <div className="space-y-4">
          {sport === 'golf'
            ? <RoundFields value={draft} onChange={patch => setDraft(prev => ({ ...prev, ...patch }))} idPrefix={round ? `round-${round.id}` : 'round-new'} />
            : <GameFields value={draft} onChange={patch => setDraft(prev => ({ ...prev, ...patch }))} idPrefix={round ? `round-${round.id}` : 'round-new'} />}
          {refusal && <p role="alert" className="text-sm text-red-700 dark:text-red-300" data-round-edit-refusal="">{refusal}</p>}
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" onClick={requestClose} className="ea-interactive border border-border-strong text-secondary px-4 min-h-[44px] rounded-lg text-sm font-semibold">Cancel</button>
            <button type="button" onClick={save} disabled={busy} className="ea-cta text-white px-5 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-round-edit-save="">{busy ? 'Saving…' : round ? 'Save round' : 'Add round'}</button>
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
