'use client';

/**
 * Tap the profile picture or the cover → see it larger (profile quick fixes
 * PR 4, Oct 14 2026): the house MediaLightbox with ONE item (no counter) and,
 * for the owner, an Edit button in its top bar that opens the ProfilePhotoDoor
 * above it. Viewing is for everyone on all three profile routes; Edit is the
 * owner's (a guardian edits from the guardian console). PR 5: the door's
 * Adjust needs what the slot holds (`current`) and whose photo it is.
 */

import { useState } from 'react';
import MediaLightbox from '@/components/media/MediaLightbox';
import ProfilePhotoDoor from './ProfilePhotoDoor';
import type { CurrentProfilePhoto } from './ProfilePhotoUploader';
import type { ProfilePhotoSlot } from '@/lib/profiles/photo-paths';

export interface ProfilePhotoViewerProps {
  slot: ProfilePhotoSlot;
  src: string;
  alt: string;
  canEdit: boolean;
  targetProfileId?: string;
  /** The profile whose photo this is — the door's Adjust reads its kept original. */
  profileId?: string;
  /** The kept original + crop (264) when the caller has them; the viewer's `src` is the render fallback. */
  current?: Pick<CurrentProfilePhoto, 'sourceUrl' | 'recipe'> | null;
  /** After an upload or a removal landed — the viewer closes (its item is stale). */
  onChanged?: () => void | Promise<void>;
  onClose: () => void;
}

export default function ProfilePhotoViewer({ slot, src, alt, canEdit, targetProfileId, profileId, current, onChanged, onClose }: ProfilePhotoViewerProps) {
  const [doorOpen, setDoorOpen] = useState(false);
  return (
    <>
      <MediaLightbox
        items={[{ id: `${slot}-photo`, kind: 'image', url: src, alt }]}
        index={0}
        onIndexChange={() => undefined}
        onClose={onClose}
        topAction={canEdit ? (
          <button type="button" onClick={() => setDoorOpen(true)} className="min-h-[44px] px-4 rounded-full bg-white/15 hover:bg-white/25 text-sm font-semibold text-white" aria-label="Edit photo" data-photo-edit="">
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
          profileId={profileId}
          current={{ photoUrl: src, sourceUrl: current?.sourceUrl ?? null, recipe: current?.recipe ?? null }}
          onChanged={async () => { await onChanged?.(); onClose(); }}
          onClose={() => setDoorOpen(false)}
        />
      )}
    </>
  );
}
