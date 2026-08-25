'use client';

/**
 * Mask outlines over the live stage. Absolute SVG in normalized viewBox
 * (0..100, stretched to the image box) so mask coordinates map 1:1.
 * Interaction math is pure (mask-math.moveMask/moveLinearEndpoint) — this
 * component only turns pointer deltas into those calls. Dragging an
 * outline moves the mask; linear endpoints drag individually.
 */

import { useRef } from 'react';
import { moveLinearEndpoint, moveMask } from '@/lib/media/engine/mask-math';
import type { Mask } from '@/lib/media/types';

interface MaskOverlayProps {
  masks: Mask[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onChange: (masks: Mask[], keys: string) => void;
}

type DragState =
  | { index: number; mode: 'move'; lastX: number; lastY: number }
  | { index: number; mode: 'endpoint'; endpoint: 0 | 1 };

export default function MaskOverlay({ masks, selectedIndex, onSelect, onChange }: MaskOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const toNorm = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0, w: 1, h: 1 };
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
      w: rect.width,
      h: rect.height,
    };
  };

  const startDrag = (e: React.PointerEvent, state: DragState, index: number) => {
    e.stopPropagation();
    onSelect(index);
    dragRef.current = state;
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
      aria-label="Mask overlay"
      className="absolute inset-0 w-full h-full touch-none"
      onPointerMove={e => {
        const drag = dragRef.current;
        if (!drag) return;
        const p = toNorm(e);
        const mask = masks[drag.index];
        if (!mask) return;
        let next: Mask;
        if (drag.mode === 'endpoint' && mask.kind === 'linear') {
          next = moveLinearEndpoint(mask, drag.endpoint, p.x, p.y);
        } else if (drag.mode === 'move') {
          next = moveMask(mask, p.x - drag.lastX, p.y - drag.lastY);
          dragRef.current = { ...drag, lastX: p.x, lastY: p.y };
        } else {
          return;
        }
        onChange(
          masks.map((m, i) => (i === drag.index ? next : m)),
          `mask.${drag.index}.geom`
        );
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      {masks.map((mask, i) => {
        const selected = i === selectedIndex;
        const stroke = selected ? '#a78bfa' : 'rgba(255,255,255,0.55)';
        if (mask.kind === 'radial') {
          return (
            <ellipse
              key={i}
              cx={mask.cx * 100}
              cy={mask.cy * 100}
              rx={mask.rx * 100}
              ry={mask.ry * 100}
              fill={selected ? 'rgba(167,139,250,0.08)' : 'transparent'}
              stroke={stroke}
              strokeWidth={selected ? 0.8 : 0.5}
              strokeDasharray={mask.invert ? '2 2' : undefined}
              vectorEffect="non-scaling-stroke"
              role="button"
              aria-label={`Radial mask ${i + 1}`}
              className="cursor-move"
              style={{ pointerEvents: 'all' }}
              onPointerDown={e => {
                const p = toNorm(e);
                startDrag(e, { index: i, mode: 'move', lastX: p.x, lastY: p.y }, i);
              }}
            />
          );
        }
        return (
          <g key={i}>
            <line
              x1={mask.x0 * 100}
              y1={mask.y0 * 100}
              x2={mask.x1 * 100}
              y2={mask.y1 * 100}
              stroke={stroke}
              strokeWidth={selected ? 0.8 : 0.5}
              vectorEffect="non-scaling-stroke"
              role="button"
              aria-label={`Linear mask ${i + 1}`}
              className="cursor-move"
              style={{ pointerEvents: 'all', strokeLinecap: 'round' }}
              strokeDasharray="3 1.5"
              onPointerDown={e => {
                const p = toNorm(e);
                startDrag(e, { index: i, mode: 'move', lastX: p.x, lastY: p.y }, i);
              }}
            />
            {[0, 1].map(end => (
              <circle
                key={end}
                cx={(end === 0 ? mask.x0 : mask.x1) * 100}
                cy={(end === 0 ? mask.y0 : mask.y1) * 100}
                r={2}
                fill={end === 0 ? stroke : 'black'}
                stroke={stroke}
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
                role="button"
                aria-label={`Linear mask ${i + 1} ${end === 0 ? 'start' : 'end'} handle`}
                style={{ pointerEvents: 'all' }}
                onPointerDown={e =>
                  startDrag(e, { index: i, mode: 'endpoint', endpoint: end as 0 | 1 }, i)
                }
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
