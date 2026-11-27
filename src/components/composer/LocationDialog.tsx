'use client';

import { useEffect, useState } from 'react';
import PlacePicker, { type PlaceValue } from '@/components/PlacePicker';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { MAX_LOCATION_LABEL, type PostLocation } from '@/lib/posts/location';
import { CloseIcon } from '@/components/golf/scoring/icons';

/**
 * The post's one location (Tom's General post spec, Nov 26 2026 — A10): the
 * app's place search in a mech dialog. A suggestion is taken at once; a
 * place the search does not know (a rink, a course, a gym) is typed and
 * added as written.
 */
interface LocationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onPick: (location: PostLocation) => void;
}

export default function LocationDialog({ isOpen, onClose, onPick }: LocationDialogProps) {
  useBodyScrollLock(isOpen);
  const [text, setText] = useState('');
  const [value, setValue] = useState<PlaceValue | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const typed = text.replace(/\s+/g, ' ').trim();
  const close = () => {
    setText('');
    setValue(null);
    onClose();
  };
  const add = (label: string, placeId: string | null) => {
    onPick({ label: label.slice(0, MAX_LOCATION_LABEL), placeId });
    close();
  };

  return (
    <div className="ea-mech ea-mech-overlay fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[max(1rem,8vh)] sm:items-center sm:pt-4" data-location-dialog="">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-dialog-title"
        className="flex w-full min-w-0 max-w-[400px] flex-col gap-3 rounded-[20px] p-4"
        style={{ backgroundColor: 'var(--mech-panel)', border: '1px solid var(--mech-outline-off)', boxShadow: 'var(--mech-dialog-depth)' }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between">
          <h2 id="location-dialog-title" className="text-lg font-bold text-[color:var(--mech-text)]">Add location</h2>
          <button type="button" onClick={close} aria-label="Close" className="ea-mech-close inline-flex items-center justify-center">
            <CloseIcon size={16} />
          </button>
        </div>
        {/* The list of suggestions opens under the field: the dialog keeps room for it (less on a phone held sideways). */}
        <div className="min-h-[8rem] [@media(min-height:560px)]:min-h-[15rem]">
          <label htmlFor="post-location" className="sr-only">Location</label>
          <PlacePicker
            id="post-location"
            value={value}
            text={text}
            placeholder="City, course, rink or gym"
            onChange={(next, nextText) => {
              if (next) {
                add(next.label, next.placeId);
                return;
              }
              setValue(null);
              setText(nextText.slice(0, MAX_LOCATION_LABEL));
            }}
          />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <button type="button" onClick={close} className="ea-mech-btn inline-flex h-12 items-center rounded-[14px] px-4 text-[15px] font-semibold text-[color:var(--mech-text-soft)]">Cancel</button>
          <button type="button" onClick={() => add(typed, null)} disabled={typed === ''} className="ea-mech-next inline-flex h-12 min-w-[96px] items-center justify-center rounded-[14px] px-4 text-[15px] font-semibold disabled:opacity-40" data-location-add="">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
