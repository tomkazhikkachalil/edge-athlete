'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Award, ChevronDown, Hourglass, Pause, Play, RotateCcw, Save, Timer, X } from 'lucide-react';
import { useToast } from '../Toast';
import NumberWheel from '@/components/golf/NumberWheel';
import { haptic } from '@/lib/haptics';
import { armBell, ringBell } from '@/lib/activities/record/bell';
import { formatElapsed, formatSetLine, setHasData } from '@/lib/workouts/summary';
import { formatHold, holdRecord, type ExerciseBests } from '@/lib/workouts/prs';
import type { EntryExercise } from '@/lib/workouts/entries';
import {
  addRestPreset,
  describeTarget,
  isValidRestSeconds,
  joinRest,
  parseRestPresets,
  removeRestPreset,
  restPresetChips,
  splitRest,
  restElapsedS,
  restPhase,
  restTargetReached,
  startRest,
  stopRest,
  clampStopwatchTargetS,
  STOPWATCH_LEAD_IN_MS,
  STOPWATCH_TARGET_DEFAULT_S,
  stopwatchDisplayS,
  stopwatchElapsedMs,
  stopwatchLeadInLeftS,
  stopwatchReset,
  stopwatchSettle,
  stopwatchStart,
  stopwatchStop,
  stopwatchTarget,
  type RestTimer,
  type SetTarget,
  type Stopwatch,
  type StopwatchMode,
} from '@/lib/workouts/rest';
import {
  readRestPresets,
  readRestTarget,
  readStopwatchLeadIn,
  readStopwatchMode,
  readStopwatchTarget,
  writeRestPresets,
  writeRestTarget,
  writeStopwatchLeadIn,
  writeStopwatchMode,
  writeStopwatchTarget,
} from '@/lib/workouts/timer-prefs';

// ── The bottom control bar (workout screen PR 4, Oct 12 2026) ───────────────
// Tom: "a small control bar at the bottom of the workout screen with Rest …
// and Stopwatch … Rest and stopwatch times do not pause the main workout
// timer." The recorder's bottom-bar recipe (RecorderControls): fixed, above
// the safe area; the screen owns its bottom edge (tab-bar.ts). The rules are
// rest.ts (pure); this renders them and ticks once a second in a leaf.
//
// Rest: tap starts; marking ANY set complete ends it and writes the seconds
// to that set (the editor does the write); tap again stops it and HOLDS the
// value for the next completed set. The target (a device preference) buzzes
// where the phone can (Android; iOS has no web vibration) and shows one
// toast. Stopwatch: Start / Stop / Reset; "Save to set" writes whole seconds
// into the target set's duration.
//
// The rest's colour (Rest timer round, Oct 22 2026 — rest.ts restPhase):
// PURPLE from the moment the rest starts (never red at the start), YELLOW
// five seconds before the target, RED at the target, FLASHING red from five
// seconds after; the tap that ends the rest resets it all. With the target
// Off the rest is purple throughout — still timed, still counted.
//
// The rest target is a PANEL (Rest timer round, Oct 22 2026 — Tom: "the same
// kind of popup as the stopwatch, with the same smooth transition"): always
// mounted, its height animates, the bar's measured height carries the
// clearance; opening it closes the stopwatch's and vice versa. It opens on
// the two wheels — minutes, and seconds by five (the golf NumberWheel with a
// `step`) — Use for this workout sets the target, Save as preset keeps it on
// the device (rest.ts rules, timer-prefs.ts storage); the chips are the
// athlete's saved times ONLY (no built-in presets), each with a remove; Off
// keeps timing and counting every rest with no target.
//
// Stopwatch additions (Oct 23 2026, Tom): a 3-2-1 LEAD-IN before the clock
// starts (a device switch; it never counts), a COUNT-DOWN mode from a target
// set with the rest picker's wheels that stops itself at zero with the round
// timer's bell and a buzz (Save to set records the time actually held), the
// live time on the bar's button while the panel is closed, and the rest
// interplay — starting the stopwatch ends a running rest (held for the next
// completed set), and Save to set starts a rest when a rest target is set
// (never when Off). The screen stays awake through the whole live workout
// (the editor's useWakeLock), the stopwatch included.
//
// The bar takes its own space (Tom, Oct 13 2026 — the open stopwatch covered
// the Add buttons at the foot of the list): its MEASURED height is published
// as `--ea-workout-bar-h` on <html> (the TabBar recipe), the editor's bottom
// clearance reads it with a transition, and the stopwatch panel animates its
// height in place instead of mounting — so the content slides up and settles
// back, and nothing is ever under the bar or the home indicator.

