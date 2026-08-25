'use client';

/**
 * Clone-stamp handles over the live stage (E4g). Solid circle = the
 * destination being healed; dashed circle = the source being copied from;
 * a hairline links them. Tap empty stage to drop a new stamp (destination
 * under the finger); drag either circle to reposition. Interaction math
 * is pure (clone-math) — this component only routes pointer events, same
 * doctrine as MaskOverlay.
 */

import { useRef } from 'react';
import {
  defaultCloneStamp,
  MAX_CLONE_STAMPS,
  moveStampPoint,
} from '@/lib/media/engine/clone-math';
import type { CloneStamp } from '@/lib/media/types';

interface RetouchOverlayProps {
  clones: CloneStamp[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onChange: (clones: CloneStamp[], keys: string) => void;
}

type DragState = { index: number; which: 'src' | 'dst' };

export default function RetouchOverlay({
  clones,
  selectedIndex,
  onSelect,
  onChange,
}: RetouchOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const toNorm = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const startDrag = (e: React.PointerEvent, index: number, which: 'src' | 'dst') => {
    e.stopPropagation();
    onSelect(index);
    dragRef.current = { index, which };
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events have no capturable pointer
    }
  };

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-label="Retouch overlay"
      className="absolute inset-0 w-full h-full touch-none"
      onPointerDown={e => {
        // Empty-stage tap drops a new stamp, destination under the finger.
        if (clones.length >= MAX_CLONE_STAMPS) return;
        const p = toNorm(e);
        const stamp = defaultCloneStamp(p.x, p.y);
        onChange([...clones, stamp], 'clone.add');
        onSelect(clones.length);
        // Immediately drag the destination for fine placement.
        dragRef.current = { index: clones.length, which: 'dst' };
        try {
          svgRef.current?.setPointerCapture(e.pointerId);
        } catch {
          // synthetic events have no capturable pointer
        }
      }}
      onPointerMove={e => {
        const drag = dragRef.current;
        if (!drag) return;
        const stamp = clones[drag.index];
        if (!stamp) return;
        const p = toNorm(e);
        onChange(
          clones.map((s, i) => (i === drag.index ? moveStampPoint(stamp, drag.which, p.x, p.y) : s)),
          `clone.${drag.index}.geom`
        );
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      {clones.map((stamp, i) => {
        const selected = i === selectedIndex;
        const stroke = selected ? '#a78bfa' : 'rgba(255,255,255,0.55)';
        // rx in viewBox-x units; ry corrected for the stretched viewBox so
        // circles LOOK round (radius is a width fraction).
        const rx = stamp.radius * 100;
        return (
          <g key={i}>
            <line
              x1={stamp.srcX * 100}
              y1={stamp.srcY * 100}
              x2={stamp.dstX * 100}
              y2={stamp.dstY * 100}
              stroke={stroke}
              strokeWidth={0.4}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'none' }}
            />
            <ellipse
              cx={stamp.dstX * 100}
              cy={stamp.dstY * 100}
              rx={rx}
              ry={rx}
              fill={selected ? 'rgba(167,139,250,0.10)' : 'transparent'}
              stroke={stroke}
              strokeWidth={selected ? 0.8 : 0.5}
              vectorEffect="non-scaling-stroke"
              role="button"
              aria-label={`Retouch spot ${i + 1}`}
              className="cursor-move"
              style={{ pointerEvents: 'all' }}
              onPointerDown={e => startDrag(e, i, 'dst')}
            />
            <ellipse
              cx={stamp.srcX * 100}
              cy={stamp.srcY * 100}
              rx={rx}
              ry={rx}
              fill="transparent"
              stroke={stroke}
              strokeWidth={selected ? 0.7 : 0.4}
              strokeDasharray="2 1.5"
              vectorEffect="non-scaling-stroke"
              role="button"
              aria-label={`Retouch source ${i + 1}`}
              className="cursor-move"
              style={{ pointerEvents: 'all' }}
              onPointerDown={e => startDrag(e, i, 'src')}
            />
          </g>
        );
      })}
    </svg>
  );
}
