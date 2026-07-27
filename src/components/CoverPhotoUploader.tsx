'use client';

/**
 * Profile cover/banner upload — AvatarUploader's sibling: pick → validate →
 * enforced 3:1 crop in the shared media editor → POST /api/upload/cover →
 * onUploaded(url). Render-prop trigger so the profile header owns its
 * button placement.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useToast } from '@/components/Toast';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';

const COVER_EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['3:1'],
  enforcedRatio: '3:1',
  allowVideo: false,
  maxAssets: 1,
  output: { maxDimension: 1500, mime: 'image/jpeg', quality: 0.85 },
};

const COVER_MAX_BYTES = 10 * 1024 * 1024; // matches /api/upload/cover

interface CoverPhotoUploaderProps {
  onUploaded: (coverUrl: string) => void | Promise<void>;
  render: (props: { open: () => void; uploading: boolean }) => ReactNode;
}

export default function CoverPhotoUploader({ onUploaded, render }: CoverPhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { showError } = useToast();
  const [pending, setPending] = useState<MediaAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  // Stable identity — an inline [pending] literal would recreate the editor's
  // preview URLs (revoking the old ones) on every parent render
  const editorAssets = useMemo(() => (pending ? [pending] : null), [pending]);

  const handlePick = (file: File | undefined) => {
    if (!file) return;
    const { accepted, rejected } = validateFiles([file], {
      maxBytes: COVER_MAX_BYTES,
      allowVideo: false,
      maxCount: 1,
    });
    if (rejected.length > 0) {
      showError('Cover photo', rejected[0].message);
      return;
    }
    setPending({ id: 'cover', file: accepted[0], kind: 'image' });
  };

  const handleDone = async (results: EditedMedia[]) => {
    setPending(null);
    const result = results[0];
    if (!result) return;
    URL.revokeObjectURL(result.previewUrl);

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('cover', result.file);
      const response = await fetch('/api/upload/cover', { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) {
        showError('Cover photo', payload.error || 'Failed to upload cover image');
        return;
      }
      await onUploaded(payload.cover_url);
    } catch (err) {
      console.error('Cover upload failed:', err);
      showError('Cover photo', 'Upload failed — please try again');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={e => {
          handlePick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {render({ open: () => inputRef.current?.click(), uploading })}
      {editorAssets && (
        <MediaEditor
          assets={editorAssets}
          config={COVER_EDITOR_CONFIG}
          onDone={handleDone}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
