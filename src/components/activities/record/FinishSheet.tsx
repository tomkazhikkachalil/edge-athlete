'use client';

import { useMemo, useState, type ReactNode } from 'react';
import SectionInfo from '@/components/SectionInfo';
import { ACTIVITY_TYPE_DEFS, type ActivityType } from '@/lib/activities/catalog';
import { UNIT_METRES, formatDistance, formatDuration, formatPace, type DistanceUnit } from '@/lib/activities/format';
import { encodePolyline, type LatLng } from '@/lib/activities/polyline';
import { routeSvg } from '@/lib/activities/route-svg';
import { requiresManualDistance, type RecordingPhoto, type RecordingReview, type ReviewStep } from '@/lib/activities/record/recording';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import { isClimbScale, summarizeClimbs, type Climb } from '@/lib/activities/climbing';
import FeedToggle from '@/components/posts/FeedToggle';
import FinishDetailsForm, { type FinishFormValue } from '@/components/activities/FinishDetailsForm';
import { unitSystemOf } from '@/lib/activities/units';
import type { TimerFormat } from '@/lib/activities/record/round-timer';

export interface FinishDetails {
  name: string;
  manualDistanceM: number | null;
  /** Post to feed (269): a switch, not an audience — off = saved to Training, no post row. */
  onFeed: boolean;
  caption: string;
  /** Post it as this sport's result; null = the training card. */
  sport: SportKey | null;
  /** Oct 16 2026: effort, notes and the type's own answers (details.ts). */
  answers: FinishFormValue;
}

/**
 * After Finish — two steps (Training fixes PR 6, Oct 21 2026; the ONE review
 * of Oct 9 split as Tom's item 8): the QUESTIONNAIRE (what you did — the route
 * and the numbers — its name, a timer type's distance, the type's questions)
 * then PREVIEW AND POST (the feed switch, "post as", a caption, the card
 * exactly as the feed will show it, Post / Save, Edit one step back, Delete).
 * The step, the caption, the switch and "post as" live ON the recording
 * (`review`, `setReview`) and the answers, the name and the distance reach it
 * as they are typed, so a tab switch or a reload returns to the step as it
 * was. The photos' upload state as before.
 */
