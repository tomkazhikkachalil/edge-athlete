'use client';

// The round timer on the recorder (activities details A3, Oct 16 2026): set
// up a format, Start (the tap arms the bell), and the screen shows the phase
// in big type while the bell rings at every boundary. The phase is read from
// the RECORDING's clock (round-timer.ts), so a pause pauses it and a locked
// screen never skews it; a bell missed while the page was away rings once on
// return. When the screen cannot be kept awake, it says so — a locked iPhone
// silences the bell.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityType } from '@/lib/activities/catalog';
import { armBell, ringBell } from '@/lib/activities/record/bell';
import { elapsedS, timerEndS, type RecordingState } from '@/lib/activities/record/recording';
import {
  boundaryCrossed,
  clock,
  normalizeSpec,
  PHASE_LABELS,
  phaseAt,
  phaseLine,
  schedule,
  TIMER_FORMAT_HINTS,
  TIMER_FORMAT_LABELS,
  TIMER_FORMATS,
  TIMER_PRESETS,
  type TimerFormat,
  type TimerSpec,
} from '@/lib/activities/record/round-timer';

const PREFS_KEY = 'ea:record:timer:v1';

/** The last spec used for this type, or the format's first preset. */
function rememberedSpec(type: ActivityType): TimerSpec {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, TimerSpec>;
    const s = raw[type];
    if (s && typeof s === 'object' && (TIMER_FORMATS as readonly string[]).includes(s.format)) return normalizeSpec(s);
  } catch {
    // private mode / blocked storage: start from a preset
  }
  return (type === 'hiit' ? TIMER_PRESETS.tabata : TIMER_PRESETS.rounds)[0].spec;
}

function rememberSpec(type: ActivityType, spec: TimerSpec): void {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, TimerSpec>;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...raw, [type]: spec }));
  } catch {
    // the choice lasts this page only
  }
}

function DurationField({ label, value, onChange, min = 0, field }: { label: string; value: number; onChange: (s: number) => void; min?: number; field: string }) {
  const m = Math.floor(value / 60);
  const s = value % 60;
  const set = (mm: number, ss: number) => onChange(Math.max(min, (Number.isFinite(mm) ? mm : 0) * 60 + (Number.isFinite(ss) ? ss : 0)));
  return (
    <fieldset className="min-w-0" data-timer-field={field}>
      <legend className="text-xs font-medium text-secondary">{label}</legend>
      <div className="mt-1 flex items-center gap-1">
        <input type="number" inputMode="numeric" min={0} max={60} value={m} onChange={e => set(Number(e.target.value), s)} aria-label={`${label} minutes`} className="min-h-[44px] w-14 rounded-lg border border-border-strong bg-surface px-2 text-base text-primary tabular-nums" />
        <span className="text-secondary">:</span>
        <input type="number" inputMode="numeric" min={0} max={59} value={String(s).padStart(2, '0')} onChange={e => set(m, Math.min(59, Number(e.target.value)))} aria-label={`${label} seconds`} className="min-h-[44px] w-14 rounded-lg border border-border-strong bg-surface px-2 text-base text-primary tabular-nums" />
      </div>
    </fieldset>
  );
}

/**
 * The timer's set-up. Mid-session (the panel below) its button STARTS the
 * timer and arms the bell in that tap; on the set-up card (Program E) it
 * ARMS a spec for Start — `arm` names that mode, and the Start tap arms the
 * bell instead.
 */
