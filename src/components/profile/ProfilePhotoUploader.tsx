'use client';

/**
 * The ONE profile-photo upload engine (profile quick fixes PR 4, Oct 14
 * 2026) — AvatarUploader generalised by SLOT, replacing it and
 * CoverPhotoUploader. Pick (library or the native camera) → validate →
 * the crop-only editor in the slot's shape (round 1:1 for the picture, 3:1
 * for the cover — a live preview of the final shape) → a jpeg of the slot's
 * size →
 *   immediate mode: POST the slot's route, then onUploaded(url)
 *   deferred mode:  onPhotoReady(payload) — the caller uploads at save time
 * Render-prop trigger so each surface keeps its own buttons. A guardian
 * passes targetProfileId (the routes' shared acting gate).
 *
 * PR 5 (migration 264): the ORIGINAL is kept beside the render, with the
 * crop that made it (photo-recipe.ts). A camera capture ATTACHES AT ONCE —
 * the slot's centred crop, no editor (Capture v2's rule; Adjust is the
 * pencil). "Adjust the current photo" reopens the kept original at its
 * stored crop through the owner-only proxy; Done sends the new render and
 * `sameSource` — the original stays. A photo with no original (set before
 * 264, or by a plain upload) adjusts from the render itself, which then
 * becomes the original: lossy exactly once, never a spiral.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useToast } from '@/components/Toast';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';
import type { ProfilePhotoSlot } from '@/lib/profiles/photo-paths';
import { captureRecipe, parseProfilePhotoRecipe, profileSourceProxyUrl, type ProfilePhotoPayload } from '@/lib/profiles/photo-recipe';
import { assetFromProfilePhoto, prepareProfileSource, profilePhotoFormData } from '@/lib/profiles/photo-upload-client';

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
    config: { aspectRatios: ['1:1'], enforcedRatio: '1:1', circularPreview: true, allowVideo: false, maxAssets: 1, tools: ['crop'], output: { maxDimension: 512, mime: 'image/jpeg', quality: 0.9 } },
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

/** What the slot holds now — for Adjust. `recipe` is the row's envelope (unknown until parsed). */
export interface CurrentProfilePhoto {
  /** The render as displayed (fetchable by the owner: the avatar URL, the cover proxy URL). */
  photoUrl: string | null;
  /** The kept original's stored URL (264), read through the owner-only proxy. */
  sourceUrl: string | null;
  recipe: unknown;
}

export interface ProfilePhotoUploaderProps {
  slot: ProfilePhotoSlot;
  mode: 'immediate' | 'deferred';
  /** A guardian acting for a supervised athlete (the routes' acting gate). */
  targetProfileId?: string;
  /** The profile whose photo this is — names the proxy the kept original is read through. */
  profileId?: string;
  current?: CurrentProfilePhoto | null;
  onUploaded?: (url: string) => void | Promise<void>;
  /** Deferred mode: what the caller POSTs at save time (profilePhotoFormData). */
  onPhotoReady?: (payload: ProfilePhotoPayload) => void;
  onError?: (message: string) => void;
  render: (api: { open: () => void; openCamera: () => void; adjust: () => void; canAdjust: boolean; uploading: boolean; busy: boolean }) => ReactNode;
}

type PendingKind = 'pick' | 'adjust-same' | 'adjust-render';

