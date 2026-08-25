'use client';

/**
 * Adding and curating a round's media AFTER play — the other half of live
 * capture.
 *
 * Live capture already tags exactly, because the app knows which hole you were
 * on. Anything added later has only its capture time, so `inferSegment`
 * SUGGESTS a hole and this UI lets the athlete confirm or change it. That
 * split is deliberate: File.lastModified is not reliably capture time, and a
 * retrospectively entered card carries no positional information at all, so a
 * silent assignment would be confidently wrong some of the time.
 *
 * Picked files route through the shared MediaEditor (same config shape as
 * live capture) before uploading — after-the-fact media is croppable,
 * trimmable and gets a cover frame like everything else.
 */

import { useRef, useState } from 'react';
import { validateFiles } from '@/lib/media/validation';
import { uploadPostMedia } from '@/lib/media/upload';
import { inferSegment, segmentTimesFromScores, type SegmentTime } from '@/lib/media/segment-autotag';
import { segmentLabel, segmentOptions } from '@/lib/sports/segment-schemas';
import { MediaEditor } from '@/components/media-editor';
import ConfirmModal from '@/components/ConfirmModal';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';
import type { SportKey } from '@/lib/sports';

interface RoundMediaManagerProps {
  groupPostId: string;
  /** Names the segment in the copy ("Choose a hole…" vs "Choose an inning…"). */
  sportKey: SportKey;
  /** Per-hole score rows, used to date each segment for auto-tagging. */
  holeScores: Array<{ hole_number?: number | null; created_at?: string | null }> | null | undefined;
  /** Refetch the scorecard after any change. */
  onChanged: () => void;
  disabled?: boolean;
}

const MAX_FILES = 5;
const MAX_BYTES = 50 * 1024 * 1024;

// Same shape as the live-capture surface (ScoreEntryModal) — after-the-fact
// media now goes through the same editor instead of straight to upload.
const EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['free', '1:1', '4:5', '16:9'],
  allowVideo: true, // trim/split/cover via WebCodecs; degrades to pass-through without it
  maxAssets: MAX_FILES,
  output: { maxDimension: 1600, mime: 'image/jpeg', quality: 0.85 },
};

