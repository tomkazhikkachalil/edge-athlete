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
 */

import { useRef, useState } from 'react';
import { validateFiles } from '@/lib/media/validation';
import { uploadPostMedia } from '@/lib/media/upload';
import { inferSegment, segmentTimesFromScores, type SegmentTime } from '@/lib/media/segment-autotag';
import { segmentLabel, segmentOptions } from '@/lib/sports/segment-schemas';
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

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setError(null);
    setNotice(null);
    setBusy(true);

    const files = Array.from(fileList).slice(0, MAX_FILES);
    const { accepted, rejected } = validateFiles(files, {
      maxBytes: MAX_BYTES,
      allowVideo: true,
      maxCount: MAX_FILES,
    });
    if (rejected.length) setError(rejected[0].message);

    // "hole" / "inning" / "lap" — the copy follows the sport, like every
    // other segment label in this feature.
    const noun = segmentLabel(sportKey, 1).split(' ')[0].toLowerCase();
    const segmentTimes: SegmentTime[] = segmentTimesFromScores(holeScores);
    let added = 0;
    let guessed = 0;
    const failures: string[] = [];

    for (const file of accepted) {
      try {
        const uploaded = await uploadPostMedia(file);
        // The suggestion. `lastModified` is the best capture time a browser
        // will give us without parsing EXIF; inferSegment declines rather than
        // guessing when it cannot be trusted.
        const inferred = inferSegment(file.lastModified, segmentTimes);
        if (inferred.segment !== null) guessed += 1;

        const res = await fetch(`/api/group-posts/${groupPostId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            media_url: uploaded.url,
            media_type: uploaded.type,
            segment_number: inferred.segment,
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
    if (inputRef.current) inputRef.current.value = '';
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
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 font-bold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
      >
        <i className={`fas ${busy ? 'fa-spinner fa-spin' : 'fa-camera'}`} aria-hidden="true"></i>
        {busy ? 'Adding…' : 'Add photos or videos'}
      </button>

      {notice && <p className="mt-2 text-xs font-semibold text-gray-600">{notice}</p>}
      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
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
    <div className="mt-1 flex items-center gap-1">
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
        className="min-w-0 flex-1 rounded border border-gray-300 px-1 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-violet-500"
      >
        <option value="">Whole round</option>
        {options.map(n => (
          <option key={n} value={n}>
            {segmentLabel(sportKey, n)}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => patch({ is_highlight: !isHighlight })}
        disabled={busy}
        aria-pressed={isHighlight}
        title={isHighlight ? 'Remove as highlight' : 'Set as highlight'}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded ${
          isHighlight ? 'text-violet-600' : 'text-gray-400 hover:text-gray-700'
        }`}
      >
        <i className={`${isHighlight ? 'fas' : 'far'} fa-star text-xs`} aria-hidden="true"></i>
      </button>

      <button
        type="button"
        onClick={remove}
        disabled={busy}
        title="Remove"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:text-red-600"
      >
        <i className="fas fa-trash text-xs" aria-hidden="true"></i>
      </button>
    </div>
  );
}
