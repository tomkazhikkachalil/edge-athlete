'use client';

/**
 * SVG tone-curve editor. All interaction MATH is pure (curves-math:
 * movePoint/addPoint/removePoint/evaluateCurve) — this component only
 * translates pointer events into those calls, so the rules are node-tested
 * and this stays thin.
 *
 * Gestures: drag a point; tap empty curve space to add a point (max 8);
 * double-tap a point to remove it (endpoints anchor the domain and can
 * only move vertically).
 */

import { useRef } from 'react';
import {
  addPoint,
  evaluateCurve,
  movePoint,
  removePoint,
} from '@/lib/media/engine/curves-math';
import type { CurvePoint } from '@/lib/media/types';

const SIZE = 256;
const CURVE_SAMPLES = 64;

interface CurveEditorProps {
  points: CurvePoint[];
  /** Stroke/fill for the active channel (white for master, r/g/b tints). */
  color: string;
  onChange: (points: CurvePoint[]) => void;
}

export default function CurveEditor({ points, color, onChange }: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const draggedRef = useRef(false);
  const lastTapRef = useRef<{ index: number; time: number }>({ index: -1, time: 0 });

  const toNorm = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height)),
    };
  };

  const path = Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => {
    const x = i / CURVE_SAMPLES;
    const y = evaluateCurve(points, x);
    return `${(x * SIZE).toFixed(1)},${((1 - y) * SIZE).toFixed(1)}`;
  }).join(' ');

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="application"
      aria-label="Tone curve"
      className="w-full max-w-[280px] mx-auto aspect-square rounded-lg bg-white/5 ring-1 ring-white/10 touch-none select-none"
      onPointerDown={e => {
        // Empty-space press adds a point right under the pointer and starts
        // dragging it immediately (the Lightroom gesture).
        if (dragIndexRef.current !== null) return;
        const { x, y } = toNorm(e);
        const added = addPoint(points, x, y);
        if (!added) return;
        const index = added.findIndex(p => p.x === Math.min(1, Math.max(0, x)));
        onChange(added);
        dragIndexRef.current = index === -1 ? null : index;
        draggedRef.current = false;
        try {
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        } catch {
          // synthetic events have no capturable pointer
        }
      }}
      onPointerMove={e => {
        if (dragIndexRef.current === null) return;
        draggedRef.current = true;
        const { x, y } = toNorm(e);
        onChange(movePoint(points, dragIndexRef.current, x, y));
      }}
      onPointerUp={() => {
        dragIndexRef.current = null;
      }}
      onPointerCancel={() => {
        dragIndexRef.current = null;
      }}
    >
      {/* Quarter grid + identity diagonal */}
      {[0.25, 0.5, 0.75].map(f => (
        <g key={f} stroke="rgba(255,255,255,0.08)" strokeWidth={1}>
          <line x1={f * SIZE} y1={0} x2={f * SIZE} y2={SIZE} />
          <line x1={0} y1={f * SIZE} x2={SIZE} y2={f * SIZE} />
        </g>
      ))}
      <line x1={0} y1={SIZE} x2={SIZE} y2={0} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="4 4" />
      <polyline points={path} fill="none" stroke={color} strokeWidth={2.5} />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x * SIZE}
          cy={(1 - p.y) * SIZE}
          r={8}
          fill={color}
          stroke="black"
          strokeWidth={1.5}
          role="button"
          aria-label={`Curve point ${i + 1}`}
          onPointerDown={e => {
            e.stopPropagation();
            const now = Date.now();
            const tap = lastTapRef.current;
            if (tap.index === i && now - tap.time < 300) {
              const removed = removePoint(points, i);
              if (removed) {
                onChange(removed);
                lastTapRef.current = { index: -1, time: 0 };
                return;
              }
            }
            lastTapRef.current = { index: i, time: now };
            dragIndexRef.current = i;
            draggedRef.current = false;
            try {
              svgRef.current?.setPointerCapture(e.pointerId);
            } catch {
              // synthetic events have no capturable pointer
            }
          }}
        />
      ))}
    </svg>
  );
}