export default function ProfilePhotoUploader({ slot, mode, targetProfileId, profileId, current, onUploaded, onPhotoReady, onError, render }: ProfilePhotoUploaderProps) {
  const def = PHOTO_SLOTS[slot];
  // Callback refs into state: `render` runs DURING render, so a ref read
  // reachable from its props trips react-hooks/refs.
  const [inputEl, setInputEl] = useState<HTMLInputElement | null>(null);
  const [cameraEl, setCameraEl] = useState<HTMLInputElement | null>(null);
  const { showError } = useToast();
  const [pending, setPending] = useState<{ asset: MediaAsset; kind: PendingKind } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const editorAssets = useMemo(() => (pending ? [pending.asset] : null), [pending]);

  const reportError = (message: string) => (onError ? onError(message) : showError(def.noun, message));

  const finish = async (payload: ProfilePhotoPayload) => {
    if (mode === 'deferred') {
      onPhotoReady?.(payload);
      return;
    }
    setUploading(true);
    try {
      const response = await fetch(def.endpoint, { method: 'POST', body: profilePhotoFormData(slot, payload, targetProfileId) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        reportError(data.error || `Failed to upload the ${def.noun.toLowerCase()}`);
        return;
      }
      await onUploaded?.(data[def.urlKey]);
    } catch (err) {
      console.error(`${def.noun} upload failed:`, err);
      reportError('Upload failed — please try again');
    } finally {
      setUploading(false);
    }
  };

  /** A capture attaches at once: the slot's centred crop, the original kept. The editor only if the decode fails. */
  const attachCapture = async (file: File) => {
    setBusy(true);
    try {
      const [{ decodeImage }, { renderImage }] = await Promise.all([import('@/lib/media/decode'), import('@/lib/media/render')]);
      const decoded = await decodeImage(file);
      const recipe = captureRecipe(slot, decoded.width, decoded.height);
      decoded.close();
      const blob = await renderImage(file, recipe, def.config.output);
      const derived = new File([blob], `${slot}.jpg`, { type: blob.type || def.config.output.mime });
      const source = await prepareProfileSource(file);
      await finish({ file: derived, source, recipe, sameSource: false });
    } catch (err) {
      console.warn(`${def.noun}: capture could not attach at once; opening the editor:`, err);
      setPending({ asset: { id: slot, file, kind: 'image' }, kind: 'pick' });
    } finally {
      setBusy(false);
    }
  };

  const handlePick = (file: File | undefined, fromCamera: boolean) => {
    if (!file) return;
    const { accepted, rejected } = validateFiles([file], { maxBytes: def.maxBytes, allowVideo: false, maxCount: 1 });
    if (rejected.length > 0) {
      reportError(rejected[0].message);
      return;
    }
    if (fromCamera) {
      void attachCapture(accepted[0]);
      return;
    }
    setPending({ asset: { id: slot, file: accepted[0], kind: 'image' }, kind: 'pick' });
  };

  const handleDone = async (results: EditedMedia[]) => {
    const kind = pending?.kind ?? 'pick';
    setPending(null);
    const result = results[0];
    if (!result) return;
    URL.revokeObjectURL(result.previewUrl); // callers refresh from the profile
    const recipe = result.recipe.kind === 'image' ? result.recipe : null;
    if (kind === 'adjust-same') {
      await finish({ file: result.file, source: null, recipe, sameSource: true });
      return;
    }
    setBusy(true);
    let source: File | null = null;
    try {
      source = await prepareProfileSource(result.sourceFile);
    } finally {
      setBusy(false);
    }
    await finish({ file: result.file, source, recipe, sameSource: false });
  };

  const canAdjust = !!(current && (current.sourceUrl || current.photoUrl));
  const adjust = useCallback(() => {
    if (!current || busy) return;
    const proxy = profileId && current.sourceUrl ? profileSourceProxyUrl(profileId, slot, current.sourceUrl) : null;
    const url = proxy ?? current.photoUrl;
    if (!url) return;
    setBusy(true);
    assetFromProfilePhoto(slot, url, proxy ? parseProfilePhotoRecipe(current.recipe) : null)
      .then(asset => setPending({ asset, kind: proxy ? 'adjust-same' : 'adjust-render' }))
      .catch(err => {
        console.warn(`${def.noun}: could not load the current photo:`, err);
        reportError('Could not load the current photo — try again, or upload a new one');
      })
      .finally(() => setBusy(false));
    // reportError closes over props that change every render; the door re-mounts per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, busy, profileId, slot]);

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
        onChange={e => { handlePick(e.target.files?.[0], false); e.target.value = ''; }}
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
        onChange={e => { handlePick(e.target.files?.[0], true); e.target.value = ''; }}
      />
      {render({ open, openCamera, adjust, canAdjust, uploading, busy })}
      {editorAssets && (
        <MediaEditor assets={editorAssets} config={def.config} onDone={handleDone} onCancel={() => setPending(null)} />
      )}
    </>
  );
}
