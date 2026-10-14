'use client';

/**
 * The ONE profile-photo upload engine (profile quick fixes PR 4, Oct 14
 * 2026) — AvatarUploader generalised by SLOT, replacing it and
 * CoverPhotoUploader. Pick (library or the native camera) → validate →
 * the crop-only editor in the slot's shape (round 1:1 for the picture, 3:1
 * for the cover — a live preview of the final shape) → a jpeg of the slot's
 * size →
 *   immediate mode: POST the slot's route, then onUploaded(url)
 *   deferred mode:  onFileReady(file) — the caller uploads at save time
 * Render-prop trigger so each surface keeps its own buttons. A guardian
 * passes targetProfileId (the routes' shared acting gate).
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useToast } from '@/components/Toast';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';
import type { ProfilePhotoSlot } from '@/lib/profiles/photo-paths';

export const PHOTO_SLOTS: Record<ProfilePhotoSlot, {
  config: EditorConfig;
  maxBytes: number;
  field: 'avatar' | 'cover';
  endpoint: string;
  urlKey: 'avatar_url' | 'cover_url';
  facing: 'user' | 'environment';
  pickLabel: string;
  takeLabel: string;
  noun: string;
}> = {
  avatar: {
    config: { aspectRatios: ['1:1'], enforcedRatio: '1:1', circularPreview: true, allowVideo: false, maxAssets: 1, tools: ['crop'], output: { maxDimension: 512, mime: 'image/jpeg', quality: 0.85 } },
    maxBytes: 5 * 1024 * 1024, // matches /api/upload/avatar
    field: 'avatar',
    endpoint: '/api/upload/avatar',
    urlKey: 'avatar_url',
    facing: 'user', // a profile picture is a selfie
    pickLabel: 'Choose a profile photo',
    takeLabel: 'Take a profile photo',
    noun: 'Profile photo',
  },
  cover: {
    config: { aspectRatios: ['3:1'], enforcedRatio: '3:1', allowVideo: false, maxAssets: 1, tools: ['crop'], output: { maxDimension: 1500, mime: 'image/jpeg', quality: 0.85 } },
    maxBytes: 10 * 1024 * 1024, // matches /api/upload/cover
    field: 'cover',
    endpoint: '/api/upload/cover',
    urlKey: 'cover_url',
    facing: 'environment', // a cover is scenery
    pickLabel: 'Choose a cover photo',
    takeLabel: 'Take a cover photo',
    noun: 'Cover photo',
  },
};

export interface ProfilePhotoUploaderProps {
  slot: ProfilePhotoSlot;
  mode: 'immediate' | 'deferred';
  /** A guardian acting for a supervised athlete (the routes' acting gate). */
  targetProfileId?: string;
  /** Immediate mode: the new URL after a successful upload. */
  onUploaded?: (url: string) => void | Promise<void>;
  /** Deferred mode: the cropped file; the caller uploads on save. */
  onFileReady?: (file: File) => void;
  /** Error sink — defaults to the global toast. */
  onError?: (message: string) => void;
  render: (props: { open: () => void; openCamera: () => void; uploading: boolean }) => ReactNode;
}

export default function ProfilePhotoUploader({ slot, mode, targetProfileId, onUploaded, onFileReady, onError, render }: ProfilePhotoUploaderProps) {
  const def = PHOTO_SLOTS[slot];
  // Callback refs into state: `render` runs DURING render, so a ref read
  // reachable from its props trips react-hooks/refs.
  const [inputEl, setInputEl] = useState<HTMLInputElement | null>(null);
  const [cameraEl, setCameraEl] = useState<HTMLInputElement | null>(null);
  const { showError } = useToast();
  const [pending, setPending] = useState<MediaAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const editorAssets = useMemo(() => (pending ? [pending] : null), [pending]);

  const reportError = (message: string) => (onError ? onError(message) : showError(def.noun, message));

  const handlePick = (file: File | undefined) => {
    if (!file) return;
    const { accepted, rejected } = validateFiles([file], { maxBytes: def.maxBytes, allowVideo: false, maxCount: 1 });
    if (rejected.length > 0) {
      reportError(rejected[0].message);
      return;
    }
    setPending({ id: slot, file: accepted[0], kind: 'image' });
  };

  const handleDone = async (results: EditedMedia[]) => {
    setPending(null);
    const result = results[0];
    if (!result) return;
    URL.revokeObjectURL(result.previewUrl); // callers refresh from the profile
    if (mode === 'deferred') {
      onFileReady?.(result.file);
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append(def.field, result.file);
      if (targetProfileId) formData.append('targetProfileId', targetProfileId);
      const response = await fetch(def.endpoint, { method: 'POST', body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        reportError(payload.error || `Failed to upload the ${def.noun.toLowerCase()}`);
        return;
      }
      await onUploaded?.(payload[def.urlKey]);
    } catch (err) {
      console.error(`${def.noun} upload failed:`, err);
      reportError('Upload failed — please try again');
    } finally {
      setUploading(false);
    }
  };

  const open = useCallback(() => inputEl?.click(), [inputEl]);
  const openCamera = useCallback(() => cameraEl?.click(), [cameraEl]);

  return (
    <>
      <input
        ref={setInputEl}
        type="file"
        aria-label={def.pickLabel}
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={e => { handlePick(e.target.files?.[0]); e.target.value = ''; }}
      />
      {/* Native capture: broad accept on purpose (capture + a narrow MIME
          list is unreliable on Android); validateFiles still guards it. */}
      <input
        ref={setCameraEl}
        type="file"
        aria-label={def.takeLabel}
        accept="image/*"
        capture={def.facing}
        className="sr-only"
        onChange={e => { handlePick(e.target.files?.[0]); e.target.value = ''; }}
      />
      {render({ open, openCamera, uploading })}
      {editorAssets && (
        <MediaEditor assets={editorAssets} config={def.config} onDone={handleDone} onCancel={() => setPending(null)} />
      )}
    </>
  );
}
