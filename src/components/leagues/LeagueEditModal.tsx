'use client';

import { useState } from 'react';
import PlacePicker, { type PlaceValue } from '@/components/PlacePicker';
import ConfirmModal from '@/components/ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useToast } from '@/components/Toast';
import { profileToPlace } from '@/lib/geo/profile-place';
import { COPY } from '@/lib/copy';
import type { LeagueInfo } from '@/app/league/[id]/page';

interface LeagueEditModalProps {
  league: LeagueInfo;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Owner/manager edit for a league: name, description, place. sport_key is
 * immutable in v1 (the PATCH schema has no field for it). Every
 * user-initiated close path goes through requestClose (dirty check); the
 * post-save close calls onSaved/onClose directly — never confirm after a
 * successful save.
 */
export default function LeagueEditModal({ league, onClose, onSaved }: LeagueEditModalProps) {
  const { showError } = useToast();
  // The league's location columns share the profile column names, so the
  // shared mapper applies as its header promised it would.
  const initialPlace = profileToPlace(league);

  const [name, setName] = useState(league.name);
  const [description, setDescription] = useState(league.description ?? '');
  const [place, setPlace] = useState<PlaceValue | null>(initialPlace);
  const [placeText, setPlaceText] = useState(initialPlace?.label ?? '');
  const [saving, setSaving] = useState(false);

  useBodyScrollLock(true);

  const isDirty = () =>
    name !== league.name ||
    description !== (league.description ?? '') ||
    (place?.placeId ?? null) !== (league.place_id ?? null);

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, onClose);

  const save = async () => {
    if (saving) return;
    if (!name.trim()) {
      showError('League', 'Name is required');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (description.trim()) body.description = description.trim();
      // place null clears; only send it when it actually changed so an
      // untouched location stays untouched.
      if ((place?.placeId ?? null) !== (league.place_id ?? null)) {
        body.place = place;
      }
      const response = await fetch(`/api/leagues/${encodeURIComponent(league.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        showError('League', result.error || 'Failed to save');
        return;
      }
      onSaved();
    } catch (e) {
      console.error('League save failed:', e);
      showError('League', 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={requestClose}
        className="absolute inset-0 bg-black/50 cursor-default"
      />
      <div className="relative bg-surface rounded-xl shadow-xl border border-border w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-primary">Edit league</h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="ea-icon-btn text-muted hover:text-primary"
          >
            <i className="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="league-edit-name" className="block text-sm font-medium text-secondary mb-1">
              Name
            </label>
            <input
              id="league-edit-name"
              type="text"
              value={name}
              maxLength={120}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-border-strong rounded-md outline-none"
            />
          </div>

          <div>
            <label htmlFor="league-edit-description" className="block text-sm font-medium text-secondary mb-1">
              Description
            </label>
            <textarea
              id="league-edit-description"
              value={description}
              maxLength={2000}
              rows={4}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-border-strong rounded-md outline-none resize-y"
            />
          </div>

          <div>
            <label htmlFor="league-edit-place" className="block text-sm font-medium text-secondary mb-1">
              Location
            </label>
            <PlacePicker
              id="league-edit-place"
              value={place}
              text={placeText}
              allowFreeText={false}
              placeholder="City or town"
              onChange={(nextPlace, text) => {
                setPlace(nextPlace);
                setPlaceText(text);
              }}
              className="w-full px-3 py-2 border border-border-strong rounded-md outline-none"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={requestClose}
            className="px-4 py-2 text-sm min-h-[40px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-60"
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
        overlayZClass="z-[70]"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </div>
  );
}
