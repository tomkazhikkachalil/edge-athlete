'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Camera, Check, Copy, Play, Plus, StickyNote, Trash2, X } from 'lucide-react';
import { EXERCISE_MAP, type ExerciseInputMode } from '@/lib/workout-config';
import type { EntryExercise, EntrySet, SetMedia } from '@/lib/workouts/entries';
import { MAX_SETS_PER_EXERCISE, MAX_MEDIA_PER_SET } from '@/lib/workouts/entries';
import { useToast } from '../Toast';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import { uploadPostMedia } from '@/lib/media/upload';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';

const SET_MEDIA_EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['free', '1:1', '4:5'],
  allowVideo: true, // trim/split/cover via WebCodecs; degrades to pass-through without it
  maxAssets: MAX_MEDIA_PER_SET,
  output: { maxDimension: 1600, mime: 'image/jpeg', quality: 0.85 },
};
const SET_MEDIA_MAX_BYTES = 50 * 1024 * 1024; // server cap on /api/upload/post-media

export function emptySet(setNumber: number): EntrySet {
  return {
    setNumber,
    reps: null,
    weight: null,
    weightUnit: null,
    durationSeconds: null,
    distance: null,
    distanceUnit: null,
    completedAt: null,
    media: [],
  };
}

function inputModeFor(exercise: EntryExercise): ExerciseInputMode {
  if (exercise.exerciseKey && EXERCISE_MAP[exercise.exerciseKey]) {
    return EXERCISE_MAP[exercise.exerciseKey].inputMode;
  }
  return 'reps_weight';
}

const numOrNull = (raw: string, max: number): number | null => {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, max);
};

interface SetRowProps {
  set: EntrySet;
  inputMode: ExerciseInputMode;
  onChange: (next: EntrySet) => void;
  onDelete: () => void;
}