export default function RoundMediaManager({
  groupPostId,
  sportKey,
  holeScores,
  onChanged,
  disabled = false,
}: RoundMediaManagerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Picked files open the shared editor first (crop/filters/trim/cover);
  // upload happens on the editor's Done. null = editor closed.
  const [editorAssets, setEditorAssets] = useState<MediaAsset[] | null>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setError(null);
    setNotice(null);

    const files = Array.from(fileList).slice(0, MAX_FILES);
    const { accepted, rejected } = validateFiles(files, {
      maxBytes: MAX_BYTES,
      allowVideo: true,
      maxCount: MAX_FILES,
    });
    if (rejected.length) setError(rejected[0].message);
    if (accepted.length > 0) {
      setEditorAssets(
        accepted.map(file => ({
          id: `${Date.now()}-${Math.random()}`,
          file,
          kind: file.type.startsWith('video/') ? ('video' as const) : ('image' as const),
        }))
      );
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleEditorDone = async (results: EditedMedia[]) => {
    setEditorAssets(null);
    setBusy(true);

    // "hole" / "inning" / "lap" — the copy follows the sport, like every
    // other segment label in this feature.
    const noun = segmentLabel(sportKey, 1).split(' ')[0].toLowerCase();
    const segmentTimes: SegmentTime[] = segmentTimesFromScores(holeScores);
    let added = 0;
    let guessed = 0;
    const failures: string[] = [];

    for (const result of results) {
      try {
        const uploaded = await uploadPostMedia(result.file);
        // Cover frame from the editor — never blocks the media itself.
        let thumbnailUrl: string | null = null;
        if (result.posterBlob) {
          try {
            const poster = new File([result.posterBlob], 'poster.jpg', { type: 'image/jpeg' });
            thumbnailUrl = (await uploadPostMedia(poster)).url;
          } catch (e) {
            console.warn('Poster upload failed:', e);
          }
        }
        // The suggestion — from the ORIGINAL file's lastModified (the rendered
        // blob's timestamp is "now" and would always be rejected). inferSegment
        // declines rather than guessing when it cannot be trusted.
        const inferred = inferSegment(result.sourceFile.lastModified, segmentTimes);
        if (inferred.segment !== null) guessed += 1;

        const res = await fetch(`/api/group-posts/${groupPostId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            media_url: uploaded.url,
            media_type: uploaded.type,
            segment_number: inferred.segment,
            thumbnail_url: thumbnailUrl,
            duration_seconds: result.durationSeconds,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failures.push(data.error || 'Upload failed');
          continue;
        }
        added += 1;
      } catch (e) {
        // PARTIAL SUCCESS: keep everything that made it. Failing the whole
        // batch because the fourth file died would be worse than useless on a
        // phone connection.
        failures.push(e instanceof Error ? e.message : 'Upload failed');
      }
    }

    if (added > 0) {
      onChanged();
      setNotice(
        guessed > 0
          ? `Added ${added}. ${guessed} tagged automatically — check the ${noun} is right.`
          : `Added ${added}. Choose a ${noun} for each so they show on the scorecard.`
      );
    }
    if (failures.length) setError(`${failures.length} didn't upload. ${failures[0]}`);

    setBusy(false);
  };

  return (
    <div className="mb-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-brand px-4 py-2 font-bold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
      >
        <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-camera'}`} aria-hidden="true"></i>
        {busy ? 'Adding…' : 'Add photos or videos'}
      </button>

      {notice && <p className="mt-2 text-xs font-semibold text-tertiary">{notice}</p>}
      {error && <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>}

      {editorAssets && (
        <MediaEditor
          assets={editorAssets}
          config={EDITOR_CONFIG}
          onDone={handleEditorDone}
          onCancel={() => setEditorAssets(null)}
        />
      )}
    </div>
  );
}

/** Per-item controls: which segment it belongs to, highlight, remove. */
export function RoundMediaItemControls({
  groupPostId,
  mediaId,
  sportKey,
  segment,
  isHighlight,
  onChanged,
}: {
  groupPostId: string;
  mediaId: string;
  sportKey: SportKey;
  segment: number | null;
  isHighlight: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Removing an uploaded file is permanent — never a stray tap
  // (dummy-proofing round).
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/group-posts/${groupPostId}/media/${mediaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/group-posts/${groupPostId}/media/${mediaId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) onChanged();
    } finally {
      setBusy(false);
    }
  };

  const options = segmentOptions(sportKey);

  return (
    // Stacked below sm: in a phone grid column (~80-120px) the select shared a
    // single row with two buttons and collapsed to ~16px — while the global
    // iOS rule (correctly) forces select text to 16px. Give the select its own
    // full-width row instead of shrinking it.
    <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-center">
      <label className="sr-only" htmlFor={`seg-${mediaId}`}>
        Which {segmentLabel(sportKey, 1).split(' ')[0].toLowerCase()} this belongs to
      </label>
      <select
        id={`seg-${mediaId}`}
        value={segment ?? ''}
        disabled={busy}
        onChange={e =>
          patch({ segment_number: e.target.value === '' ? null : Number(e.target.value) })
        }
        className="min-w-0 w-full sm:flex-1 rounded border border-border-strong px-1 py-0.5 text-[11px]"
      >
        <option value="">Whole round</option>
        {options.map(n => (
          <option key={n} value={n}>
            {segmentLabel(sportKey, n)}
          </option>
        ))}
      </select>

      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => patch({ is_highlight: !isHighlight })}
          disabled={busy}
          aria-pressed={isHighlight}
          title={isHighlight ? 'Remove as highlight' : 'Set as highlight'}
          className={`flex h-10 w-10 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded ${
            isHighlight ? 'text-brand-fg' : 'text-faint hover:text-secondary'
          }`}
        >
          <i className={`${isHighlight ? 'fas' : 'far'} fa-star text-xs`} aria-hidden="true"></i>
        </button>

        <button
          type="button"
          onClick={() => setConfirmingRemove(true)}
          disabled={busy}
          title="Remove"
          className="flex h-10 w-10 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded text-faint hover:text-red-600 dark:hover:text-red-400"
        >
          <i className="fas fa-trash text-xs" aria-hidden="true"></i>
        </button>
      </div>

      <ConfirmModal
        isOpen={confirmingRemove}
        title="Remove this media?"
        message="It will be removed from the round for everyone. This can't be undone."
        confirmText="Remove"
        onConfirm={() => {
          setConfirmingRemove(false);
          void remove();
        }}
        onCancel={() => setConfirmingRemove(false)}
      />
    </div>
  );
}
