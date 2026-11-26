'use client';

import { useEffect, useRef, useState } from 'react';
import { haptic } from '@/lib/haptics';
import { SLIDE_KEY, SLIDE_KEY_COMPACT, slideLocks, slideOffset, slideTrailWidth, slideTravel } from '@/lib/golf/slide';

/**
 * A slide control (the mechanical dialect, golf part 2, Nov 24 2026): a
 * raised key in a recessed track. Sliding the key to the end confirms;
 * letting go earlier springs it back and nothing happens — an action that
 * cannot be taken back by a stray tap asks for a deliberate gesture.
 *
 *  - Pointer events with capture on the TRACK (mouse, touch and pen alike);
 *    `touch-action: none` there, so the page does not scroll under a drag.
 *    The drag may start anywhere on the track, not only on the key (Nov 25
 *    2026): the key rests 20 px from the screen's left edge, where Android
 *    and iOS start their own "swipe back" gesture, and a page cannot switch
 *    that off — so a thumb never HAS to start there. The key follows the
 *    DISTANCE dragged (never jumps to the finger), so a tap anywhere on the
 *    track is still nothing: only a real slide of 85 % of the travel locks.
 *  - Released at or past 85 % of the travel (`slideLocks`): the key locks at
 *    the end, shows a check, the label becomes `doneLabel`, `onConfirm`
 *    fires ONCE.
 *  - The keyboard and assistive tech: the key is a real button; Enter,
 *    Space or a screen reader's activation confirm (a click that no pointer
 *    made — a pointer's own click is ignored, the drag decides).
 *  - If the work it started ends without leaving the screen (`busy` went
 *    true and came back, or never started), the key returns to the start so
 *    it can be slid again.
 *  - `tone="post"` (the General post composer, Nov 26 2026): the accent key
 *    in a 48 px track. Locked, the track reads `busyLabel` while the work
 *    runs; `done` turns the key and its trail green and reads `doneLabel`.
 */
interface SlideToConfirmProps {
  /** The track's words at rest, e.g. "Go Live". */
  label: string;
  /** The track's words once locked, e.g. "Live". */
  doneLabel: string;
  /** The key's accessible name, e.g. "Slide to go live". */
  ariaLabel: string;
  onConfirm: () => void;
  /** The confirm cannot be given yet (the caller says why nearby). */
  disabled?: boolean;
  /** The work the confirm started is running. */
  busy?: boolean;
  /** The track's words while locked and the work runs, e.g. "Posting" (default: `doneLabel`). */
  busyLabel?: string;
  /** The work succeeded: the locked key stays, in the done colours (tone "post"). */
  done?: boolean;
  /** 'live' (default): the red 48 px key in a 56 px track. 'post': the accent 40 px key in a 48 px track. */
  tone?: 'live' | 'post';
  className?: string;
}

const SPRING = 'cubic-bezier(.3,1.4,.5,1)';

export default function SlideToConfirm({ label, doneLabel, ariaLabel, onConfirm, disabled = false, busy = false, busyLabel, done = false, tone = 'live', className = '' }: SlideToConfirmProps) {
  const post = tone === 'post';
  const keySize = post ? SLIDE_KEY_COMPACT : SLIDE_KEY;
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; travel: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [locked, setLocked] = useState(false);

  // The work finished and we are still here (a failed Go Live): back to rest.
  const [prevBusy, setPrevBusy] = useState(busy);
  if (prevBusy !== busy) {
    setPrevBusy(busy);
    if (!busy && locked && !done) {
      setLocked(false);
      setOffset(0);
    }
  }
  // …or it never started (the caller refused): do not strand a locked key.
  useEffect(() => {
    if (!locked || busy || done) return;
    const timer = setTimeout(() => {
      setLocked(false);
      setOffset(0);
    }, 2500);
    return () => clearTimeout(timer);
  }, [locked, busy, done]);

  const travelNow = () => slideTravel(trackRef.current?.clientWidth ?? 0, keySize);
  const lock = (travel: number) => {
    setOffset(travel);
    setLocked(true);
    haptic();
    onConfirm();
  };
  const off = disabled || busy || locked;
  const state = locked ? 'locked' : dragging ? 'dragging' : 'rest';

  return (
    <div
      ref={trackRef}
      className={`ea-mech-recess relative overflow-hidden ${post ? 'h-12 rounded-[14px]' : 'h-14 rounded-2xl'} ${disabled ? (post ? 'opacity-[0.45]' : 'opacity-50') : ''} ${className}`}
      data-slide-track=""
      data-slide-state={state}
      data-slide-tone={tone}
      data-slide-done={done ? '' : undefined}
      style={{ touchAction: 'none' }}
      onPointerDown={e => {
        if (off || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { startX: e.clientX, travel: travelNow() };
        setDragging(true);
      }}
      onPointerMove={e => {
        const d = drag.current;
        if (!d) return;
        setOffset(slideOffset(e.clientX - d.startX, d.travel));
      }}
      onPointerUp={e => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        setDragging(false);
        const at = slideOffset(e.clientX - d.startX, d.travel);
        if (slideLocks(at, d.travel)) lock(d.travel);
        else setOffset(0);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
        setOffset(0);
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0"
        style={{
          width: offset > 0 ? slideTrailWidth(offset, keySize) : 0,
          backgroundColor: post ? (done ? 'var(--mech-posted-trail)' : 'var(--mech-post-trail)') : 'var(--mech-go-live-trail)',
          transition: dragging ? 'none' : `width 260ms ${SPRING}`,
        }}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[15px] font-semibold ${post ? (locked ? 'pr-11' : 'pl-11') : 'pl-[52px]'}`}
        style={{ color: locked ? '#ffffff' : 'var(--mech-close-icon)' }}
        data-slide-label=""
      >
        {locked ? (done || busyLabel === undefined ? doneLabel : busyLabel) : label}
      </span>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        disabled={busy && !locked}
        data-step-finish=""
        data-slide-key=""
        data-tone={tone}
        data-done={done ? '' : undefined}
        className={`ea-mech-slide-key absolute left-1 top-1 inline-flex items-center justify-center text-white ${post ? 'h-10 w-10 rounded-[11px]' : 'h-12 w-12 rounded-xl'}`}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : `transform 260ms ${SPRING}`,
        }}
        onClick={e => {
          // detail 0: the keyboard or assistive tech made this click. A
          // pointer's click (detail ≥ 1) is the end of a drag — ignored.
          if (e.detail !== 0 || off) return;
          lock(travelNow());
        }}
      >
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          {locked && (done || !post) ? <path d="M3.6 9.4 7.4 13l7-8" /> : <path d="M3.5 4.2 8.3 9l-4.8 4.8M9.7 4.2 14.5 9l-4.8 4.8" />}
        </svg>
      </button>
    </div>
  );
}