export default function FinishSheet({
  type,
  defaultName,
  unit,
  photos,
  saving,
  error,
  summary,
  sportOption,
  accountVisibility,
  onSave,
  onDiscard,
  onDropFailed,
  initial,
  timerFormat = null,
  step,
  review,
  onReview,
  onStep,
  onAnswers,
  onName,
  onDistance,
  initialDistanceM = null,
  preview,
}: {
  type: ActivityType;
  defaultName: string;
  unit: DistanceUnit;
  photos: RecordingPhoto[];
  saving: boolean;
  error: string | null;
  /** The recorder's own totals and the drawn (filtered) route. */
  summary: { distanceM: number; elapsedS: number; movingS: number; route: LatLng[]; /** F5: a pool swim's counted lengths. */ lengths?: number };
  /** The stat-line sport this type may be posted as (sport-bridge.ts), if enabled. */
  sportOption: SportKey | null;
  /** The POSTING account's visibility (self, or the athlete a guardian acts for). */
  accountVisibility: string | null;
  onSave: (details: FinishDetails) => void;
  onDiscard: () => void;
  onDropFailed: () => void;
  /** Program E: the recording's answers (recordingAnswers — the set-up's, the Details sheet's,
   *  the last session's prefill, a climb's scale and climbs). Re-seeds while nothing was touched here. */
  initial: FinishFormValue;
  /** The round timer's format, when one ran — a HIIT's "Format" starts there (A7). */
  timerFormat?: TimerFormat | null;
  /** PR 6: which step shows (the recording's `review.step`, mirrored in the URL by the screen). */
  step: ReviewStep;
  /** PR 6: the caption, the feed switch and "post as" — the recording's. */
  review: RecordingReview;
  onReview: (next: Partial<RecordingReview>) => void;
  /** PR 6: Continue / Edit — the screen pushes the step into history and the recording. */
  onStep: (next: ReviewStep) => void;
  /** PR 6: every answer, the name and a timer type's distance reach the recording as typed. */
  onAnswers: (v: FinishFormValue) => void;
  onName: (name: string) => void;
  onDistance: (metres: number | null) => void;
  initialDistanceM?: number | null;
  /** PR 6: the card exactly as the feed will show it (the screen composes it from the recording). */
  preview: ReactNode;
}) {
  const def = ACTIVITY_TYPE_DEFS[type];
  const [name, setName] = useState(defaultName);
  // F5: a pool swim's distance is prefilled from its counted lengths × the pool (editable).
  const [distUnit, setDistUnit] = useState<DistanceUnit | 'm'>(def.recording === 'timer' && (type === 'swim' || type === 'row') ? 'm' : unit);
  // The typed distance: a pool swim's from its counted lengths × the pool; a reload's from the recording (metres, shown in the unit chosen).
  const [distance, setDistance] = useState(() => {
    if (typeof initialDistanceM === 'number' && initialDistanceM > 0) {
      const u = def.recording === 'timer' && (type === 'swim' || type === 'row') ? 'm' : unit;
      return u === 'm' ? String(Math.round(initialDistanceM)) : String(Math.round((initialDistanceM / UNIT_METRES[u]) * 100) / 100);
    }
    return def.recording === 'timer' && (summary.lengths ?? 0) > 0 && summary.distanceM > 0 ? String(Math.round(summary.distanceM)) : '';
  });
  const onFeed = review.onFeed;
  const caption = review.caption;
  const seed = (from: FinishFormValue): FinishFormValue => ({
    effort: from.effort,
    notes: from.notes,
    // The timer knows the format better than an earlier answer does (Rounds reads as Intervals).
    details: {
      ...from.details,
      ...(type === 'hiit' && timerFormat ? { format: timerFormat === 'rounds' ? 'intervals' : String(timerFormat) } : {}),
    },
  });
  const [answers, setAnswers] = useState<FinishFormValue>(() => seed(initial));
  const sportMissing = type === 'sport_session' && typeof answers.details.sport !== 'string';
  // A late prefill (the last session's choices still arriving) lands only before the athlete touched a question.
  const [touched, setTouched] = useState(false);
  const [seededFrom, setSeededFrom] = useState<FinishFormValue>(initial);
  if (initial !== seededFrom && !touched) {
    setSeededFrom(initial);
    setAnswers(seed(initial));
  }
  const shareAs = review.shareAs;
  const needsDistance = def.recording === 'timer';
  // Oct 16 2026: elliptical, stairs and indoor rides may finish without one.
  const distanceRequired = requiresManualDistance(type);
  // A9: a sport session is saved with its sport.
  const pending = photos.filter(p => !p.url && !p.failed).length;
  const failed = photos.filter(p => p.failed).length;
  const parsedDistance = (): number | null => {
    if (!needsDistance) return null;
    const v = Number(distance.replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return null;
    return Math.round(distUnit === 'm' ? v : v * UNIT_METRES[distUnit]);
  };
  const route = summary.route;
  const drawing = useMemo(() => (route.length >= 2 ? routeSvg(encodePolyline(route), 320, 120, 10) : null), [route]);
  const showDistance = !needsDistance && summary.distanceM > 0;
  const pace = showDistance ? formatPace(summary.distanceM, summary.movingS, type, unit) : null;
  const posting = onFeed;
  // F3: a climbing session's review says what was climbed (the recording's own climbs).
  const climbsLine = (() => {
    if (type !== 'climb' || !isClimbScale(answers.details.scale) || !Array.isArray(answers.details.climbs)) return null;
    const sum = summarizeClimbs(answers.details.scale, answers.details.climbs as Climb[]);
    return sum.climbs > 0 ? `${sum.climbs} · ${sum.sends} sent` : null;
  })();
  const sportName = sportOption ? getSportDefinition(sportOption).display_name : null;
  const label = def.label.toLowerCase();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={`Review your ${label}`} data-record-finish-sheet="">
      <div className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface px-4 pt-4 shadow-xl" data-record-step={step}>
        {step === 'details' ? (<>
        <h2 className="text-lg font-bold text-primary">Nice {label}!</h2>

        {/* What you did — the route and the numbers, before any decision. */}
        <div className="mt-3 rounded-lg border border-border bg-surface-muted p-3" data-record-review-summary="">
          {drawing && (
            <svg viewBox={drawing.viewBox} className="mb-2 h-24 w-full" aria-hidden="true" data-record-review-route="">
              <path d={drawing.d} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="text-brand" />
            </svg>
          )}
          <dl className="flex flex-wrap gap-x-6 gap-y-1">
            {showDistance && (
              <div>
                <dt className="text-xs text-muted">Distance</dt>
                <dd className="text-base font-bold text-primary">{formatDistance(summary.distanceM, unit)}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted">Time</dt>
              <dd className="text-base font-bold text-primary">{formatDuration(summary.elapsedS)}</dd>
            </div>
            {pace && (
              <div>
                <dt className="text-xs text-muted">{pace.label}</dt>
                <dd className="text-base font-bold text-primary">{pace.value}</dd>
              </div>
            )}
            {(summary.lengths ?? 0) > 0 && (
              <div>
                <dt className="text-xs text-muted">Lengths</dt>
                <dd className="text-base font-bold text-primary" data-record-review-lengths={summary.lengths}>{summary.lengths}</dd>
              </div>
            )}
            {climbsLine && (
              <div>
                <dt className="text-xs text-muted">Climbs</dt>
                <dd className="text-base font-bold text-primary" data-record-review-climbs="">{climbsLine}</dd>
              </div>
            )}
          </dl>
        </div>

        <label className="mt-3 block text-sm font-medium text-secondary" htmlFor="record-name">Name</label>
        <input id="record-name" type="text" value={name} onChange={e => { const v = e.target.value.slice(0, 120); setName(v); onName(v); }} className="mt-1 w-full min-h-[44px] rounded-lg border border-border-strong bg-surface px-3 text-base text-primary" />
        {needsDistance && (
          <div className="mt-3">
            <label className="block text-sm font-medium text-secondary" htmlFor="record-distance">Distance{distanceRequired ? '' : ' (optional)'}</label>
            <div className="mt-1 flex gap-2">
              <input id="record-distance" type="number" inputMode="decimal" min={0} value={distance} onChange={e => setDistance(e.target.value)} placeholder={distUnit === 'm' ? '1500' : '5.0'} className="min-h-[44px] flex-1 rounded-lg border border-border-strong bg-surface px-3 text-base text-primary" data-record-distance-input="" />
              <select value={distUnit} onChange={e => setDistUnit(e.target.value as DistanceUnit | 'm')} className="min-h-[44px] rounded-lg border border-border-strong bg-surface px-2 text-base text-primary" aria-label="Unit">
                <option value="m">m</option>
                <option value="km">km</option>
                <option value="mi">mi</option>
              </select>
            </div>
          </div>
        )}

        {/* How it went — every answer optional (activities details, Oct 16 2026). */}
        <div className="mt-4">
          <FinishDetailsForm
            type={type}
            value={answers}
            onChange={v => {
              setTouched(true);
              setAnswers(v);
              onAnswers(v);
            }}
            sys={unitSystemOf(unit)}
            disabled={saving}
          />
        </div>

        {pending > 0 && <p className="mt-3 text-sm text-secondary">Uploading {pending} photo{pending === 1 ? '' : 's'}… Continue waits for them.</p>}
        {failed > 0 && (
          <p className="mt-3 text-sm text-red-700 dark:text-red-300">
            {failed} photo{failed === 1 ? '' : 's'} did not upload.{' '}
            <button type="button" onClick={onDropFailed} className="underline font-medium">Continue without {failed === 1 ? 'it' : 'them'}</button>
          </p>
        )}
        {sportMissing && <p className="mt-3 text-sm text-secondary" data-record-sport-needed="">Choose the sport to save this session.</p>}
        {/* Pinned to the sheet's bottom: the next step is always one tap away. */}
        <div className="sticky bottom-0 -mx-4 mt-4 flex gap-2 border-t border-border bg-surface px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]" data-record-review-actions="">
          <button type="button" onClick={onDiscard} disabled={saving} className="ea-interactive min-h-[48px] rounded-lg border border-border-strong px-4 text-sm font-medium text-red-600 dark:text-red-400 disabled:opacity-50" data-record-discard="">
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              onDistance(parsedDistance());
              onStep('preview');
            }}
            disabled={saving || pending > 0 || failed > 0 || (distanceRequired && parsedDistance() === null) || sportMissing}
            className="ea-cta min-h-[48px] flex-1 rounded-lg text-base font-semibold text-white disabled:opacity-50"
            data-record-continue=""
          >
            Continue
          </button>
        </div>
        </>) : (<>
        <SectionInfo heading="Preview and post" headingClassName="text-lg font-bold text-primary">
          <p>It will be in your Training. This is how it will look on the feed.</p>
        </SectionInfo>

        {/* The one decision: Post to feed on / off (269). Off still lands in Training. */}
        <div className="mt-3">
          <FeedToggle kind="activity" on={onFeed} onChange={v => onReview({ onFeed: v })} place="in Training" accountVisibility={accountVisibility} disabled={saving} />
        </div>

        {posting ? (
          <div className="mt-3 space-y-3">
            {sportOption && sportName && (
              <fieldset className="space-y-2" data-record-share-as={shareAs}>
                <legend className="text-sm font-semibold text-secondary">Post it as</legend>
                <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer min-h-[44px]">
                  <input type="radio" name="record-share-as" value="training" checked={shareAs === 'training'} onChange={() => onReview({ shareAs: 'training' })} className="mt-1" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-primary">Training</span>
                    <span className="block text-xs text-muted">The activity card — route, distance, time, pace.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer min-h-[44px]">
                  <input type="radio" name="record-share-as" value="sport" checked={shareAs === 'sport'} onChange={() => onReview({ shareAs: 'sport' })} className="mt-1" data-record-share-as-sport="" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-primary">A {sportName} result</span>
                    <span className="block text-xs text-muted">A stat line in your {sportName} tab and your performance record.</span>
                  </span>
                </label>
              </fieldset>
            )}
            <label className="block">
              <span className="text-sm font-medium text-secondary">Say something (optional)</span>
              <textarea
                value={caption}
                onChange={e => onReview({ caption: e.target.value.slice(0, 2000) })}
                rows={2}
                maxLength={2000}
                className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base text-primary"
                data-record-caption=""
              />
            </label>
            {/* The preview: the feed's activity card over the recording — nothing to tap until it is posted. */}
            <div className="pointer-events-none rounded-lg border border-border bg-surface p-3" data-record-preview-card="">
              {caption.trim() && <p className="mb-1 text-sm text-primary">{caption}</p>}
              {preview}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-secondary" data-record-preview-off="">Saved to your Training — not on the feed.</p>
        )}

        {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
        {/* Pinned to the sheet's bottom: the decision is always one tap away. */}
        <div className="sticky bottom-0 -mx-4 mt-4 flex gap-2 border-t border-border bg-surface px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]" data-record-review-actions="">
          <button type="button" onClick={() => onStep('details')} disabled={saving} className="ea-interactive min-h-[48px] rounded-lg border border-border-strong px-4 text-sm font-medium text-secondary disabled:opacity-50" data-record-edit="">
            Edit
          </button>
          <button type="button" onClick={onDiscard} disabled={saving} className="ea-interactive min-h-[48px] rounded-lg border border-border-strong px-4 text-sm font-medium text-red-600 dark:text-red-400 disabled:opacity-50" data-record-discard="">
            Delete
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                name: name.trim(),
                manualDistanceM: parsedDistance(),
                onFeed,
                caption,
                sport: posting && shareAs === 'sport' ? sportOption : null,
                answers,
              })
            }
            disabled={saving || pending > 0 || failed > 0 || (distanceRequired && parsedDistance() === null) || sportMissing}
            className="ea-cta min-h-[48px] flex-1 rounded-lg text-base font-semibold text-white disabled:opacity-50"
            data-record-save=""
            data-record-save-feed={onFeed ? 'on' : 'off'}
          >
            {saving ? (posting ? 'Posting…' : 'Saving…') : error ? 'Retry' : posting ? 'Post' : 'Save'}
          </button>
        </div>
        </>)}
      </div>
    </div>
  );
}
