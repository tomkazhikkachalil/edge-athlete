'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Hourglass, Pause, Play, RotateCcw, Save, Timer, X } from 'lucide-react';
import { useToast } from '../Toast';
import NumberWheel from '@/components/golf/NumberWheel';
import { haptic } from '@/lib/haptics';
import { formatElapsed } from '@/lib/workouts/summary';
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
  stopwatchElapsedMs,
  stopwatchReset,
  stopwatchStart,
  stopwatchStop,
  stopwatchTarget,
  type RestTimer,
  type SetTarget,
  type Stopwatch,
} from '@/lib/workouts/rest';
import { readRestPresets, readRestTarget, writeRestPresets, writeRestTarget } from '@/lib/workouts/timer-prefs';

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
// A custom target (Training fixes PR 3, Oct 21 2026): the target sheet's
// Custom opens two wheels — minutes, and seconds by five (the golf
// NumberWheel with a `step`) — Use sets it, Save as preset keeps it on the
// device beside the built-in five (rest.ts rules, timer-prefs.ts storage;
// a saved chip carries a remove).
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
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);
  return now;
}

export default function WorkoutControls({ exercises, rest, onRest, stopwatch, onStopwatch, lastEditedClientId, onSaveStopwatch }: Props) {
  const { showNotice } = useToast();
  const [targetS, setTargetS] = useState<number | null>(() => readRestTarget());
  const [targetSheet, setTargetSheet] = useState(false);
  const [savedPresets, setSavedPresets] = useState<number[]>(() => readRestPresets(parseRestPresets));
  const [custom, setCustom] = useState(false);
  const [customMin, setCustomMin] = useState(0);
  const [customSec, setCustomSec] = useState(0);
  const customS = joinRest(customMin, customSec);
  const [stopwatchOpen, setStopwatchOpen] = useState(false);
  const [pickTarget, setPickTarget] = useState(false);
  const [chosenTarget, setChosenTarget] = useState<SetTarget | null>(null);
  const running = rest.startedAt !== null || stopwatch.runningSince !== null;
  const now = useNow(running);
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
  const autoTarget = stopwatchTarget(exercises, lastEditedClientId);
  const target = chosenTarget && exercises.some(e => e.clientId === chosenTarget.clientId && e.sets[chosenTarget.setIndex]) ? chosenTarget : autoTarget;
  const targetLabel = describeTarget(exercises, target);

  const setTarget = (s: number | null) => {
    writeRestTarget(s);
    setTargetS(s);
    setTargetSheet(false);
    setCustom(false);
  };
  const openCustom = () => {
    const from = splitRest(targetS ?? 90);
    setCustomMin(Math.min(10, from.minutes));
    setCustomSec(from.seconds - (from.seconds % 5));
    setCustom(true);
  };
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
          {/* Always mounted; its height animates (max-height works on the iOS 15 floor) so the bar's measured height — and the clearance above it — slide rather than jump. */}
          <div
            className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${stopwatchOpen ? 'max-h-48 opacity-100 mb-2' : 'max-h-0 opacity-0'}`}
            aria-hidden={!stopwatchOpen}
            data-workout-stopwatch-open={stopwatchOpen ? 'true' : 'false'}
          >
            <div className="rounded-xl border border-border bg-surface p-3" data-workout-stopwatch-panel="" {...(stopwatchOpen ? {} : { inert: true })}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-2xl font-bold tabular-nums text-primary" data-workout-stopwatch-time="">{formatElapsed(Math.floor(swMs / 1000))}</span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => onStopwatch(stopwatch.runningSince !== null ? stopwatchStop(stopwatch, Date.now()) : stopwatchStart(stopwatch, Date.now()))} className="ea-interactive inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-border-strong text-primary" aria-label={stopwatch.runningSince !== null ? 'Stop the stopwatch' : 'Start the stopwatch'} data-workout-stopwatch-toggle={stopwatch.runningSince !== null ? 'running' : 'stopped'}>
                    {stopwatch.runningSince !== null ? <Pause className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4" aria-hidden="true" />}
                  </button>
                  <button type="button" onClick={() => onStopwatch(stopwatchReset())} disabled={swMs === 0} className="ea-interactive inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-border-strong text-primary disabled:opacity-40" aria-label="Reset the stopwatch" data-workout-stopwatch-reset="">
                    <RotateCcw className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => setPickTarget(true)} disabled={!target} className="ea-interactive flex min-h-[40px] min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-border px-3 text-sm text-primary disabled:opacity-50" aria-label="Choose the set to save to" data-workout-stopwatch-target={target ? `${target.clientId}:${target.setIndex}` : ''}>
                  <span className="truncate">{targetLabel ?? 'Every set is filled'}</span>
                  <ChevronDown className="w-4 h-4 shrink-0" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!target || swMs < 1000) return;
                    onSaveStopwatch(target, swMs);
                    onStopwatch(stopwatchReset());
                  }}
                  disabled={!target || swMs < 1000}
                  className="ea-cta inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-white disabled:opacity-50"
                  data-workout-stopwatch-save=""
                >
                  <Save className="w-4 h-4" aria-hidden="true" />
                  Save to set
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {/* Rest: a toggle; the number shows while resting or held; a long-press (or the chip) sets the target. */}
            <button
              type="button"
              onClick={() => onRest(rest.startedAt !== null ? stopRest(rest, Date.now()) : startRest(rest, Date.now()))}
              onContextMenu={e => {
                e.preventDefault();
                setTargetSheet(true);
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
            <button type="button" onClick={() => setTargetSheet(true)} className="ea-interactive inline-flex min-h-[52px] items-center justify-center rounded-xl border border-border-strong px-3 text-xs font-semibold text-secondary" aria-label="Rest target" data-workout-rest-target={targetS ?? 'off'}>
              {targetS ? formatElapsed(targetS) : 'Target'}
            </button>
            <button type="button" onClick={() => setStopwatchOpen(o => !o)} aria-pressed={stopwatchOpen} className={`inline-flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-xl px-3 text-base font-semibold ${stopwatch.runningSince !== null ? 'bg-brand text-white' : 'ea-interactive border border-border-strong text-primary'}`} data-workout-stopwatch={stopwatch.runningSince !== null ? 'running' : swMs > 0 ? 'stopped' : 'idle'}>
              <Timer className="w-4 h-4" aria-hidden="true" />
              {stopwatch.runningSince !== null || swMs > 0 ? <span className="tabular-nums">{formatElapsed(Math.floor(swMs / 1000))}</span> : 'Stopwatch'}
            </button>
          </div>
        </div>
      </div>

      {targetSheet && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" role="dialog" aria-modal="true" aria-label="Rest target">
          <button type="button" className="absolute inset-0" aria-label="Dismiss" onClick={() => setTargetSheet(false)} />
          <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" data-workout-rest-target-sheet={custom ? 'custom' : 'presets'}>
            <p className="text-base font-bold text-primary">Rest target</p>
            <p className="mt-1 text-xs text-secondary">Purple while you rest, yellow five seconds before the target, red when it is up — with a buzz where your phone allows it (Android; iPhones do not vibrate from a web app) and a short notice. Off still times every rest.</p>
            {custom ? (
              <div className="mt-3" data-workout-rest-custom-panel="">
                <div className="flex items-start justify-center gap-3">
                  <NumberWheel label="Minutes" min={0} max={10} value={customMin} defaultValue={1} onChange={setCustomMin} tone="brand" />
                  <NumberWheel label="Seconds" min={0} max={55} step={5} value={customSec} defaultValue={30} onChange={setCustomSec} tone="brand" format={v => String(v).padStart(2, '0')} />
                </div>
                <p className="mt-2 text-center text-sm text-secondary" data-workout-rest-custom-value={customS}>
                  {isValidRestSeconds(customS) ? `Rest ${formatElapsed(customS)}` : 'At least 5 seconds'}
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => setCustom(false)} className="ea-interactive min-h-[48px] rounded-lg border border-border-strong px-4 text-sm font-semibold text-secondary" data-workout-rest-custom-back="">
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isValidRestSeconds(customS)) return;
                      savePreset(customS);
                      setTarget(customS);
                    }}
                    disabled={!isValidRestSeconds(customS)}
                    className="ea-interactive min-h-[48px] flex-1 rounded-lg border border-border-strong px-3 text-sm font-semibold text-primary disabled:opacity-50"
                    data-workout-rest-custom-save=""
                  >
                    Save as preset
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (isValidRestSeconds(customS)) setTarget(customS); }}
                    disabled={!isValidRestSeconds(customS)}
                    className="ea-cta min-h-[48px] flex-1 rounded-lg px-3 text-sm font-semibold text-white disabled:opacity-50"
                    data-workout-rest-custom-use=""
                  >
                    Use
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {restPresetChips(savedPresets).map(chip => (
                  <div key={chip.seconds} className="relative">
                    <button type="button" onClick={() => setTarget(chip.seconds)} aria-pressed={targetS === chip.seconds} className={`min-h-[48px] w-full rounded-lg text-sm font-semibold ${targetS === chip.seconds ? 'bg-brand text-white' : 'ea-interactive ea-surface text-primary'}`} data-workout-rest-preset={chip.seconds} data-workout-rest-preset-saved={chip.saved ? 'true' : undefined}>
                      {formatElapsed(chip.seconds)}
                    </button>
                    {chip.saved && (
                      <button type="button" onClick={() => removePreset(chip.seconds)} className="ea-interactive absolute -right-1 -top-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-secondary" aria-label={`Remove the ${formatElapsed(chip.seconds)} preset`} data-workout-rest-preset-remove={chip.seconds}>
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setTarget(null)} aria-pressed={targetS === null} className={`min-h-[48px] rounded-lg text-sm font-semibold ${targetS === null ? 'bg-brand text-white' : 'ea-interactive ea-surface text-primary'}`} data-workout-rest-preset="off">
                  Off
                </button>
                <button type="button" onClick={openCustom} className="ea-interactive min-h-[48px] rounded-lg border border-dashed border-border-strong text-sm font-semibold text-primary" data-workout-rest-custom="">
                  Custom…
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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
                      {s.durationSeconds ? <span className="text-xs text-muted tabular-nums">{formatElapsed(s.durationSeconds)}</span> : null}
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
