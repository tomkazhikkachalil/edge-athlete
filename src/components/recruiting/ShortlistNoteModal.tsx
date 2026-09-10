'use client';

import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import LargerWindow from '@/components/bubbles/LargerWindow';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { SHORTLIST_NOTE_MAX } from '@/lib/recruiting/shortlist';

// ── The private note on a shortlisted athlete (R3) ────────────────────────
// A LargerWindow (bottom sheet on phones) with the house dirty-close rule:
// every X / Cancel / backdrop path asks before discarding unsaved text; a
// successful save closes directly.

interface Props {
  athleteName: string;
  initialNote: string | null;
  onSave: (note: string) => Promise<void>;
  onClose: () => void;
}

export default function ShortlistNoteModal({ athleteName, initialNote, onSave, onClose }: Props) {
  const [note, setNote] = useState(initialNote ?? '');
  const [saving, setSaving] = useState(false);
  const isDirty = () => note !== (initialNote ?? '');
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, onClose);

  return (
    <>
      <LargerWindow title={`Note on ${athleteName}`} subtitle="Private to you." onClose={requestClose} windowKey="shortlist-note">
        <label htmlFor="shortlist-note" className="sr-only">Note</label>
        <textarea
          id="shortlist-note"
          rows={5}
          maxLength={SHORTLIST_NOTE_MAX}
          value={note}
          onChange={e => setNote(e.target.value)}
          className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none"
          placeholder="What stood out, what to watch next…"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted">{note.length}/{SHORTLIST_NOTE_MAX}</p>
          <div className="flex gap-2">
            <button type="button" onClick={requestClose} className="min-h-[44px] px-4 rounded-lg border border-border-strong text-sm font-medium text-secondary hover:bg-surface-muted">
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !isDirty()}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave(note);
                  onClose();
                } finally {
                  setSaving(false);
                }
              }}
              className="min-h-[44px] px-4 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </div>
      </LargerWindow>
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        overlayZClass="z-[70]"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  );
}
