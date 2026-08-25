'use client';

/**
 * DOM preview of text/sticker overlays over the live stage (E4h). Same
 * normalized coordinates and the same bundled fonts as the canvas export
 * (layout math shared via overlay-layout.ts) — the only divergence is the
 * platform's glyph rasterizer, documented and sub-pixel. Interactive on
 * the Text tool (drag to place); static elsewhere so the composition is
 * always visible.
 */

import { useEffect, useRef, useState } from 'react';
import {
  OVERLAY_FONT_FAMILIES,
  OVERLAY_FONT_WEIGHTS,
  PILL_FILL,
  PILL_PAD_X,
  PILL_PAD_Y,
} from '@/lib/media/engine/overlay-layout';
import type { Overlay } from '@/lib/media/types';

interface OverlayLayerProps {
  overlays: Overlay[];
  selectedIndex: number;
  interactive: boolean;
  /** Hold-to-compare hides overlays — they're part of the edit. */
  hidden: boolean;
  onSelect: (index: number) => void;
  onChange: (overlays: Overlay[], keys: string) => void;
}

export default function OverlayLayer({
  overlays,
  selectedIndex,
  interactive,
  hidden,
  onSelect,
  onChange,
}: OverlayLayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<number | null>(null);
  const [stageWidth, setStageWidth] = useState(0);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      setStageWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const toNorm = (e: { clientX: number; clientY: number }) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0.5, y: 0.5 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  if (hidden) return null;

  return (
    <div
      ref={rootRef}
      aria-label="Text overlay layer"
      className="absolute inset-0 overflow-hidden"
      style={{ pointerEvents: 'none' }}
      onPointerMove={e => {
        if (dragRef.current === null) return;
        const p = toNorm(e);
        const index = dragRef.current;
        onChange(
          overlays.map((o, i) => (i === index ? { ...o, x: p.x, y: p.y } : o)),
          `overlay.${index}.pos`
        );
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      {overlays.map((overlay, i) => {
        const fontPx = stageWidth > 0 ? overlay.size * stageWidth : 16;
        const isText = overlay.kind === 'text';
        return (
          <div
            key={i}
            role={interactive ? 'button' : undefined}
            aria-label={interactive ? `Overlay ${i + 1}` : undefined}
            onPointerDown={
              interactive
                ? e => {
                    e.stopPropagation();
                    onSelect(i);
                    dragRef.current = i;
                    try {
                      rootRef.current?.setPointerCapture(e.pointerId);
                    } catch {
                      // synthetic events have no capturable pointer
                    }
                  }
                : undefined
            }
            style={{
              position: 'absolute',
              left: `${overlay.x * 100}%`,
              top: `${overlay.y * 100}%`,
              transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg)`,
              fontSize: `${fontPx}px`,
              lineHeight: 1,
              whiteSpace: 'pre',
              userSelect: 'none',
              touchAction: 'none',
              cursor: interactive ? 'move' : undefined,
              pointerEvents: interactive ? 'all' : 'none',
              ...(isText
                ? {
                    fontFamily: `${OVERLAY_FONT_FAMILIES[overlay.fontId]}, sans-serif`,
                    fontWeight: OVERLAY_FONT_WEIGHTS[overlay.fontId],
                    color: overlay.color,
                    ...(overlay.pill
                      ? {
                          background: PILL_FILL,
                          padding: `${PILL_PAD_Y * fontPx}px ${PILL_PAD_X * fontPx}px`,
                          borderRadius: `${0.45 * fontPx}px`,
                        }
                      : {}),
                  }
                : {}),
              outline:
                interactive && i === selectedIndex ? '1.5px dashed #a78bfa' : undefined,
              outlineOffset: 2,
            }}
          >
            {isText ? overlay.content : overlay.emoji}
          </div>
        );
      })}
    </div>
  );
}
