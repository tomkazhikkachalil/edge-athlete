'use client';

/**
 * Org site logo upload flow (phase 3 R3) — the AvatarUploader recipe with
 * a square PNG output (jpeg would flatten transparency, and most org
 * crests are transparent PNGs) posted to the org-gated site/logo endpoint.
 * Render-prop trigger so the Website card keeps its own button UI.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useToast } from '@/components/Toast';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';

const LOGO_EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['1:1'],
  enforcedRatio: '1:1',
  circularPreview: false,
  allowVideo: false,
  maxAssets: 1,
  output: { maxDimension: 512, mime: 'image/png', quality: 0.92 }, // quality ignored by PNG encoders
};

const LOGO_MAX_BYTES = 10 * 1024 * 1024; // matches the site/logo endpoint

interface OrgLogoUploaderProps {
  /** The org-gated upload endpoint, e.g. /api/leagues/{id}/site/logo. */
  endpoint: string;
  onUploaded: (logoPath: string) => void | Promise<void>;
  render: (props: { open: () => void; uploading: boolean }) => ReactNode;
}

export default function OrgLogoUploader({ endpoint, onUploaded, render }: OrgLogoUploaderProps) {
  // Callback ref into state rather than useRef — `render` is invoked
  // DURING render (the AvatarUploader lint lesson).
  const [inputEl, setInputEl] = useState<HTMLInputElement | null>(null);
  const { showError } = useToast();
  const [pending, setPending] = useState<MediaAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const editorAssets = useMemo(() => (pending ? [pending] : null), [pending]);

  const handlePick = (file: File | undefined) => {
    if (!file) return;
    const { accepted, rejected } = validateFiles([file], {
      maxBytes: LOGO_MAX_BYTES,
      allowVideo: false,
      maxCount: 1,
    });
    if (rejected.length > 0) {
      showError('Logo upload', rejected[0].message);
      return;
    }
    setPending({ id: 'org-logo', file: accepted[0], kind: 'image' });
  };

  const handleDone = async (results: EditedMedia[]) => {
    setPending(null);
    const result = results[0];
    if (!result) return;
    URL.revokeObjectURL(result.previewUrl);

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('logo', result.file);
      const response = await fetch(endpoint, { method: 'POST', body: formData });
      const payload = await response.json();
      if (!response.ok) {
        showError('Logo upload', payload.error || 'Failed to upload the logo');
        return;
      }
      await onUploaded(payload.logo_path);
    } catch (err) {
      console.error('Logo upload failed:', err);
      showError('Logo upload', 'Upload failed — please try again');
    } finally {
      setUploading(false);
    }
  };

  const open = useCallback(() => inputEl?.click(), [inputEl]);

  return (
    <>
      <input
        ref={setInputEl}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
        aria-label="Site logo file"
        className="sr-only"
        onChange={e => {
          handlePick(e.target.files?.[0]);
          e.target.value = ''; // allow re-selecting the same file
        }}
      />
      {render({ open, uploading })}
      {editorAssets && (
        <MediaEditor
          assets={editorAssets}
          config={LOGO_EDITOR_CONFIG}
          onDone={handleDone}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
