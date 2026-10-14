'use client';

/**
 * The ONE door for changing a profile photo (profile quick fixes PR 4, Oct
 * 14 2026) — the picture and the cover alike, from the viewer's Edit button
 * and from Edit profile: a sheet (a bottom sheet on a phone, a centred panel
 * from sm) with Take a new photo (the native camera — front for the picture,
 * rear for the cover; never getUserMedia; it attaches at once since PR 5),
 * Upload a new photo (the library), and, when a photo is set, Adjust the
 * current photo (PR 5, migration 264: the kept original reopens at its
 * stored crop) and Remove the photo (the house ConfirmModal names what is
 * lost; the upload button returns). z-[70]: above the viewer (z-[60]); the
 * editor it opens sits at z-[65] and the confirm at z-[80].
 */

import { useState } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import ProfilePhotoUploader, { PHOTO_SLOTS, type CurrentProfilePhoto } from './ProfilePhotoUploader';
import type { ProfilePhotoSlot } from '@/lib/profiles/photo-paths';
import type { ProfilePhotoPayload } from '@/lib/profiles/photo-recipe';

export interface ProfilePhotoDoorProps {
  slot: ProfilePhotoSlot;
  /** false → only Take / Upload (the slot is empty). */
  hasPhoto: boolean;
  mode: 'immediate' | 'deferred';
  targetProfileId?: string;
  /** The profile whose photo this is (the Adjust read goes through its proxy). */
  profileId?: string;
  /** What the slot holds now — Adjust needs it; without it the row is not offered. */
  current?: CurrentProfilePhoto | null;
  /** Immediate mode: after an upload or a removal landed. */
  onChanged?: () => void | Promise<void>;
  /** Deferred mode: the render, the original and the crop for the caller's save. */
  onPhotoReady?: (payload: ProfilePhotoPayload) => void;
  onClose: () => void;
}

const LOSS: Record<ProfilePhotoSlot, { title: string; message: string }> = {
  avatar: { title: 'Remove profile picture?', message: 'Your profile picture comes off your profile everywhere it shows, and the upload button returns. This cannot be undone.' },
  cover: { title: 'Remove cover photo?', message: 'Your cover photo comes off your profile and the upload button returns. This cannot be undone.' },
};

export default function ProfilePhotoDoor({ slot, hasPhoto, mode, targetProfileId, profileId, current, onChanged, onPhotoReady, onClose }: ProfilePhotoDoorProps) {
  useBodyScrollLock(true);
  const { showError } = useToast();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const def = PHOTO_SLOTS[slot];
  const row = 'ea-interactive flex items-center gap-4 w-full text-left rounded-lg px-4 py-3 min-h-[56px] hover:bg-surface-muted disabled:opacity-60';
  const icon = 'w-10 h-10 rounded-full bg-brand-soft text-brand-fg flex items-center justify-center shrink-0';

  const remove = async () => {
    setRemoving(true);
    try {
      const res = await fetch(def.endpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(targetProfileId ? { targetProfileId } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Could not remove the ${def.noun.toLowerCase()}`);
      setConfirmRemove(false);
      await onChanged?.();
      onClose();
    } catch (e) {
      showError(def.noun, e instanceof Error ? e.message : 'Please try again');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" data-photo-door={slot}>
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={`Change ${def.noun.toLowerCase()}`} className="relative w-full sm:max-w-md bg-surface-raised rounded-t-2xl sm:rounded-2xl shadow-xl modal-sheet-bottom">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-lg font-bold text-primary">{def.noun}</h2>
          <button type="button" onClick={onClose} className="ea-icon-btn text-secondary" aria-label="Close">
            <i className="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>
        <ProfilePhotoUploader
          slot={slot}
          mode={mode}
          targetProfileId={targetProfileId}
          profileId={profileId}
          current={hasPhoto ? current : null}
          onUploaded={async () => { await onChanged?.(); onClose(); }}
          onPhotoReady={payload => { onPhotoReady?.(payload); onClose(); }}
          render={({ open, openCamera, adjust, canAdjust, uploading, busy }) => (
            <div className="px-2 pb-3 space-y-1">
              <button type="button" onClick={openCamera} disabled={uploading || busy} className={row} data-photo-take="">
                <span className={icon}><i className="fas fa-camera" aria-hidden="true"></i></span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-primary">Take a new photo</span>
                  <span className="block text-xs text-muted">With the camera, cropped {slot === 'avatar' ? 'round' : 'to the banner'}.</span>
                </span>
              </button>
              <button type="button" onClick={open} disabled={uploading || busy} className={row} data-photo-upload="">
                <span className={icon}><i className="fas fa-images" aria-hidden="true"></i></span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-primary">Upload a new photo</span>
                  <span className="block text-xs text-muted">From your device. JPG, PNG, GIF, WebP or HEIC.</span>
                </span>
              </button>
              {hasPhoto && canAdjust && (
                <button type="button" onClick={adjust} disabled={uploading || busy} className={row} data-photo-adjust="">
                  <span className={icon}><i className="fas fa-crop-alt" aria-hidden="true"></i></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-primary">Adjust the current photo</span>
                    <span className="block text-xs text-muted">Re-crop or reposition — no need to upload again.</span>
                  </span>
                </button>
              )}
              {hasPhoto && mode === 'immediate' && (
                <button type="button" onClick={() => setConfirmRemove(true)} disabled={uploading || removing || busy} className={row} data-photo-remove="">
                  <span className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0"><i className="fas fa-trash" aria-hidden="true"></i></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-red-600 dark:text-red-400">Remove the photo</span>
                    <span className="block text-xs text-muted">The upload button comes back.</span>
                  </span>
                </button>
              )}
              {(uploading || busy) && <p className="px-4 py-2 text-xs text-muted" aria-live="polite">{uploading ? 'Uploading…' : 'One moment…'}</p>}
            </div>
          )}
        />
      </div>
      <ConfirmModal
        isOpen={confirmRemove}
        title={LOSS[slot].title}
        message={LOSS[slot].message}
        confirmText={removing ? 'Removing…' : 'Remove'}
        cancelText="Keep it"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        overlayZClass="z-[80]"
        onConfirm={() => { if (!removing) void remove(); }}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
