'use client';

/**
 * The ONE avatar upload flow (replaces three near-identical copies on the
 * athlete page, onboarding, and EditProfileTabs). Pick → validate → circle
 * crop in the shared media editor → square 512px jpeg →
 *   immediate mode: POST /api/upload/avatar, then onUploaded(url)
 *   deferred mode:  onFileReady(file) — the caller uploads at save time
 *
 * Render-prop trigger so each surface keeps its own button UI.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useToast } from '@/components/Toast';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';

const AVATAR_EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['1:1'],
  enforcedRatio: '1:1',
  circularPreview: true,
  allowVideo: false,
  maxAssets: 1,
  output: { maxDimension: 512, mime: 'image/jpeg', quality: 0.85 },
};

const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // matches /api/upload/avatar

interface AvatarUploaderProps {
  mode: 'immediate' | 'deferred';
  /** Immediate mode: fired with the new avatar URL after a successful upload. */
  onUploaded?: (avatarUrl: string) => void | Promise<void>;
  /** Deferred mode: fired with the cropped file; caller uploads on save. */
  onFileReady?: (file: File) => void;
  /** Error sink — defaults to the global toast. */
  onError?: (message: string) => void;
  render: (props: { open: () => void; openCamera: () => void; uploading: boolean }) => ReactNode;
}

export default function AvatarUploader({
  mode,
  onUploaded,
  onFileReady,
  onError,
  render,
}: AvatarUploaderProps) {
  // Callback ref into state rather than useRef: `render` is invoked DURING
  // render, so any ref read reachable from the props we hand it trips
  // react-hooks/refs. Holding the element in state removes the ref entirely.
  const [inputEl, setInputEl] = useState<HTMLInputElement | null>(null);
  // Second input for native capture (capture-everywhere round): front camera
  // (`capture="user"` — an avatar is a selfie), broad accept on purpose —
  // pairing `capture` with a narrow MIME list is unreliable on Android. The
  // strict allowlist stays on the library input; validateFiles still guards
  // whatever the camera hands back.
  const [cameraEl, setCameraEl] = useState<HTMLInputElement | null>(null);
  const { showError } = useToast();
  const [pending, setPending] = useState<MediaAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  // Stable identity — an inline [pending] literal would recreate the editor's
  // preview URLs (revoking the old ones) on every parent render
  const editorAssets = useMemo(() => (pending ? [pending] : null), [pending]);

  const reportError = (message: string) =>
    onError ? onError(message) : showError('Avatar upload', message);

  const handlePick = (file: File | undefined) => {
    if (!file) return;
    const { accepted, rejected } = validateFiles([file], {
      maxBytes: AVATAR_MAX_BYTES,
      allowVideo: false,
      maxCount: 1,
    });
    if (rejected.length > 0) {
      reportError(rejected[0].message);
      return;
    }
    setPending({ id: 'avatar', file: accepted[0], kind: 'image' });
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
      formData.append('avatar', result.file);
      const response = await fetch('/api/upload/avatar', { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) {
        reportError(payload.error || 'Failed to upload avatar');
        return;
      }
      await onUploaded?.(payload.avatar_url);
    } catch (err) {
      console.error('Avatar upload failed:', err);
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
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={e => {
          handlePick(e.target.files?.[0]);
          e.target.value = ''; // allow re-selecting the same file
        }}
      />
      <input
        ref={setCameraEl}
        type="file"
        accept="image/*"
        capture="user"
        className="sr-only"
        onChange={e => {
          handlePick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {render({ open, openCamera, uploading })}
      {editorAssets && (
        <MediaEditor
          assets={editorAssets}
          config={AVATAR_EDITOR_CONFIG}
          onDone={handleDone}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
