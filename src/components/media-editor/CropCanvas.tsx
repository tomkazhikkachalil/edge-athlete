'use client';

/**
 * The hands-on crop stage (Oct 2026). The picture sits still, fitted to the
 * stage; the person shapes the crop box itself with their fingers:
 *
 *   a corner   → resizes two sides          an edge      → resizes one side
 *   inside     → moves the box              two fingers  → scales the box
 *
 * so any area is reachable, not only the ratio chips. Mouse and keyboard get
 * the same handles (arrow keys nudge the focused one). Shared by the photo
 * stage (FreeCropStage) and the video stage (VideoCropStage); surfaces that
 * ENFORCE a ratio (avatar, cover, logo) keep the fixed-frame CropStage.
 *
 * This file only translates pointers: every rule (the frame, the minimum, a
 * locked ratio, staying on a tilted picture) is src/lib/media/crop-box.ts.
 * The box is LOCAL state while a gesture runs and is committed once, when
 * the last finger lifts — one gesture, one undo step.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  CROP_CORNERS,
  CROP_EDGES,
  dragCrop,
  frameBounds,
  fullCrop,
  normalizeCrop,
  scaleCrop,
  type CropContext,
  type CropFrame,
  type CropHandle,
} from '@/lib/media/crop-box';
import { totalRotation } from '@/lib/media/crop-math';
import type { CropRect } from '@/lib/media/types';

/** Room round the picture so a corner on its very edge is still a 44px
 *  target, clear of the screen edge (iOS swipes back from there). */
const STAGE_PAD = 28;
/** The box never gets smaller than this on screen — its handles would merge. */
const MIN_BOX_PX = 64;
/** …nor than this in source pixels, however far the stage is zoomed out. */
const MIN_BOX_SOURCE = 16;
const CORNER_HIT = 44;
const EDGE_HIT = 32;

const HANDLE_LABELS: Record<CropHandle, string> = {
  nw: 'Crop corner, top left',
  ne: 'Crop corner, top right',
  sw: 'Crop corner, bottom left',
  se: 'Crop corner, bottom right',
  n: 'Crop edge, top',
  s: 'Crop edge, bottom',
  e: 'Crop edge, right',
  w: 'Crop edge, left',
};

const HANDLE_CURSORS: Record<CropHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

type Gesture =
  | {
      mode: 'drag';
      pointerId: number;
      handle: CropHandle | 'move';
      start: CropRect;
      last: CropRect;
      x: number;
      y: number;
    }
  /** `origin` is the box before the gesture began (a pinch may take over a
   *  drag); `start` the box when the second finger landed. */
  | { mode: 'pinch'; origin: CropRect; start: CropRect; last: CropRect; distance: number }
  /** A pinch ended with a finger still down — wait for it to lift. */
  | { mode: 'spent' };

export interface CropCanvasProps {
  /** null until the media has reported its natural size. */
  frame: CropFrame | null;
  /** The committed box; null = the whole frame. */
  crop: CropRect | null;
  /** Locked width / height, or null for a free box. */
  aspect: number | null;
  flipH?: boolean;
  flipV?: boolean;
  /** One finished gesture. `keys` is its undo-coalescing signature. */
  onCommit: (crop: CropRect | null, keys: string) => void;
  /** Renders the media element with the style that sizes and turns it. */
  children: (mediaStyle: CSSProperties) => ReactNode;
}

function cornerStyle(handle: CropHandle): CSSProperties {
  const offset = -CORNER_HIT / 2;
  return {
    width: CORNER_HIT,
    height: CORNER_HIT,
    cursor: HANDLE_CURSORS[handle],
    ...(handle.includes('n') ? { top: offset } : { bottom: offset }),
    ...(handle.includes('w') ? { left: offset } : { right: offset }),
  };
}

/** The two bars of a corner bracket, drawn just outside the box's corner. */
function bracketStyles(handle: CropHandle): [CSSProperties, CSSProperties] {
  const inset = CORNER_HIT / 2 - 3;
  const vertical = handle.includes('n') ? { top: inset } : { bottom: inset };
  const horizontal = handle.includes('w') ? { left: inset } : { right: inset };
  return [
    { ...vertical, ...horizontal, width: 22, height: 3 },
    { ...vertical, ...horizontal, width: 3, height: 22 },
  ];
}