function SetRow({ set, inputMode, onChange, onDelete }: SetRowProps) {
  const { showError } = useToast();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Latest set for the ASYNC media upload only — it completes after
  // re-renders, and patching from a stale closure would revert concurrent
  // edits. Written in an effect, never during render.
  //
  // Synchronous event handlers do NOT need this: React recreates them each
  // render, so `set` is current by definition at event time. Reading the ref
  // from them was both unnecessary and what react-hooks/refs flagged.
  const setRef = useRef(set);
  useEffect(() => {
    setRef.current = set;
  }, [set]);
  const patch = (partial: Partial<EntrySet>) => onChange({ ...set, ...partial });
  const done = set.completedAt !== null;

  // Per-set media: pick → shared editor → upload immediately (form-check
  // clips between sets), URLs ride inside the set snapshot through draft +
  // sync. Pick-time validation mirrors the server allowlist (was missing
  // entirely — HEIC/oversize used to fail only after the upload). Orphaned
  // files from discarded workouts are handled by the admin storage sweep.
  const [editorAssets, setEditorAssets] = useState<MediaAsset[] | null>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const { accepted, rejected } = validateFiles(Array.from(files), {
      maxBytes: SET_MEDIA_MAX_BYTES,
      allowVideo: true,
      maxCount: MAX_MEDIA_PER_SET,
      existingCount: set.media.length,
    });
    if (rejected.length > 0) {
      showError('File not added', rejected[0].message);
    }
    if (accepted.length > 0) {
      setEditorAssets(
        accepted.map(file => ({
          id: `${Date.now()}-${Math.random()}`,
          file,
          kind: file.type.startsWith('video/') ? 'video' as const : 'image' as const,
        }))
      );
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleEditorDone = async (results: EditedMedia[]) => {
    setEditorAssets(null);
    setUploading(true);
    const added: SetMedia[] = [];
    try {
      for (const result of results) {
        const uploaded = await uploadPostMedia(result.file);
        added.push({ url: uploaded.url, type: uploaded.type });
        URL.revokeObjectURL(result.previewUrl);
      }
    } catch (err) {
      showError('Upload failed', err instanceof Error ? err.message : 'Could not upload media');
    } finally {
      // One onChange with everything that succeeded (partial success kept)
      // The one genuinely async patch: read the LATEST set, not this closure's.
      if (added.length > 0) onChange({ ...setRef.current, media: [...setRef.current.media, ...added] });
      setUploading(false);
    }
  };

  const removeMedia = (index: number) => {
    patch({ media: set.media.filter((_, i) => i !== index) });
  };

  const durationMin = set.durationSeconds !== null ? Math.floor(set.durationSeconds / 60) : null;
  const durationSec = set.durationSeconds !== null ? set.durationSeconds % 60 : null;
  const setDuration = (min: number | null, sec: number | null) => {
    if (min === null && sec === null) {
      patch({ durationSeconds: null });
      return;
    }
    patch({ durationSeconds: (min ?? 0) * 60 + (sec ?? 0) });
  };

  const numberInput = (
    value: number | null,
    onValue: (v: number | null) => void,
    placeholder: string,
    max: number,
    width = 'w-16'
  ) => (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      max={max}
      value={value ?? ''}
      onChange={e => onValue(numOrNull(e.target.value, max))}
      placeholder={placeholder}
      className={`${width} px-1 py-2 min-h-[44px] border border-border-strong rounded-lg text-base text-center focus:outline-none focus:ring-2 focus:ring-violet-500`}
      aria-label={placeholder}
    />
  );

  return (
    <div className={`py-1.5 ${done ? 'opacity-80' : ''}`}>
    {/* items-start + h-11 anchors: if inputs ever wrap (duration/distance
        modes on narrow phones), extra lines stack cleanly under the first
        line instead of floating vertically centered beside the action
        buttons ("weight input off to the bottom" bug). reps/weight are
        FLEXIBLE (min/max range, not fixed) so the common reps_weight mode
        always fits one line even at 360px, where page+card padding leaves
        only ~300px for the whole row. */}
    <div className="flex items-start gap-1.5">
      <span className="w-5 h-11 flex items-center justify-center text-sm font-semibold text-faint shrink-0">
        {set.setNumber}
      </span>

      <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
        {(inputMode === 'reps_weight' || inputMode === 'reps_only') &&
          numberInput(set.reps, v => patch({ reps: v }), 'reps', 1000, 'flex-1 min-w-[2.75rem] max-w-[4.5rem]')}

        {inputMode === 'reps_weight' && (
          <>
            {numberInput(set.weight, v => patch({ weight: v, weightUnit: set.weightUnit ?? 'lbs' }), 'wt', 5000, 'flex-1 min-w-[3rem] max-w-[5rem]')}
            <button
              type="button"
              onClick={() => patch({ weightUnit: set.weightUnit === 'kg' ? 'lbs' : 'kg' })}
              className="px-1 min-h-[44px] min-w-[36px] text-xs font-semibold text-tertiary bg-surface-sunken hover:bg-gray-200 dark:hover:bg-stone-800 rounded-lg transition-colors"
              aria-label="Toggle weight unit"
            >
              {set.weightUnit ?? 'lbs'}
            </button>
          </>
        )}

        {(inputMode === 'duration' || inputMode === 'distance_duration') && (
          <div className="flex items-center gap-1">
            {numberInput(durationMin, v => setDuration(v, durationSec), 'min', 1440, 'w-14')}
            <span className="text-faint text-sm">:</span>
            {numberInput(durationSec, v => setDuration(durationMin, v === null ? null : Math.min(v, 59)), 'sec', 59, 'w-14')}
          </div>
        )}

        {inputMode === 'distance_duration' && (
          <>
            {numberInput(set.distance, v => patch({ distance: v, distanceUnit: set.distanceUnit ?? 'mi' }), 'dist', 1000000, 'w-16')}
            <select
              value={set.distanceUnit ?? 'mi'}
              onChange={e => patch({ distanceUnit: e.target.value as EntrySet['distanceUnit'] })}
              className="px-1 py-2 min-h-[44px] border border-border-strong rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-violet-500"
              aria-label="Distance unit"
            >
              <option value="mi">mi</option>
              <option value="km">km</option>
              <option value="m">m</option>
              <option value="yd">yd</option>
            </select>
          </>
        )}
      </div>

      {/* Attach photo/video to this set */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || set.media.length >= MAX_MEDIA_PER_SET}
        className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-colors ${
          set.media.length > 0
            ? 'bg-violet-100 dark:bg-violet-950/60 text-brand-fg'
            : 'bg-surface-sunken text-faint hover:bg-gray-200 dark:hover:bg-stone-800'
        } disabled:opacity-50`}
        aria-label="Attach photo or video to this set"
      >
        {uploading ? (
          <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-violet-500" aria-hidden="true" />
        ) : (
          <Camera className="w-4 h-4" />
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />

      {/* Complete toggle — stamps completedAt (drives the rest indicator) */}
      <button
        type="button"
        onClick={() => patch({ completedAt: done ? null : new Date().toISOString() })}
        className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-colors ${
          done ? 'bg-emerald-500 text-white' : 'bg-surface-sunken text-faint hover:bg-gray-200 dark:hover:bg-stone-800'
        }`}
        aria-label={done ? 'Mark set incomplete' : 'Mark set complete'}
      >
        <Check className="w-5 h-5" />
      </button>

      <button
        type="button"
        onClick={onDelete}
        className="w-6 h-11 shrink-0 flex items-center justify-center text-gray-300 dark:text-stone-600 hover:text-red-500 transition-colors"
        aria-label="Delete set"
      >
        <X className="w-4 h-4" />
      </button>
    </div>

    {/* Media thumbnails for this set */}
    {set.media.length > 0 && (
      <div className="flex items-center gap-2 mt-1.5 ml-8 flex-wrap">
        {set.media.map((media, index) => (
          <div key={index} className="relative w-12 h-12 rounded-lg overflow-hidden bg-surface-sunken group">
            {media.type === 'video' ? (
              <>
                <video src={media.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                  <Play className="w-4 h-4 text-white" fill="currentColor" aria-hidden="true" />
                </span>
              </>
            ) : (
              <Image src={media.url} alt="Set media" width={48} height={48} className="w-full h-full object-cover" />
            )}
            <button
              type="button"
              onClick={() => removeMedia(index)}
              className="absolute top-0 right-0 w-5 h-5 bg-black/60 text-white rounded-bl-lg flex items-center justify-center hover:bg-red-600 transition-colors"
              aria-label="Remove media"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    )}
    {editorAssets && (
      <MediaEditor
        assets={editorAssets}
        config={SET_MEDIA_EDITOR_CONFIG}
        onDone={handleEditorDone}
        onCancel={() => setEditorAssets(null)}
      />
    )}
    </div>
  );
}

interface ExerciseCardProps {
  exercise: EntryExercise;
  onChange: (next: EntryExercise) => void;
  onDelete: () => void;
}

export default function ExerciseCard({ exercise, onChange, onDelete }: ExerciseCardProps) {
  const inputMode = inputModeFor(exercise);
  const showNotes = exercise.notes !== null;

  const updateSet = (index: number, next: EntrySet) => {
    const sets = exercise.sets.map((s, i) => (i === index ? next : s));
    onChange({ ...exercise, sets });
  };

  const deleteSet = (index: number) => {
    const sets = exercise.sets
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, setNumber: i + 1 }));
    onChange({ ...exercise, sets });
  };

  const addSet = () => {
    if (exercise.sets.length >= MAX_SETS_PER_EXERCISE) return;
    const previous = exercise.sets[exercise.sets.length - 1];
    // Clone copies reps/weight (the common case) but never media — a new
    // set's clip is its own
    const clone: EntrySet = previous
      ? { ...previous, setNumber: exercise.sets.length + 1, completedAt: null, media: [] }
      : emptySet(1);
    onChange({ ...exercise, sets: [...exercise.sets, clone] });
  };

  return (
    <div className="bg-surface rounded-xl border border-border p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-base font-bold text-primary flex-1 min-w-0 truncate">{exercise.name}</h3>
        <button
          type="button"
          onClick={() => onChange({ ...exercise, notes: showNotes ? null : '' })}
          className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
            showNotes ? 'bg-violet-100 dark:bg-violet-950/60 text-brand-fg' : 'text-gray-300 dark:text-stone-600 hover:text-muted'
          }`}
          aria-label="Toggle exercise notes"
        >
          <StickyNote className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-300 dark:text-stone-600 hover:text-red-500 transition-colors"
          aria-label={`Delete ${exercise.name}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {showNotes && (
        <input
          type="text"
          value={exercise.notes ?? ''}
          onChange={e => onChange({ ...exercise, notes: e.target.value.slice(0, 500) })}
          placeholder="Notes (tempo, cues, how it felt…)"
          className="w-full mb-2 px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      )}

      <div className="divide-y divide-gray-50 dark:divide-stone-800">
        {exercise.sets.map((set, index) => (
          <SetRow
            key={index}
            set={set}
            inputMode={inputMode}
            onChange={next => updateSet(index, next)}
            onDelete={() => deleteSet(index)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addSet}
        disabled={exercise.sets.length >= MAX_SETS_PER_EXERCISE}
        className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-surface-muted hover:bg-surface-sunken text-secondary rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
      >
        {exercise.sets.length > 0 ? <Copy className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
        {exercise.sets.length > 0 ? 'Add set (copies last)' : 'Add first set'}
      </button>
    </div>
  );
}
