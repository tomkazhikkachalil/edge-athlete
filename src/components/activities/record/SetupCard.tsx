'use client';

/**
 * Before Start (Program E, Oct 2026): what will be recorded, the type's own
 * questions (≤ 3, from the layout table), the controls the type sets up —
 * a sport session's map, a round timer to arm, a GPS type's indoor twin —
 * and the name. Start itself stays in the fixed controls bar: always one
 * tap, always in the viewport. This card OWNS NO RULE: every answer is an
 * event into the recording (the engine persists it), read back by the
 * Details sheet, the header line and the Finish through `recordingAnswers`.
 * It never imports the store, the GPS watch, the wake lock or dirty-close
 * (session-retention.test.ts).
 */

import { useState } from 'react';
import { ACTIVITY_TYPE_DEFS, indoorTwin, type ActivityType } from '@/lib/activities/catalog';
import type { DistanceUnit } from '@/lib/activities/format';
import { recordingAnswers, type RecordingEvent, type RecordingState } from '@/lib/activities/record/recording';
import type { RecordLayout, Recorded } from '@/lib/activities/record/layout';
import { clock, TIMER_FORMAT_LABELS, type TimerSpec } from '@/lib/activities/record/round-timer';
import { unitSystemOf } from '@/lib/activities/units';
import FinishDetailsForm from '@/components/activities/FinishDetailsForm';
import { TimerSetup } from './RoundTimerPanel';

const RECORDED_LABEL: Record<Recorded, string> = {
  time: 'Time',
  map: 'Map',
  distance: 'Distance',
  pace: 'Pace',
  speed: 'Speed',
  elevation: 'Elevation',
  descent: 'Descent',
  steps: 'Steps (est.)',
  rounds: 'Rounds',
  lengths: 'Lengths',
  climbs: 'Climbs',
  photos: 'Photos',
};

/** One line for an armed timer: "Tabata · 8 × 0:20 / 0:10". */
export function armedTimerLine(spec: TimerSpec): string {
  const f = TIMER_FORMAT_LABELS[spec.format];
  if (spec.format === 'amrap') return `${f} · ${clock(spec.workS)} cap`;
  if (spec.format === 'emom') return `${f} · ${spec.rounds} min · ${clock(spec.workS)} work`;
  return `${f} · ${spec.rounds} × ${clock(spec.workS)} / ${clock(spec.restS)}`;
}

export default function SetupCard({
  state,
  layout,
  unit,
  gpsType,
  gpsNote,
  geoNote,
  dispatch,
  onChooseAnother,
  onIndoorTwin,
}: {
  state: RecordingState;
  layout: RecordLayout;
  unit: DistanceUnit;
  /** This recording draws a map (a GPS type, or a sport session with its map on). */
  gpsType: boolean;
  gpsNote: string;
  geoNote: string;
  dispatch: (event: RecordingEvent) => void;
  onChooseAnother: () => void;
  onIndoorTwin: (twin: ActivityType) => void;
}) {
  const def = ACTIVITY_TYPE_DEFS[state.type];
  const twin = layout.setup.includes('indoorTwin') ? indoorTwin(state.type) : null;
  const [timerOpen, setTimerOpen] = useState(false);
  const answers = recordingAnswers(state);
  // A sport session records a map and a distance only when its map is on.
  const recorded = layout.records.filter(r => !((r === 'map' || r === 'distance') && def.recording === 'gps_optional' && state.mapOn !== true));

  return (
    <div className="mx-4 mt-4 space-y-4 rounded-xl border border-border bg-surface p-4 text-sm text-secondary" data-record-ready="">
      <div>
        <p className="font-semibold text-primary">What will be recorded</p>
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="What will be recorded" data-record-records="">
          {recorded.map(r => (
            <li key={r} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-secondary" data-record-records-item={r}>
              {RECORDED_LABEL[r]}
            </li>
          ))}
        </ul>
        {gpsType && <p className="mt-2">{gpsNote} {geoNote}</p>}
        {!gpsType && def.recording === 'timer' && <p className="mt-2">A timer runs; you type the distance when you finish.</p>}
      </div>

      {layout.setupFields.length > 0 && (
        <div data-record-setup-questions="">
          <FinishDetailsForm
            type={state.type}
            value={answers}
            onChange={v => dispatch({ type: 'setAnswers', answers: v })}
            sys={unitSystemOf(unit)}
            only={layout.setupFields}
            showEffort={false}
            showNotes={false}
          />
        </div>
      )}

      {layout.setup.includes('map') && (
        // A9: the sport session keeps its toggle whichever way it is set (it can be turned back off).
        <label className="flex min-h-[44px] items-center justify-between gap-3" data-record-map-toggle="">
          <span>
            <span className="block text-primary font-medium">Map my movement</span>
            <span className="block text-xs text-muted">Distance and a map of where you went — a run-heavy practice, a long game.</span>
          </span>
          <input type="checkbox" className="h-6 w-6 shrink-0" checked={state.mapOn === true} onChange={e => dispatch({ type: 'setMap', on: e.target.checked })} />
        </label>
      )}

      {layout.setup.includes('timer') && (
        <div data-record-timer-armed={state.timerArmed ? state.timerArmed.format : 'none'}>
          {state.timerArmed && !timerOpen ? (
            <div className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg bg-surface-muted px-3 py-2">
              <span className="min-w-0">
                <span className="block text-primary font-medium">Round timer</span>
                <span className="block text-xs text-muted" data-record-timer-armed-line="">{armedTimerLine(state.timerArmed)}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button type="button" onClick={() => setTimerOpen(true)} className="ea-interactive min-h-[44px] rounded-lg px-2 text-sm font-semibold text-brand-fg" data-record-timer-change="">
                  Change
                </button>
                <button type="button" onClick={() => dispatch({ type: 'timerSet', spec: null })} className="ea-interactive min-h-[44px] rounded-lg px-2 text-sm font-semibold text-secondary" data-record-timer-remove="">
                  Remove
                </button>
              </span>
            </div>
          ) : timerOpen ? (
            <TimerSetup
              type={state.type}
              arm
              initial={state.timerArmed ?? null}
              onStart={spec => {
                dispatch({ type: 'timerSet', spec });
                setTimerOpen(false);
              }}
              onClose={() => setTimerOpen(false)}
            />
          ) : (
            <button type="button" onClick={() => setTimerOpen(true)} className="ea-interactive ea-surface flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-primary" data-record-timer-arm="">
              <i className="fas fa-bell text-brand-fg" aria-hidden="true"></i>
              Add a round timer
            </button>
          )}
        </div>
      )}

      {layout.setup.includes('name') && (
        <label className="block">
          <span className="text-sm font-medium text-secondary">Name <span className="font-normal text-muted">optional</span></span>
          <input
            type="text"
            value={state.name ?? ''}
            maxLength={120}
            placeholder={`My ${def.label.toLowerCase()}`}
            onChange={e => dispatch({ type: 'setName', name: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base text-primary"
            data-record-name=""
          />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {twin && (
          <button type="button" onClick={() => onIndoorTwin(twin)} className="text-sm font-medium text-brand underline" data-record-indoor-twin={twin}>
            Doing this indoors? Switch to {ACTIVITY_TYPE_DEFS[twin].label}
          </button>
        )}
        <button type="button" onClick={onChooseAnother} className="text-sm font-medium text-brand underline" data-record-choose-another="">
          Choose another activity
        </button>
      </div>
    </div>
  );
}
