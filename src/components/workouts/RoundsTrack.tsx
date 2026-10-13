'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { slideIndexFromScroll } from '@/lib/workouts/rounds-view';

// ── The one carousel: a group's rounds as a horizontal stack (Oct 13 2026) ──
// Used by the live group card AND the post's group card, so the two can never
// disagree. A CSS scroll-snap track (`snap-x snap-mandatory`, one slide per
// round, each the track's full width); the index is CONTROLLED by the parent:
//   • a swipe → onScroll (rAF-throttled) → slideIndexFromScroll → onIndexChange
//   • a parent move (a dot, an arrow, the auto-advance) → scrollLeft set here
// Programmatic moves set `scrollLeft` — never scrollIntoView, which scrolls
// every ancestor including the page (src/lib/scroll-inline.ts has the story);
// smooth unless the device prefers reduced motion (NumberWheel's rule), behind
// a `programmatic` ref so the scroll handler ignores its own moves. No
// `touch-action` on the track on purpose: the effective touch-action is the
// INTERSECTION down the ancestor chain, so `pan-x` here would stop the page
// scrolling vertically from a touch that starts on a round — the browser's own
// first-movement rule is what keeps the page vertical and the card horizontal.
// Slides out of view are `inert` so the tab order and a screen reader meet one
// round at a time (an attribute older WebKit ignores — a progressive step).

interface Props {
  count: number;
  /** The slide in view, 0-based. */
  index: number;
  onIndexChange: (index: number) => void;
  /** Called on a swipe the person made (never a programmatic move) — the hint's dismissal. */
  onUserSwipe?: () => void;
  renderSlide: (k: number) => ReactNode;
  /** The indicator row — "Round k of R" + dots + arrows. `label: false` leaves the text to the host (the live card's header). */
  label?: boolean;
  className?: string;
  'data-rounds-track'?: string;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export default function RoundsTrack({ count, index, onIndexChange, onUserSwipe, renderSlide, label = true, className = '' }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const programmatic = useRef(false);
  const releaseTimer = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const indexRef = useRef(index);
  useEffect(() => { indexRef.current = index; }, [index]);
  /** The last index change came from the person's own scroll — the controlled effect must not fight the snap. */
  const fromScroll = useRef(false);

  const moveTo = useCallback((k: number, smooth: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    const left = k * el.clientWidth;
    if (Math.abs(el.scrollLeft - left) < 1) return;
    programmatic.current = true;
    if (releaseTimer.current !== null) window.clearTimeout(releaseTimer.current);
    const behave = smooth && !prefersReducedMotion();
    el.scrollTo({ left, behavior: behave ? 'smooth' : 'auto' });
    // A smooth scroll settles within ~300 ms; an instant one on the next frame.
    releaseTimer.current = window.setTimeout(() => { programmatic.current = false; }, behave ? 400 : 60);
  }, []);

  // The parent's index → the track (mount: instant; later: smooth).
  const mounted = useRef(false);
  useEffect(() => {
    const el = trackRef.current;
    if (fromScroll.current && el && slideIndexFromScroll(el.scrollLeft, el.clientWidth, count) === index) {
      fromScroll.current = false; // the snap is already taking it there
      mounted.current = true;
      return;
    }
    fromScroll.current = false;
    moveTo(index, mounted.current);
    mounted.current = true;
  }, [index, count, moveTo]);

  // A width change (a rotation, a resize) re-seats the slide in view without animation.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const left = indexRef.current * el.clientWidth;
      if (Math.abs(el.scrollLeft - left) >= 1) {
        programmatic.current = true;
        el.scrollTo({ left, behavior: 'auto' });
        if (releaseTimer.current !== null) window.clearTimeout(releaseTimer.current);
        releaseTimer.current = window.setTimeout(() => { programmatic.current = false; }, 60);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (releaseTimer.current !== null) window.clearTimeout(releaseTimer.current);
  }, []);

  const onScroll = () => {
    if (programmatic.current) return;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const el = trackRef.current;
      if (!el) return;
      const next = slideIndexFromScroll(el.scrollLeft, el.clientWidth, count);
      if (next !== indexRef.current) {
        fromScroll.current = true;
        onIndexChange(next);
        onUserSwipe?.();
      }
    });
  };

  const safeIndex = Math.min(Math.max(0, index), Math.max(0, count - 1));

  return (
    <div className={className} data-rounds-track="">
      {count > 1 && (
        <div className="flex items-center justify-center gap-2 pb-2" data-rounds-indicator="">
          <button
            type="button"
            onClick={() => onIndexChange(Math.max(0, safeIndex - 1))}
            disabled={safeIndex <= 0}
            className="ea-interactive hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-secondary disabled:opacity-30"
            aria-label="Previous round"
            data-rounds-prev=""
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          {label && (
            <span className="text-xs font-semibold text-secondary tabular-nums" data-rounds-current={safeIndex + 1}>
              Round {safeIndex + 1} of {count}
            </span>
          )}
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Rounds">
            {Array.from({ length: count }, (_, k) => (
              <button
                key={k}
                type="button"
                role="tab"
                onClick={() => onIndexChange(k)}
                aria-label={`Round ${k + 1}`}
                aria-selected={k === safeIndex}
                aria-current={k === safeIndex ? 'true' : undefined}
                className={`ea-interactive h-6 w-6 -mx-1 flex items-center justify-center rounded-full`}
                data-rounds-dot={k + 1}
              >
                <span className={`block rounded-full transition-[width,background-color] duration-150 ${k === safeIndex ? 'w-4 h-2 bg-brand' : 'w-2 h-2 bg-border-strong'}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onIndexChange(Math.min(count - 1, safeIndex + 1))}
            disabled={safeIndex >= count - 1}
            className="ea-interactive hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-secondary disabled:opacity-30"
            aria-label="Next round"
            data-rounds-next=""
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex overflow-x-auto overscroll-x-contain snap-x snap-mandatory scrollbar-hide"
        style={{ WebkitOverflowScrolling: 'touch' }}
        data-rounds-slides=""
      >
        {Array.from({ length: count }, (_, k) => (
          <div
            key={k}
            className="w-full shrink-0 snap-center snap-always"
            data-rounds-slide={k + 1}
            {...(k === safeIndex ? { 'data-rounds-active': '' } : { inert: true })}
          >
            {renderSlide(k)}
          </div>
        ))}
      </div>
    </div>
  );
}