function edgeStyle(handle: CropHandle): CSSProperties {
  const along = CORNER_HIT / 2;
  const across = -EDGE_HIT / 2;
  if (handle === 'n' || handle === 's') {
    return {
      left: along,
      right: along,
      height: EDGE_HIT,
      cursor: HANDLE_CURSORS[handle],
      ...(handle === 'n' ? { top: across } : { bottom: across }),
    };
  }
  return {
    top: along,
    bottom: along,
    width: EDGE_HIT,
    cursor: HANDLE_CURSORS[handle],
    ...(handle === 'w' ? { left: across } : { right: across }),
  };
}

export default function CropCanvas({
  frame,
  crop,
  aspect,
  flipH = false,
  flipV = false,
  onCommit,
  children,
}: CropCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  // The box while a gesture runs; null = show the committed one.
  const [draft, setDraft] = useState<CropRect | null>(null);
  const [active, setActive] = useState(false);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<Gesture | null>(null);
  const gestureCountRef = useRef(0);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box) setStage({ width: box.width, height: box.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const bounds = frame ? frameBounds(frame) : null;
  const scale =
    bounds && stage.width > 2 * STAGE_PAD && stage.height > 2 * STAGE_PAD
      ? Math.min(
          (stage.width - 2 * STAGE_PAD) / bounds.width,
          (stage.height - 2 * STAGE_PAD) / bounds.height
        )
      : 0;
  const ready = !!frame && !!bounds && scale > 0;
  const rect = frame ? (draft ?? crop ?? fullCrop(frame)) : null;
  const context: CropContext | null =
    frame && ready
      ? { frame, aspect, minSize: Math.max(MIN_BOX_SOURCE, MIN_BOX_PX / scale) }
      : null;

  const pinchDistance = () => {
    const [a, b] = [...pointersRef.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const finish = (start: CropRect, last: CropRect) => {
    setDraft(null);
    setActive(false);
    if (!frame) return;
    const moved =
      Math.abs(start.x - last.x) +
        Math.abs(start.y - last.y) +
        Math.abs(start.width - last.width) +
        Math.abs(start.height - last.height) >
      0.5;
    if (!moved) return; // a tap is not an edit
    gestureCountRef.current += 1;
    onCommit(normalizeCrop(last, frame), `crop.${gestureCountRef.current}`);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!context || !rect) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const pointers = pointersRef.current;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic/untrusted events have no capturable pointer.
    }
    const current = gestureRef.current;
    if (pointers.size === 1) {
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-crop-handle]');
      const handle = target?.dataset.cropHandle as CropHandle | 'move' | undefined;
      if (!handle) return;
      gestureRef.current = {
        mode: 'drag',
        pointerId: e.pointerId,
        handle,
        start: rect,
        last: rect,
        x: e.clientX,
        y: e.clientY,
      };
      setActive(true);
    } else if (pointers.size === 2 && current?.mode !== 'spent') {
      // A second finger turns whatever was happening into a scale, from the
      // box as it stands (one gesture, so still one undo step).
      const start = current ? current.last : rect;
      const origin = current ? (current.mode === 'pinch' ? current.origin : current.start) : rect;
      gestureRef.current = { mode: 'pinch', origin, start, last: start, distance: pinchDistance() };
      setActive(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const gesture = gestureRef.current;
    if (!gesture || !context) return;
    if (gesture.mode === 'drag' && e.pointerId === gesture.pointerId) {
      const next = dragCrop(
        gesture.start,
        gesture.handle,
        (e.clientX - gesture.x) / scale,
        (e.clientY - gesture.y) / scale,
        gesture.last,
        context
      );
      gesture.last = next;
      setDraft(next);
    } else if (gesture.mode === 'pinch' && pointers.size >= 2 && gesture.distance > 0) {
      const next = scaleCrop(gesture.start, pinchDistance() / gesture.distance, gesture.last, context);
      gesture.last = next;
      setDraft(next);
    }
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.delete(e.pointerId)) return;
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.mode === 'drag') {
      if (e.pointerId !== gesture.pointerId) return;
      gestureRef.current = null;
      finish(gesture.start, gesture.last);
    } else if (gesture.mode === 'pinch') {
      gestureRef.current = pointers.size > 0 ? { mode: 'spent' } : null;
      finish(gesture.origin, gesture.last);
    } else if (pointers.size === 0) {
      gestureRef.current = null;
    }
  };

  const onHandleKey = (handle: CropHandle | 'move') => (e: React.KeyboardEvent) => {
    if (!context || !rect || !frame || !bounds) return;
    const unit = Math.max(1, Math.round(Math.max(bounds.width, bounds.height) / 100));
    const step = e.shiftKey ? unit * 5 : unit;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[e.key];
    if (!move) return;
    e.preventDefault();
    e.stopPropagation();
    const next = dragCrop(rect, handle, move[0], move[1], rect, context);
    onCommit(normalizeCrop(next, frame), `crop.key.${handle}`);
  };

  const rotation = frame ? totalRotation(frame.rotate, frame.straighten) : 0;
  const mediaStyle: CSSProperties =
    ready && frame
      ? {
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: frame.natural.width * scale,
          height: frame.natural.height * scale,
          maxWidth: 'none',
          maxHeight: 'none',
          transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`,
          pointerEvents: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }
      : // Not measured yet: mounted (so it can load and report its size) but unseen.
        { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' };

  const boxWidth = rect ? rect.width * scale : 0;
  const boxHeight = rect ? rect.height * scale : 0;
  const untouched = crop === null && draft === null;

  return (
    <div
      ref={stageRef}
      data-crop-stage
      className="relative flex-1 min-h-0 overflow-hidden touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={e => e.preventDefault()}
    >
      <div
        className="absolute"
        style={
          ready && bounds
            ? {
                left: (stage.width - bounds.width * scale) / 2,
                top: (stage.height - bounds.height * scale) / 2,
                width: bounds.width * scale,
                height: bounds.height * scale,
              }
            : { left: 0, top: 0, width: 0, height: 0 }
        }
      >
        {children(mediaStyle)}

        {ready && rect && (
          <div
            data-crop-box
            data-crop-rect={`${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`}
            className="absolute border border-white/90 transition-shadow duration-150"
            style={{
              left: rect.x * scale,
              top: rect.y * scale,
              width: boxWidth,
              height: boxHeight,
              // The dim outside the box; the stage clips it. Lighter while a
              // finger is down, so what is being cut stays readable.
              boxShadow: `0 0 0 9999px rgba(0, 0, 0, ${active ? 0.45 : 0.65})`,
            }}
          >
            {/* Rule of thirds — brighter while the box is being shaped. */}
            <div
              aria-hidden="true"
              className={`absolute inset-0 pointer-events-none transition-opacity duration-150 ${
                active ? 'opacity-100' : 'opacity-40'
              }`}
            >
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/50" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/50" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/50" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/50" />
            </div>

            <button
              type="button"
              data-crop-handle="move"
              aria-label="Crop area — drag to move"
              onKeyDown={onHandleKey('move')}
              className="absolute inset-0 cursor-move"
            />

            {CROP_EDGES.map(handle => {
              const horizontal = handle === 'n' || handle === 's';
              const side = horizontal ? boxWidth : boxHeight;
              return (
                <button
                  key={handle}
                  type="button"
                  data-crop-handle={handle}
                  aria-label={HANDLE_LABELS[handle]}
                  onKeyDown={onHandleKey(handle)}
                  className="absolute flex items-center justify-center"
                  style={edgeStyle(handle)}
                >
                  {side >= 120 && (
                    <span
                      aria-hidden="true"
                      className="block rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.6)]"
                      style={horizontal ? { width: 28, height: 4 } : { width: 4, height: 28 }}
                    />
                  )}
                </button>
              );
            })}

            {CROP_CORNERS.map(handle => {
              const [barA, barB] = bracketStyles(handle);
              return (
                <button
                  key={handle}
                  type="button"
                  data-crop-handle={handle}
                  aria-label={HANDLE_LABELS[handle]}
                  onKeyDown={onHandleKey(handle)}
                  className="absolute"
                  style={cornerStyle(handle)}
                >
                  <span
                    aria-hidden="true"
                    className="absolute bg-white shadow-[0_0_2px_rgba(0,0,0,0.6)]"
                    style={barA}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute bg-white shadow-[0_0_2px_rgba(0,0,0,0.6)]"
                    style={barB}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* What to do, then what you have: the hint becomes the crop's size. */}
      {ready && rect && (
        <p
          data-crop-readout
          className="absolute top-1 inset-x-0 text-center text-chip text-white/80 pointer-events-none tabular-nums"
        >
          {untouched
            ? 'Drag the corners or edges to crop'
            : `${Math.round(rect.width)} × ${Math.round(rect.height)}`}
        </p>
      )}
    </div>
  );
}
