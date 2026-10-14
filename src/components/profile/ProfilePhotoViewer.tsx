'use client';

/**
 * Tap the profile picture or the cover → see it larger (profile quick fixes
 * PR 4, Oct 14 2026): the house MediaLightbox with ONE item (no counter) and,
 * for the owner, an Edit button in its top bar that opens the ProfilePhotoDoor
 * above it. Viewing is for everyone on all three profile routes; Edit is the
 * owner's (a guardian edits from the guardian console).
 */

import { useState } from 'react';
import MediaLightbox from '@/components/media/MediaLightbox';
import ProfilePhotoDoor from './ProfilePhotoDoor';
import type { ProfilePhotoSlot } from '@/lib/profiles/photo-paths';

export interface ProfilePhotoViewerProps {
  slot: ProfilePhotoSlot;
  src: string;
  alt: string;
  canEdit: boolean;
  targetProfileId?: string;
  /** After an upload or a removal landed — the viewer closes (its item is stale). */
  onChanged?: () => void | Promise<void>;
  onClose: () => void;
}

export default function ProfilePhotoViewer({ slot, src, alt, canEdit, targetProfileId, onChanged, onClose }: ProfilePhotoViewerProps) {
  const [doorOpen, setDoorOpen] = useState(false);
  return (
    <>
      <MediaLightbox
        items={[{ id: `${slot}-photo`, kind: 'image', url: src, alt }]}
        index={0}
        onIndexChange={() => undefined}
        onClose={onClose}
        topAction={canEdit ? (
          <button type="button" onClick={() => setDoorOpen(true)} className="min-h-[44px] px-4 rounded-full bg-white/15 hover:bg-white/25 text-sm font-semibold text-white" aria-label="Edit photo" data-photo-edit={slot}>
            Edit
          </button>
        ) : undefined}
      />
      {doorOpen && (
        <ProfilePhotoDoor
          slot={slot}
          hasPhoto
          mode="immediate"
          targetProfileId={targetProfileId}
          onChanged={async () => { await onChanged?.(); onClose(); }}
          onClose={() => setDoorOpen(false)}
        />
      )}
    </>
  );
}