interface Props {
  exercises: EntryExercise[];
  rest: RestTimer;
  onRest: (next: RestTimer) => void;
  stopwatch: Stopwatch;
  onStopwatch: (next: Stopwatch) => void;
  lastEditedClientId: string | null;
  onSaveStopwatch: (target: SetTarget, elapsedMs: number) => void;
  /** The athlete's bests before this session (the editor's one read) — a saved hold longer than its best is a New PR (Oct 23 2026); null while unknown. */
  historyBests?: ReadonlyMap<string, ExerciseBests> | null;
}

function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, intervalMs]);
  return now;
}

export default function WorkoutControls({ exercises, rest, onRest, stopwatch, onStopwatch, lastEditedClientId, onSaveStopwatch, historyBests = null }: Props) {
  const { showNotice } = useToast();
  const [targetS, setTargetS] = useState<number | null>(() => readRestTarget());
  const [targetOpen, setTargetOpen] = useState(false);
  const [savedPresets, setSavedPresets] = useState<number[]>(() => readRestPresets(parseRestPresets));
  const [customMin, setCustomMin] = useState(0);
  const [customSec, setCustomSec] = useState(0);
  const customS = joinRest(customMin, customSec);
  const [stopwatchOpen, setStopwatchOpen] = useState(false);
  const [pickTarget, setPickTarget] = useState(false);
  const [chosenTarget, setChosenTarget] = useState<SetTarget | null>(null);
  const running = rest.startedAt !== null || stopwatch.runningSince !== null;
  // A quarter-second tick while the stopwatch runs (the bell at zero, the lead-in); the rest keeps its second.
  const now = useNow(running, stopwatch.runningSince !== null ? 250 : 1000);
  const [leadIn, setLeadIn] = useState<boolean>(() => readStopwatchLeadIn());
  // The last Save to set's record: a New PR pill (cleared by the next start), or "Longest so far" for a first hold.
  const [savedPr, setSavedPr] = useState<{ kind: 'pr' | 'baseline'; name: string; seconds: number } | null>(null);
  const [targetWheels, setTargetWheels] = useState(false);
  const [swMin, setSwMin] = useState(1);
  const [swSec, setSwSec] = useState(0);
  const restS = restElapsedS(rest, now);
  const reached = restTargetReached(rest, targetS, now);
  const phase = restPhase(rest, targetS, now);
  const restClass =
    phase === 'running' ? 'bg-brand text-white'
    : phase === 'warning' ? 'bg-amber-400 text-black'
    : phase === 'reached' ? 'bg-red-600 text-white'
    : phase === 'overdue' ? 'bg-red-600 text-white animate-pulse'
    : 'ea-interactive border border-border-strong text-primary';
  // The alert, once per rest.
  const alertedForRef = useRef<number | null>(null);
  useEffect(() => {
    if (!reached || rest.startedAt === null || alertedForRef.current === rest.startedAt) return;
    alertedForRef.current = rest.startedAt;
    haptic();
    showNotice('Rest is up', targetS ? `${formatElapsed(targetS)} — next set.` : undefined);
  }, [reached, rest.startedAt, targetS, showNotice]);

  // The measured height → `--ea-workout-bar-h` (the TabBar recipe): the editor's clearance follows the bar as it grows and shrinks.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = rootRef.current;
    if (!el) return;
    const update = () => root.style.setProperty('--ea-workout-bar-h', `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--ea-workout-bar-h');
    };
  }, []);

  const swMs = stopwatchElapsedMs(stopwatch, now);
  const leadLeft = stopwatchLeadInLeftS(stopwatch, now);
  const swShownS = stopwatchDisplayS(stopwatch, now);
  const swTargetS = stopwatch.targetMs !== null ? Math.round(stopwatch.targetMs / 1000) : STOPWATCH_TARGET_DEFAULT_S;
  // The mode and the target are device preferences carried on the session's stopwatch while it runs: seed them once.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || stopwatch.targetMs !== null) return;
    seededRef.current = true;
    onStopwatch({ ...stopwatch, mode: readStopwatchMode(), targetMs: (readStopwatchTarget() ?? STOPWATCH_TARGET_DEFAULT_S) * 1000 });
  }, [stopwatch, onStopwatch]);
  // A count-down at its target stops itself — the bell, a buzz, a notice — once.
  const settledForRef = useRef<number | null>(null);
  useEffect(() => {
    if (stopwatch.runningSince === null) return;
    const settled = stopwatchSettle(stopwatch, now);
    if (settled === stopwatch || settledForRef.current === stopwatch.runningSince) return;
    settledForRef.current = stopwatch.runningSince;
    onStopwatch(settled);
    ringBell('end');
    haptic();
    showNotice('Time', `${formatElapsed(Math.round(settled.accumulatedMs / 1000))} held — save it to the set.`);
  }, [now, stopwatch, onStopwatch, showNotice]);
  const setMode = (mode: StopwatchMode) => {
    writeStopwatchMode(mode);
    onStopwatch({ ...stopwatch, mode });
  };
  const openTargetWheels = () => {
    setSwMin(Math.min(10, Math.floor(swTargetS / 60)));
    setSwSec((swTargetS % 60) - ((swTargetS % 60) % 5));
    setTargetWheels(true);
  };
  const setSwTarget = () => {
    const seconds = clampStopwatchTargetS(joinRest(swMin, swSec));
    writeStopwatchTarget(seconds);
    onStopwatch({ ...stopwatch, targetMs: seconds * 1000 });
    setTargetWheels(false);
  };
  const toggleLeadIn = () => {
    const next = !leadIn;
    writeStopwatchLeadIn(next);
    setLeadIn(next);
  };
  // Start: the bell is armed inside the tap (browsers allow sound only after a gesture), a running rest ends (held for the next set), the lead-in runs when on.
  const startStopwatch = () => {
    const at = Date.now();
    setSavedPr(null);
    armBell();
    if (rest.startedAt !== null) onRest(stopRest(rest, at));
    onStopwatch(stopwatchStart(stopwatch, at, leadIn ? STOPWATCH_LEAD_IN_MS : 0));
  };
  const autoTarget = stopwatchTarget(exercises, lastEditedClientId);
  const target = chosenTarget && exercises.some(e => e.clientId === chosenTarget.clientId && e.sets[chosenTarget.setIndex]) ? chosenTarget : autoTarget;
  const targetLabel = describeTarget(exercises, target);

  const setTarget = (s: number | null) => {
    writeRestTarget(s);
    setTargetS(s);
    setTargetOpen(false);
  };
  // One panel at a time: the rest target or the stopwatch takes the space.
  const toggleTargetPanel = () => {
    if (targetOpen) {
      setTargetOpen(false);
      return;
    }
    const from = splitRest(targetS ?? 90);
    setCustomMin(Math.min(10, from.minutes));
    setCustomSec(from.seconds - (from.seconds % 5));
    setStopwatchOpen(false);
    setTargetOpen(true);
  };
  const toggleStopwatchPanel = () => {
    setTargetOpen(false);
    setStopwatchOpen(o => !o);
  };
  const chips = restPresetChips(savedPresets);
  const savePreset = (s: number) => {
    const next = addRestPreset(savedPresets, s);
    writeRestPresets(next);
    setSavedPresets(next);
  };
  const removePreset = (s: number) => {
    const next = removeRestPreset(savedPresets, s);
    writeRestPresets(next);
    setSavedPresets(next);
  };

  return (
    <>
      <div ref={rootRef} className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]" data-workout-controls={rest.startedAt !== null ? 'resting' : rest.heldS !== null ? 'rest-held' : 'idle'}>
        <div className="mx-auto max-w-md">
          {/* The rest target panel (Oct 22 2026): the stopwatch panel's recipe — always mounted, its height animates, inert while closed. */}
          <div
            className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${targetOpen ? 'max-h-[30rem] opacity-100 mb-2' : 'max-h-0 opacity-0'}`}
            aria-hidden={!targetOpen}
            data-workout-rest-target-open={targetOpen ? 'true' : 'false'}
          >
            <div className="rounded-xl border border-border bg-surface p-3" data-workout-rest-target-panel="" {...(targetOpen ? {} : { inert: true })}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-primary">Rest target</p>
                <button type="button" onClick={() => setTargetOpen(false)} className="ea-icon-btn text-secondary" aria-label="Close the rest target" data-workout-rest-target-close="">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-1 text-xs text-secondary">Purple while you rest, yellow five seconds before the target, red when it is up — with a buzz where your phone allows it (Android; iPhones do not vibrate from a web app) and a short notice. Off still times every rest.</p>
              <div className="mt-3 flex items-start justify-center gap-3" data-workout-rest-custom-panel="">
                <NumberWheel label="Minutes" min={0} max={10} value={customMin} defaultValue={1} onChange={setCustomMin} tone="brand" disabled={!targetOpen} />
                <NumberWheel label="Seconds" min={0} max={55} step={5} value={customSec} defaultValue={30} onChange={setCustomSec} tone="brand" format={v => String(v).padStart(2, '0')} disabled={!targetOpen} />
              </div>
              <p className="mt-2 text-center text-sm text-secondary" data-workout-rest-custom-value={customS}>
                {isValidRestSeconds(customS) ? `Rest ${formatElapsed(customS)}` : 'At least 5 seconds'}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!isValidRestSeconds(customS)) return;
                    savePreset(customS);
                    setTarget(customS);
                  }}
                  disabled={!isValidRestSeconds(customS)}
                  className="ea-interactive min-h-[44px] flex-1 rounded-lg border border-border-strong px-3 text-sm font-semibold text-primary disabled:opacity-50"
                  data-workout-rest-custom-save=""
                >
                  Save as preset
                </button>
                <button
                  type="button"
                  onClick={() => { if (isValidRestSeconds(customS)) setTarget(customS); }}
                  disabled={!isValidRestSeconds(customS)}
                  className="ea-cta min-h-[44px] flex-1 rounded-lg px-3 text-sm font-semibold text-white disabled:opacity-50"
                  data-workout-rest-custom-use=""
                >
                  Use for this workout
                </button>
              </div>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Your presets</p>
              <div className="mt-1 flex flex-wrap items-center gap-2" data-workout-rest-presets={chips.length}>
                {chips.map(chip => (
                  <div key={chip.seconds} className="relative">
                    <button type="button" onClick={() => setTarget(chip.seconds)} aria-pressed={targetS === chip.seconds} className={`min-h-[40px] rounded-lg px-4 text-sm font-semibold ${targetS === chip.seconds ? 'bg-brand text-white' : 'ea-interactive ea-surface text-primary'}`} data-workout-rest-preset={chip.seconds} data-workout-rest-preset-saved="true">
                      {formatElapsed(chip.seconds)}
                    </button>
                    <button type="button" onClick={() => removePreset(chip.seconds)} className="ea-interactive absolute -right-1.5 -top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-secondary" aria-label={`Remove the ${formatElapsed(chip.seconds)} preset`} data-workout-rest-preset-remove={chip.seconds}>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                {chips.length === 0 && <p className="text-xs text-muted" data-workout-rest-presets-empty="">Save a time above to keep it here.</p>}
                <button type="button" onClick={() => setTarget(null)} aria-pressed={targetS === null} className={`ml-auto min-h-[40px] rounded-lg px-4 text-sm font-semibold ${targetS === null ? 'bg-brand text-white' : 'ea-interactive ea-surface text-primary'}`} data-workout-rest-preset="off">
                  Off
                </button>
              </div>
            </div>
          </div>
          {/* Always mounted; its height animates (max-height works on the iOS 15 floor) so the bar's measured height — and the clearance above it — slide rather than jump. */}
          <div
            className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${stopwatchOpen ? 'max-h-[28rem] opacity-100 mb-2' : 'max-h-0 opacity-0'}`}
            aria-hidden={!stopwatchOpen}
            data-workout-stopwatch-open={stopwatchOpen ? 'true' : 'false'}
          >
            <div className="rounded-xl border border-border bg-surface p-3" data-workout-stopwatch-panel="" {...(stopwatchOpen ? {} : { inert: true })}>
              <div className="flex items-center justify-between gap-2">
                {/* The lead-in's 3 · 2 · 1, else the remaining time counting down, else the elapsed time. */}
                <span className={`text-2xl font-bold tabular-nums ${leadLeft !== null ? 'text-brand-fg-strong' : 'text-primary'}`} data-workout-stopwatch-time="" data-workout-stopwatch-leadin-left={leadLeft ?? ''}>
                  {leadLeft !== null ? String(leadLeft) : formatElapsed(swShownS)}
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => (stopwatch.runningSince !== null ? onStopwatch(stopwatchStop(stopwatch, Date.now())) : startStopwatch())} className="ea-interactive inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-border-strong text-primary" aria-label={stopwatch.runningSince !== null ? 'Stop the stopwatch' : 'Start the stopwatch'} data-workout-stopwatch-toggle={stopwatch.runningSince !== null ? 'running' : 'stopped'}>
                    {stopwatch.runningSince !== null ? <Pause className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
                  </button>
                  <button type="button" onClick={() => onStopwatch(stopwatchReset(stopwatch))} disabled={swMs === 0 && stopwatch.runningSince === null} className="ea-interactive inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-border-strong text-primary disabled:opacity-40" aria-label="Reset the stopwatch" data-workout-stopwatch-reset="">
                    <RotateCcw className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              {/* Count up or down; the count-down's target by the rest picker's wheels; the 3-2-1 lead-in switch. */}
              <div className="mt-2 flex flex-wrap items-center gap-2" data-workout-stopwatch-mode={stopwatch.mode}>
                <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Count up or down">
                  <button type="button" onClick={() => setMode('up')} aria-pressed={stopwatch.mode === 'up'} className={`min-h-[36px] rounded-md px-3 text-xs font-semibold ${stopwatch.mode === 'up' ? 'bg-brand text-white' : 'text-secondary'}`} data-workout-stopwatch-mode-set="up">
                    Count up
                  </button>
                  <button type="button" onClick={() => setMode('down')} aria-pressed={stopwatch.mode === 'down'} className={`min-h-[36px] rounded-md px-3 text-xs font-semibold ${stopwatch.mode === 'down' ? 'bg-brand text-white' : 'text-secondary'}`} data-workout-stopwatch-mode-set="down">
                    Count down
                  </button>
                </div>
                {stopwatch.mode === 'down' && (
                  <button type="button" onClick={() => (targetWheels ? setTargetWheels(false) : openTargetWheels())} aria-pressed={targetWheels} className="ea-interactive inline-flex min-h-[36px] items-center rounded-lg border border-border-strong px-3 text-xs font-semibold tabular-nums text-primary" aria-label="Count down from" data-workout-stopwatch-target-time={swTargetS}>
                    from {formatElapsed(swTargetS)}
                  </button>
                )}
                <button type="button" onClick={toggleLeadIn} aria-pressed={leadIn} className={`ml-auto inline-flex min-h-[36px] items-center rounded-lg border px-3 text-xs font-semibold ${leadIn ? 'border-brand text-brand-fg-strong' : 'ea-interactive border-border-strong text-secondary'}`} data-workout-stopwatch-leadin={leadIn ? 'on' : 'off'}>
                  3·2·1 {leadIn ? 'on' : 'off'}
                </button>
              </div>
              {stopwatch.mode === 'down' && targetWheels && (
                <div className="mt-2" data-workout-stopwatch-target-wheels="">
                  <div className="flex items-start justify-center gap-3">
                    <NumberWheel label="Minutes" min={0} max={10} value={swMin} defaultValue={1} onChange={setSwMin} tone="brand" />
                    <NumberWheel label="Seconds" min={0} max={55} step={5} value={swSec} defaultValue={0} onChange={setSwSec} tone="brand" format={v => String(v).padStart(2, '0')} />
                  </div>
                  <button type="button" onClick={setSwTarget} className="ea-cta mt-2 min-h-[40px] w-full rounded-lg px-3 text-sm font-semibold text-white" data-workout-stopwatch-target-set="">
                    Count down from {formatElapsed(clampStopwatchTargetS(joinRest(swMin, swSec)))}
                  </button>
                </div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => setPickTarget(true)} disabled={!target} className="ea-interactive flex min-h-[40px] min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-border px-3 text-sm text-primary disabled:opacity-50" aria-label="Choose the set to save to" data-workout-stopwatch-target={target ? `${target.clientId}:${target.setIndex}` : ''}>
                  <span className="truncate">{targetLabel ?? 'Add an exercise first'}</span>
                  <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!target || swMs < 1000) return;
                    const at = Date.now();
                    // Longest hold (Oct 23 2026): a saved time against the athlete's best before this session and this session's earlier sets.
                    const exercise = exercises.find(e => e.clientId === target.clientId);
                    const seconds = Math.max(1, Math.round(swMs / 1000));
                    const record = exercise ? holdRecord(historyBests, exercises, exercise, seconds) : 'no';
                    if (exercise && record !== 'no') {
                      setSavedPr({ kind: record, name: exercise.name, seconds });
                      if (record === 'pr') showNotice('New PR', `${exercise.name} · longest hold ${formatHold(seconds)}`);
                    }
                    onSaveStopwatch(target, swMs);
                    onStopwatch(stopwatchReset(stopwatch));
                    // A set picked by hand is for ONE save: the next target is the rule's again (the first open set), never the same set twice.
                    setChosenTarget(null);
                    // The auto-rest (Tom): a rest target set → the rest starts; Off → nothing.
                    if (targetS !== null) onRest(startRest(rest, at));
                  }}
                  disabled={!target || swMs < 1000}
                  className="ea-cta inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-white disabled:opacity-50"
                  data-workout-stopwatch-save=""
                >
                  <Save className="w-4 h-4" aria-hidden="true" />
                  Save to set
                </button>
              </div>
              {savedPr && (
                <p className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${savedPr.kind === 'pr' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300' : 'bg-surface-muted text-secondary'}`} data-workout-stopwatch-pr={savedPr.kind}>
                  <Award className="w-3.5 h-3.5" aria-hidden="true" />
                  {savedPr.kind === 'pr' ? `New PR · ${savedPr.name} · ${formatHold(savedPr.seconds)}` : `Longest so far · ${savedPr.name} · ${formatHold(savedPr.seconds)}`}
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {/* Rest: a toggle; the number shows while resting or held; a long-press (or the chip) sets the target. */}
            <button
              type="button"
              onClick={() => onRest(rest.startedAt !== null ? stopRest(rest, Date.now()) : startRest(rest, Date.now()))}
              onContextMenu={e => {
                e.preventDefault();
                toggleTargetPanel();
              }}
              aria-pressed={rest.startedAt !== null}
              className={`inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-xl px-3 text-base font-semibold ${restClass}`}
              data-workout-rest={rest.startedAt !== null ? 'running' : rest.heldS !== null ? 'held' : 'idle'}
              data-workout-rest-phase={phase}
            >
              <Hourglass className="w-4 h-4" aria-hidden="true" />
              {rest.startedAt !== null ? (
                <span className="tabular-nums" data-workout-rest-time="">{formatElapsed(restS)}</span>
              ) : rest.heldS !== null ? (
                <span className="tabular-nums" data-workout-rest-time="">Rest {formatElapsed(rest.heldS)} · next set</span>
              ) : (
                'Rest'
              )}
            </button>
            <button type="button" onClick={toggleTargetPanel} aria-pressed={targetOpen} className={`inline-flex min-h-[52px] items-center justify-center rounded-xl border px-3 text-xs font-semibold ${targetOpen ? 'border-brand text-brand-fg-strong' : 'ea-interactive border-border-strong text-secondary'}`} aria-label="Rest target" data-workout-rest-target={targetS ?? 'off'}>
              {targetS ? formatElapsed(targetS) : 'Target'}
            </button>
            <button type="button" onClick={toggleStopwatchPanel} aria-pressed={stopwatchOpen} className={`inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-xl px-3 text-base font-semibold ${stopwatch.runningSince !== null ? 'bg-brand text-white' : 'ea-interactive border border-border-strong text-primary'}`} data-workout-stopwatch={stopwatch.runningSince !== null ? 'running' : swMs > 0 ? 'stopped' : 'idle'}>
              <Timer className="w-4 h-4" aria-hidden="true" />
              {stopwatch.runningSince !== null || swMs > 0 ? <span className="tabular-nums" data-workout-stopwatch-button-time="">{leadLeft !== null ? String(leadLeft) : formatElapsed(swShownS)}</span> : 'Stopwatch'}
            </button>
          </div>
        </div>
      </div>

      {pickTarget && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" role="dialog" aria-modal="true" aria-label="Save the stopwatch to">
          <button type="button" className="absolute inset-0" aria-label="Dismiss" onClick={() => setPickTarget(false)} />
          <div className="relative max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" data-workout-stopwatch-picker="">
            <p className="text-base font-bold text-primary">Save the time to</p>
            <ul className="mt-2 space-y-1">
              {exercises.flatMap(e =>
                e.sets.map((s, i) => (
                  <li key={`${e.clientId}:${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setChosenTarget({ clientId: e.clientId, setIndex: i });
                        setPickTarget(false);
                      }}
                      className="ea-interactive flex min-h-[44px] w-full items-center justify-between rounded-lg px-3 text-left text-sm text-primary"
                      data-workout-stopwatch-pick={`${e.clientId}:${i}`}
                    >
                      <span className="truncate">{e.name} · {e.groupId ? 'round' : 'set'} {i + 1}</span>
                      {/* What the set holds now, so a filled set is recognisable before its time is replaced. */}
                      {setHasData(s) ? <span className="shrink-0 text-xs text-muted tabular-nums">{formatSetLine(s)}</span> : null}
                    </button>
                  </li>
                )),
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