export function TimerSetup({ type, onStart, onClose, initial, arm = false }: { type: ActivityType; onStart: (spec: TimerSpec) => void; onClose: () => void; initial?: TimerSpec | null; arm?: boolean }) {
  const [spec, setSpec] = useState<TimerSpec>(() => initial ?? rememberedSpec(type));
  const pickFormat = (f: TimerFormat) => setSpec(TIMER_PRESETS[f][0].spec);
  const edit = (patch: Partial<TimerSpec>) => setSpec(s => normalizeSpec({ ...s, ...patch }));
  const f = spec.format;
  return (
    <div className="mx-4 mt-4 rounded-xl border border-border bg-surface p-4" data-record-timer-setup={f}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-primary">Round timer</h2>
        <button type="button" onClick={onClose} className="ea-icon-btn inline-flex items-center justify-center text-secondary" aria-label="Close the timer">
          <i className="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Format">
        {TIMER_FORMATS.map(x => (
          <button
            key={x}
            type="button"
            role="radio"
            aria-checked={f === x}
            onClick={() => pickFormat(x)}
            className={`ea-interactive min-h-[44px] rounded-lg border px-2 text-sm font-semibold ${f === x ? 'border-brand bg-brand-soft text-brand-fg' : 'border-border text-primary'}`}
            data-timer-format={x}
          >
            {TIMER_FORMAT_LABELS[x]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-secondary">{TIMER_FORMAT_HINTS[f]}</p>
      {TIMER_PRESETS[f].length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {TIMER_PRESETS[f].map(p => (
            <button key={p.label} type="button" onClick={() => setSpec(p.spec)} className="ea-interactive min-h-[44px] rounded-full border border-border px-3 text-sm text-primary" data-timer-preset={p.label}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      {f !== 'tabata' && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-3">
          {f !== 'amrap' && (
            <label className="block min-w-0">
              <span className="text-xs font-medium text-secondary">{f === 'emom' ? 'Minutes' : 'Rounds'}</span>
              <input type="number" inputMode="numeric" min={1} max={60} value={spec.rounds} onChange={e => edit({ rounds: Number(e.target.value) })} className="mt-1 block min-h-[44px] w-20 rounded-lg border border-border-strong bg-surface px-2 text-base text-primary tabular-nums" data-timer-rounds="" />
            </label>
          )}
          <DurationField field="work" label={f === 'amrap' ? 'Time cap' : f === 'emom' ? 'Work each minute' : 'Work'} value={spec.workS} min={5} onChange={v => edit({ workS: v })} />
          {(f === 'rounds' || f === 'intervals') && <DurationField field="rest" label="Rest" value={spec.restS} onChange={v => edit({ restS: v })} />}
          {f === 'intervals' && <DurationField field="warmup" label="Warm-up" value={spec.warmupS} onChange={v => edit({ warmupS: v })} />}
          {f === 'intervals' && <DurationField field="cooldown" label="Cool-down" value={spec.cooldownS} onChange={v => edit({ cooldownS: v })} />}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          if (!arm) armBell();
          rememberSpec(type, spec);
          onStart(spec);
        }}
        className="ea-cta mt-4 min-h-[48px] w-full rounded-lg text-base font-semibold text-white"
        data-timer-start=""
      >
        {arm ? 'Use this timer' : 'Start the timer'}
      </button>
    </div>
  );
}

export default function RoundTimerPanel({
  state,
  wakeHeld,
  onStart,
  onStop,
  onAmrapTap,
}: {
  state: RecordingState;
  wakeHeld: boolean;
  onStart: (spec: TimerSpec) => void;
  onStop: () => void;
  onAmrapTap: () => void;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timer = state.timer ?? null;
  const live = !!timer && timer.stopS === null;

  // A quarter-second tick while the timer runs: the bell lands within 250 ms
  // of its boundary (the phase itself is read from timestamps, not ticks).
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [live]);

  const spec = timer?.spec ?? null;
  const sched = useMemo(() => (spec ? schedule(spec) : []), [spec]);
  const t = timer ? Math.min(elapsedS(state, now), timerEndS(timer)) - timer.startS : 0;
  const prevT = useRef<number | null>(null);
  useEffect(() => {
    if (!timer || !live) {
      prevT.current = null;
      return;
    }
    const prev = prevT.current;
    prevT.current = t;
    if (prev === null || t <= prev) return;
    if (boundaryCrossed(sched, prev, t) === 0) return;
    const at = phaseAt(sched, t);
    ringBell(at.done ? 'end' : at.phase!.kind === 'rest' ? 'rest' : 'work');
  }, [t, timer, live, sched]);

  if (!timer) {
    if (setupOpen) return <TimerSetup type={state.type} onStart={spec => { setSetupOpen(false); onStart(spec); }} onClose={() => setSetupOpen(false)} />;
    return (
      <div className="mx-4 mt-4">
        <button type="button" onClick={() => setSetupOpen(true)} className="ea-interactive ea-surface flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-primary" data-record-timer-open="">
          <i className="fas fa-bell text-brand-fg" aria-hidden="true"></i>
          Round timer · Tabata · EMOM · AMRAP
        </button>
      </div>
    );
  }

  const at = phaseAt(sched, t);
  const amrapCount = timer.amrapTapsS.length;
  const kind = at.phase?.kind ?? null;
  const tone = kind === 'work' ? 'bg-brand-soft text-brand-fg' : 'bg-surface-muted text-primary';
  return (
    <section className={`mx-4 mt-4 rounded-xl border border-border p-4 ${at.done || !live ? 'bg-surface' : tone}`} aria-live="polite" data-record-timer={at.done || !live ? 'done' : kind ?? ''}>
      <p className="text-sm font-semibold" data-record-timer-line="">{phaseLine(timer.spec, at, amrapCount)}</p>
      {live && !at.done && (
        <p className="mt-1 flex items-baseline justify-between gap-3">
          <span className="text-2xl font-bold">{PHASE_LABELS[kind!]}</span>
          <span className="text-[44px] leading-none font-bold tabular-nums" data-record-timer-left={at.remainingS}>{clock(at.remainingS)}</span>
        </p>
      )}
      {(!live || at.done) && <p className="mt-1 text-sm text-secondary">Its rounds are marked on the activity when you finish.</p>}
      {live && !wakeHeld && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" role="status" data-record-timer-wake-warning="">
          Your screen may lock and stop the bell — keep it awake in Settings › Display.
        </p>
      )}
      {live && !at.done && (
        <div className="mt-3 flex gap-2">
          {timer.spec.format === 'amrap' && (
            <button type="button" onClick={onAmrapTap} className="ea-cta min-h-[56px] flex-1 rounded-lg text-lg font-bold text-white" data-record-timer-amrap="">
              +1 round
            </button>
          )}
          <button type="button" onClick={onStop} className="ea-interactive min-h-[56px] rounded-lg border border-border-strong bg-surface px-4 text-sm font-semibold text-primary" data-record-timer-stop="">
            Stop timer
          </button>
        </div>
      )}
    </section>
  );
}
