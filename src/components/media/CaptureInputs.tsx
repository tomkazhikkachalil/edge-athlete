'use client';

/**
 * Headless native-camera capture (capture-everywhere round). Renders the
 * hidden `capture` file inputs and hands the surface `openPhoto` /
 * `openVideo` triggers via children-as-function — headless because the
 * nine surfaces that use this have nine different layouts (a message
 * cluster pinned to 40px, a render-prop avatar, a per-set workout row…)
 * and a fixed row cannot serve them all. Each surface styles its own
 * buttons; this owns only the input mechanics.
 *
 * The composer's rules carry over verbatim:
 * - `capture` is a MOBILE HINT: phones open the native camera (full
 *   sensor quality — Tom's maximize-input steer); desktops fall back to
 *   the file picker. Never getUserMedia.
 * - Value reset on click so re-capturing the "same" file re-fires change.
 * - Capture inputs are SINGLE-file — e2e selectors that need a library
 *   input must keep using `input[type="file"][multiple]`.
 * - `facing`: 'environment' (rear) default; 'user' (front) for selfies
 *   (avatars). Broad `accept="image/*"` on purpose — pairing `capture`
 *   with narrow MIME lists is unreliable on Android.
 *
 * MOUNT-POINT WARNING: an `inert` ancestor swallows programmatic
 * `.click()`. On surfaces with inert-collapsing clusters (MessageInput),
 * mount this at the component root, next to the existing input.
 *
 * THE ONE EXCEPTION TO "never getUserMedia" (Sep 3 2026): `InAppCamera.tsx`
 * is a FALLBACK the composer offers on touch devices when the native photo
 * picker fails inside iOS's own screen (black preview, nothing handed back
 * — iOS 26.6, while the same picker's video capture worked). The quality
 * rule above is unchanged: the native camera stays the primary path.
 */

import { useCallback, useState, type ReactNode } from 'react';

export interface CaptureControls {
  openPhoto: () => void;
  /** Present only when `allowVideo` — surfaces without video never
   *  receive a trigger they must remember not to render. */
  openVideo?: () => void;
}

interface CaptureInputsProps {
  onFiles: (files: FileList) => void;
  allowVideo?: boolean;
  facing?: 'environment' | 'user';
  children: (controls: CaptureControls) => ReactNode;
}

export default function CaptureInputs({
  onFiles,
  allowVideo = false,
  facing = 'environment',
  children,
}: CaptureInputsProps) {
  // Callback ref into state, NOT useRef (the AvatarUploader precedent):
  // `children` is invoked DURING render, so a `ref.current` read reachable
  // from the controls we hand it trips react-hooks/refs. Holding the
  // elements in state removes the ref entirely.
  const [photoEl, setPhotoEl] = useState<HTMLInputElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLInputElement | null>(null);
  const openPhoto = useCallback(() => photoEl?.click(), [photoEl]);
  const openVideo = useCallback(() => videoEl?.click(), [videoEl]);

  return (
    <>
      <input
        ref={setPhotoEl}
        type="file"
        accept="image/*"
        capture={facing}
        className="hidden"
        onClick={e => {
          (e.target as HTMLInputElement).value = '';
        }}
        onChange={e => e.target.files && e.target.files.length > 0 && onFiles(e.target.files)}
      />
      {allowVideo && (
        <input
          ref={setVideoEl}
          type="file"
          accept="video/*"
          capture="environment"
          className="hidden"
          onClick={e => {
            (e.target as HTMLInputElement).value = '';
          }}
          onChange={e => e.target.files && e.target.files.length > 0 && onFiles(e.target.files)}
        />
      )}
      {children({
        openPhoto,
        ...(allowVideo ? { openVideo } : {}),
      })}
    </>
  );
}
