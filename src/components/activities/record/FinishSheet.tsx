'use client';

import { useMemo, useState } from 'react';
import { ACTIVITY_TYPE_DEFS, type ActivityType } from '@/lib/activities/catalog';
import { UNIT_METRES, formatDistance, formatDuration, formatPace, type DistanceUnit } from '@/lib/activities/format';
import { encodePolyline, type LatLng } from '@/lib/activities/polyline';
import { routeSvg } from '@/lib/activities/route-svg';
import type { RecordingPhoto } from '@/lib/activities/record/recording';
import { DEFAULT_CHOICE, type PostChoice } from '@/lib/posts/audience';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import PostChoicePicker from '@/components/posts/PostChoicePicker';

export interface FinishDetails {
  name: string;
  manualDistanceM: number | null;
  choice: PostChoice;
  caption: string;
  /** Post it as this sport's result; null = the training card. */
  sport: SportKey | null;
}

/**
 * After Finish — the ONE review (Oct 9 2026, Tom: "it's not the easiest to
 * identify if you want to post or not"): what you did (the route and the
 * numbers), its name, then ONE decision — Post it (who sees it follows the
 * account) or Only me (kept in Vitals, not on the feed) — and Done. The
 * photos' upload state and Discard as before.
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
}: {
  type: ActivityType;
  defaultName: string;
  unit: DistanceUnit;
  photos: RecordingPhoto[];
  saving: boolean;
  error: string | null;
  /** The recorder's own totals and the drawn (filtered) route. */
  summary: { distanceM: number; elapsedS: number; movingS: number; route: LatLng[] };
  /** The stat-line sport this type may be posted as (sport-bridge.ts), if enabled. */
  sportOption: SportKey | null;
  /** The POSTING account's visibility (self, or the athlete a guardian acts for). */
  accountVisibility: string | null;
  onSave: (details: FinishDetails) => void;
  onDiscard: () => void;
  onDropFailed: () => void;
}) {
  const def = ACTIVITY_TYPE_DEFS[type];
  const [name, setName] = useState(defaultName);
  const [distance, setDistance] = useState('');
  const [distUnit, setDistUnit] = useState<DistanceUnit | 'm'>(def.recording === 'timer' && (type === 'swim' || type === 'row') ? 'm' : unit);
  const [choice, setChoice] = useState<PostChoice>(DEFAULT_CHOICE);
  const [caption, setCaption] = useState('');
  const [shareAs, setShareAs] = useState<'training' | 'sport'>('training');
  const needsDistance = def.recording === 'timer';
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
  const posting = choice === 'post';
  const sportName = sportOption ? getSportDefinition(sportOption).display_name : null;
  const label = def.label.toLowerCase();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={`Review your ${label}`} data-record-finish-sheet="">
      <div className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-surface px-4 pt-4 shadow-xl">
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
          </dl>
        </div>

        <label className="mt-3 block text-sm font-medium text-secondary" htmlFor="record-name">Name</label>
        <input id="record-name" type="text" value={name} onChange={e => setName(e.target.value.slice(0, 120))} className="mt-1 w-full min-h-[44px] rounded-lg border border-border-strong bg-surface px-3 text-base text-primary" />
        {needsDistance && (
          <div className="mt-3">
            <label className="block text-sm font-medium text-secondary" htmlFor="record-distance">Distance</label>
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

        {/* The one decision. */}
        <div className="mt-4">
          <PostChoicePicker value={choice} onChange={setChoice} onlyMePlace="in your Vitals" accountVisibility={accountVisibility} disabled={saving} />
        </div>

        {posting && (
          <div className="mt-3 space-y-3">
            {sportOption && sportName && (
              <fieldset className="space-y-2" data-record-share-as={shareAs}>
                <legend className="text-sm font-semibold text-secondary">Post it as</legend>
                <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer min-h-[44px]">
                  <input type="radio" name="record-share-as" value="training" checked={shareAs === 'training'} onChange={() => setShareAs('training')} className="mt-1" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-primary">Training</span>
                    <span className="block text-xs text-muted">The activity card — route, distance, time, pace.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer min-h-[44px]">
                  <input type="radio" name="record-share-as" value="sport" checked={shareAs === 'sport'} onChange={() => setShareAs('sport')} className="mt-1" data-record-share-as-sport="" />
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
                onChange={e => setCaption(e.target.value)}
                rows={2}
                maxLength={2000}
                className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base text-primary"
                data-record-caption=""
              />
            </label>
          </div>
        )}

        {pending > 0 && <p className="mt-3 text-sm text-secondary">Uploading {pending} photo{pending === 1 ? '' : 's'}… Done waits for them.</p>}
        {failed > 0 && (
          <p className="mt-3 text-sm text-red-700 dark:text-red-300">
            {failed} photo{failed === 1 ? '' : 's'} did not upload.{' '}
            <button type="button" onClick={onDropFailed} className="underline font-medium">Continue without {failed === 1 ? 'it' : 'them'}</button>
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
        {/* Pinned to the sheet's bottom: the decision is always one tap away. */}
        <div className="sticky bottom-0 -mx-4 mt-4 flex gap-2 border-t border-border bg-surface px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]" data-record-review-actions="">
          <button type="button" onClick={onDiscard} disabled={saving} className="ea-interactive min-h-[48px] rounded-lg border border-border-strong px-4 text-sm font-medium text-secondary disabled:opacity-50" data-record-discard="">
            Discard
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                name: name.trim(),
                manualDistanceM: parsedDistance(),
                choice,
                caption,
                sport: posting && shareAs === 'sport' ? sportOption : null,
              })
            }
            disabled={saving || pending > 0 || failed > 0 || (needsDistance && parsedDistance() === null)}
            className="ea-cta min-h-[48px] flex-1 rounded-lg text-base font-semibold text-white disabled:opacity-50"
            data-record-save=""
            data-record-save-choice={choice}
          >
            {saving ? (posting ? 'Posting…' : 'Saving…') : error ? 'Retry' : posting ? 'Post' : 'Save for me'}
          </button>
        </div>
      </div>
    </div>
  );
}
