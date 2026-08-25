'use client';

import Image from 'next/image';
import { useEffect, useRef } from 'react';
import { Award, Bookmark, Check, Dumbbell, Globe, Lock, Play, Timer, TrendingUp } from 'lucide-react';
import { celebratePR } from '@/lib/celebrate';
import {
  formatDuration,
  formatVolume,
  MAX_POST_MEDIA,
  type CollectedMedia,
  type WorkoutSummary,
} from '@/lib/workouts/summary';
import type { PRCandidate } from '@/lib/workouts/pr-detection';

/** State + handlers for the optional "save as routine" card; null hides it. */
export interface RoutineSaveProps {
  name: string;
  onNameChange: (next: string) => void;
  saving: boolean;
  saved: boolean;
  error: string;
  onSave: () => void;
}

interface FinishSummaryProps {
  title: string;
  durationSeconds: number;
  summary: WorkoutSummary;
  prCandidates: PRCandidate[];
  checkedPRs: Set<string>;
  onTogglePR: (metricKey: string) => void;
  onContinue: () => void;
  routineSave: RoutineSaveProps | null;
}

export function FinishSummary({
  title,
  durationSeconds,
  summary,
  prCandidates,
  checkedPRs,
  onTogglePR,
  onContinue,
  routineSave,
}: FinishSummaryProps) {
  // One burst per summary, fired when PR candidates arrive (they load async
  // after the phase flips). Ref-guarded so a re-render can't re-fire; no
  // state involved, so no set-state-in-effect concern.
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (celebratedRef.current || prCandidates.length === 0) return;
    celebratedRef.current = true;
    void celebratePR();
  }, [prCandidates]);

  return (
    <div className="vt-scope max-w-md mx-auto px-4 py-8 space-y-6">
      <div className="text-center">
        {prCandidates.length > 0 ? (
          <div className="ea-reaction-chip w-20 h-20 mx-auto mb-4 rounded-full bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center">
            <Award className="w-10 h-10 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
        ) : (
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center">
            <Dumbbell className="w-8 h-8 text-brand-fg" aria-hidden="true" />
          </div>
        )}
        <h1 className="text-2xl font-bold text-primary">{title || 'Workout Complete'}</h1>
        <p className="text-muted mt-1">
          {prCandidates.length > 0
            ? `New personal ${prCandidates.length === 1 ? 'best' : 'bests'} — huge!`
            : 'Nice work. Here’s the damage:'}
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center vt-card p-4">
          <Timer className="w-4 h-4 text-violet-500 mx-auto mb-1" aria-hidden="true" />
          <div className="text-xl font-bold text-primary">{formatDuration(durationSeconds)}</div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wide">Duration</div>
        </div>
        <div className="text-center vt-card p-4">
          <Dumbbell className="w-4 h-4 text-violet-500 mx-auto mb-1" aria-hidden="true" />
          <div className="text-xl font-bold text-primary">
            {summary.exerciseCount}
            <span className="text-sm text-faint"> / {summary.totalSets}</span>
          </div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wide">Exercises / Sets</div>
        </div>
        <div className="text-center vt-card p-4">
          <TrendingUp className="w-4 h-4 text-violet-500 mx-auto mb-1" aria-hidden="true" />
          <div className="text-xl font-bold text-primary">
            {summary.totalVolumeLbs > 0 ? formatVolume(summary.totalVolumeLbs) : '—'}
          </div>
          <div className="text-xs font-semibold text-muted uppercase tracking-wide">Volume</div>
        </div>
      </div>

      {summary.topLine && (
        <p className="text-center text-sm text-tertiary">
          Top set: <span className="font-semibold text-primary">{summary.topLine}</span>
        </p>
      )}

      {/* PR suggest + confirm */}
      {prCandidates.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Award className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <h2 className="text-base font-bold text-primary">
              Save {prCandidates.length === 1 ? 'it' : 'them'} to your Personal Bests
            </h2>
          </div>
          <div className="space-y-2">
            {prCandidates.map(pr => (
              <label
                key={pr.metricKey}
                className="flex items-center gap-3 bg-surface rounded-xl border border-amber-100 dark:border-amber-800 px-3 py-2.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checkedPRs.has(pr.metricKey)}
                  onChange={() => onTogglePR(pr.metricKey)}
                  className="w-5 h-5 text-amber-600 rounded focus:ring-amber-500"
                />
                <span className="flex-1 text-sm font-semibold text-primary">{pr.metricLabel}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/60 px-2.5 py-0.5 text-sm font-bold text-amber-700 dark:text-amber-300">
                  {pr.valueDisplay}
                </span>
                {pr.previousBest !== null && (
                  <span className="text-xs text-faint">prev {pr.previousBest}</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Save as routine — optional, saves immediately, never blocks Continue */}
      {routineSave && (
        <div className="bg-brand-soft border border-violet-200 dark:border-violet-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Bookmark className="w-5 h-5 text-brand-fg" aria-hidden="true" />
            <h2 className="text-base font-bold text-primary">Save as routine</h2>
          </div>
          <p className="text-xs text-tertiary mb-3">
            Reuse this exercise list next time — sets ready, you fill in the numbers.
          </p>
          {routineSave.saved ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              <Check className="w-4 h-4" aria-hidden="true" />
              Saved — pick it next time you start a workout.
            </p>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={routineSave.name}
                  onChange={e => routineSave.onNameChange(e.target.value.slice(0, 120))}
                  placeholder="Routine name"
                  aria-label="Routine name"
                  className="flex-1 min-w-0 px-3 py-2.5 border border-border-strong rounded-lg text-base bg-surface focus:outline-none"
                />
                <button
                  type="button"
                  onClick={routineSave.onSave}
                  disabled={routineSave.saving}
                  className="shrink-0 px-4 py-2.5 rounded-lg text-sm font-bold text-white bg-brand hover:bg-brand-hover transition-colors disabled:opacity-50"
                >
                  {routineSave.saving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {routineSave.error && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-2">{routineSave.error}</p>
              )}
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onContinue}
        className="vt-pill w-full py-3 bg-brand text-white rounded-full font-bold text-base hover:bg-brand-hover transition-colors"
      >
        Continue
      </button>
    </div>
  );
}

interface ShareStepProps {
  caption: string;
  onCaptionChange: (next: string) => void;
  /** All set media in the workout; selected indices become the post's carousel. */
  mediaOptions: CollectedMedia[];
  selectedMedia: Set<number>;
  onToggleMedia: (index: number) => void;
  sharing: boolean;
  error: string;
  onShare: () => void;
  onKeepPrivate: () => void;
}

export function ShareStep({
  caption,
  onCaptionChange,
  mediaOptions,
  selectedMedia,
  onToggleMedia,
  sharing,
  error,
  onShare,
  onKeepPrivate,
}: ShareStepProps) {
  return (
    <div className="max-w-md mx-auto px-4 py-8 space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-primary">Share your workout?</h1>
        <p className="text-muted mt-1">
          Post it to your feed — or keep it in your private training history.
        </p>
      </div>

      {/* Set media picker — selected clips become the post's photo/video carousel */}
      {mediaOptions.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-sm font-semibold text-primary">Include your clips</p>
            <p className="text-xs text-muted">
              {selectedMedia.size}/{Math.min(mediaOptions.length, MAX_POST_MEDIA)} selected
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {mediaOptions.map((media, index) => {
              const isSelected = selectedMedia.has(index);
              const atCap = !isSelected && selectedMedia.size >= MAX_POST_MEDIA;
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => !atCap && onToggleMedia(index)}
                  disabled={atCap}
                  className={`relative aspect-square rounded-lg overflow-hidden bg-surface-sunken transition-all ${
                    isSelected ? 'ring-2 ring-violet-500' : 'opacity-60 hover:opacity-90'
                  } ${atCap ? 'cursor-not-allowed' : ''}`}
                  aria-label={`${isSelected ? 'Exclude' : 'Include'} ${media.exerciseName} set ${media.setNumber} media`}
                >
                  {media.type === 'video' ? (
                    <>
                      <video src={media.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                        <Play className="w-4 h-4 text-white" fill="currentColor" aria-hidden="true" />
                      </span>
                    </>
                  ) : (
                    <Image src={media.url} alt="" width={96} height={96} className="w-full h-full object-cover" />
                  )}
                  {isSelected && (
                    <span className="absolute top-1 right-1 w-5 h-5 bg-brand rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-white" aria-hidden="true" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {mediaOptions.length > MAX_POST_MEDIA && (
            <p className="text-xs text-faint mt-1.5">
              Posts carry up to {MAX_POST_MEDIA} clips — the first {MAX_POST_MEDIA} were selected.
            </p>
          )}
        </div>
      )}

      <textarea
        value={caption}
        onChange={e => onCaptionChange(e.target.value.slice(0, 2000))}
        rows={3}
        placeholder="How did it go? (optional caption)"
        className="w-full px-4 py-3 border border-border-strong rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
      />

      {error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onShare}
        disabled={sharing}
        className="w-full flex items-center justify-center gap-2 py-3 bg-brand text-white rounded-xl font-bold text-base hover:bg-brand-hover transition-colors disabled:opacity-60"
      >
        {sharing ? (
          <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" aria-hidden="true" />
        ) : (
          <Globe className="w-5 h-5" aria-hidden="true" />
        )}
        Share to Feed
      </button>
      <button
        type="button"
        onClick={onKeepPrivate}
        disabled={sharing}
        className="w-full flex items-center justify-center gap-2 py-3 text-tertiary font-semibold hover:text-primary transition-colors disabled:opacity-60"
      >
        <Lock className="w-4 h-4" aria-hidden="true" />
        Keep private
      </button>
    </div>
  );
}
