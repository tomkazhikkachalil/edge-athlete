'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  WHEEL_ITEM_H,
  WHEEL_HEIGHT,
  WHEEL_PAD,
  wheelValues,
  valueForScrollTop,
  scrollTopForValue,
  nextValueForKey,
  valueForTypedDigit,
} from '@/lib/golf/wheel';

/**
 * A scroll-wheel number selector — swipe, scroll, or use the keyboard.
 *
 * Geometry and key bindings live in src/lib/golf/wheel.ts so they can be
 * unit-tested; this file is the DOM and the plumbing.
 *
 * ── Two things here are load-bearing, both learned the hard way in this modal
 *
 * 1. EXPLICIT HEIGHT + shrink-0. This is `overflow-y-auto`, and per spec that
 *    computes overflow-x to `auto` as well — which makes the element a
 *    scrollport on both axes AND resolves its automatic minimum size to 0. As a
 *    flex child it would then be squashed and clip its own rows. That is exactly
 *    how the player-switcher chips in this same modal got sliced (#164), one
 *    axis over.
 *
 * 2. REAL 44px rows. The touch floor cannot be met with an `after:` extender
 *    here — globals.css's CLIPPING RULE: an extender is dead under any
 *    overflow ancestor, hit area included, with no visual warning.
 *
 * `value === null` means nothing has been entered yet: the wheel still rests on
 * `defaultValue` so the user is one flick from the common answer, but callers
 * must keep their own state null until a real commit. `aria-valuenow` is
 * omitted in that state so assistive tech is not told a number was chosen.
 */

export interface NumberWheelProps {
  label: string;
  min: number;
  max: number;
  /** The committed value, or null when the user has not entered one. */
  value: number | null;
  /** Where the wheel rests while `value` is null (hole par, or 2 putts). */
  defaultValue: number;
  onChange: (value: number) => void;
  /** Colour of the selected row — golf green for strokes, brand for putts. */
  tone?: 'green' | 'brand';
  disabled?: boolean;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export default function NumberWheel({
  label,
  min,
  max,
  value,
  defaultValue,
  onChange,
  tone = 'green',
  disabled = false,
}: NumberWheelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const values = wheelValues(min, max);
  const resting = value ?? defaultValue;

  // Typed digits accumulate briefly so "1" then "2" reaches 12.
  const typeBuffer = useRef({ text: '', at: 0 });
  // Suppresses the scroll handler while we are the ones scrolling.
  const programmatic = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollTo = useCallback((v: number, smooth: boolean) => {
    const el = listRef.current;
    if (!el) return;
    programmatic.current = true;
    el.scrollTo({
      top: scrollTopForValue(v, min, max),
      // The global prefers-reduced-motion block forces CSS scroll-behavior to
      // auto, but it CANNOT reach this JS argument — so check it by hand.
      behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
    });
    // Let the scroll settle before listening again.
    window.setTimeout(() => { programmatic.current = false; }, smooth ? 320 : 60);
  }, [min, max]);

  // Keep the wheel under the value it is showing. Position is derived state,
  // not an effect that fights the user: it only runs when `resting` changes.
  const [syncedResting, setSyncedResting] = useState<number | null>(null);
  if (syncedResting !== resting) {
    setSyncedResting(resting);
  }
  useEffect(() => {
    scrollTo(resting, false);
    // Only when the value changes from outside — a user drag settles itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- position sync, not a subscription
  }, [syncedResting]);

  const commit = useCallback((v: number) => {
    if (disabled) return;
    onChange(v);
  }, [disabled, onChange]);

  const handleScroll = () => {
    if (programmatic.current || disabled) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    // Debounced settle: fire once the wheel stops, not on every frame.
    settleTimer.current = setTimeout(() => {
      const el = listRef.current;
      if (!el) return;
      commit(valueForScrollTop(el.scrollTop, min, max));
    }, 120);
  };

  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const stepped = nextValueForKey(resting, e.key, min, max);
    if (stepped !== null) {
      e.preventDefault();
      scrollTo(stepped, true);
      commit(stepped);
      return;
    }
    const now = Date.now();
    const buffer = now - typeBuffer.current.at < 900 ? typeBuffer.current.text : '';
    const typed = valueForTypedDigit(e.key, buffer, min, max);
    if (typed) {
      e.preventDefault();
      typeBuffer.current = { text: typed.buffer, at: now };
      scrollTo(typed.value, true);
      commit(typed.value);
    }
  };

  const selected = tone === 'green'
    ? 'bg-green-600 text-white border-green-700'
    : 'bg-brand text-white border-brand';

  return (
    <div className="min-w-0">
      <label id={labelId} className="block text-sm font-medium text-secondary mb-2">
        {label}
      </label>

      {/* The frame carries the centre highlight so the wheel itself stays a
          plain scrollport — a border on the scrolling element would move. */}
      <div className="relative">
        <div
          aria-hidden="true"
          // Dashed and muted until a value is committed. A solid frame around a
          // resting suggestion reads as "recorded", and it is not — nothing is
          // stored until the user touches the wheel and moves on.
          className={`pointer-events-none absolute inset-x-0 z-10 rounded-lg ${
            value === null
              ? 'border-2 border-dashed border-border-strong'
              : `border-2 ${tone === 'green' ? 'border-green-600' : 'border-brand'}`
          }`}
          style={{ top: WHEEL_PAD, height: WHEEL_ITEM_H }}
        />
        <div
          ref={listRef}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          role="spinbutton"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={labelId}
          aria-valuemin={min}
          aria-valuemax={max}
          // Omitted while nothing is entered — the value shown is a suggestion,
          // and announcing it as the current value would be a lie.
          {...(value !== null ? { 'aria-valuenow': value } : {})}
          aria-valuetext={value !== null ? String(value) : `Not entered, showing ${resting}`}
          aria-disabled={disabled || undefined}
          // shrink-0 + a fixed height: see the note at the top of this file.
          className="shrink-0 snap-y snap-mandatory overflow-y-auto scrollbar-hide rounded-lg bg-surface-sunken outline-none"
          style={{ height: WHEEL_HEIGHT, scrollPaddingBlock: WHEEL_PAD }}
        >
          <div style={{ paddingTop: WHEEL_PAD, paddingBottom: WHEEL_PAD }}>
            {values.map(v => {
              const isCurrent = v === resting;
              return (
                <div
                  key={v}
                  onClick={() => { scrollTo(v, true); commit(v); }}
                  className={`snap-center flex items-center justify-center font-bold text-xl select-none cursor-pointer transition-colors ${
                    isCurrent
                      ? value === null
                        // Suggested, not chosen — no fill.
                        ? 'text-tertiary rounded-lg'
                        : `${selected} rounded-lg`
                      : value === null ? 'text-faint' : 'text-secondary'
                  }`}
                  style={{ height: WHEEL_ITEM_H }}
                >
                  {v}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
