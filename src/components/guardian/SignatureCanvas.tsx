'use client';

import { useRef, useState } from 'react';
import type { SignatureStroke } from '@/lib/consent-signature';

// Drawn-signature capture (Wave 3). Conventions from the media editor's
// MaskOverlay: pointer capture, coordinates normalized 0..1 against the
// box's live rect, `touch-none` so drawing never scrolls the page. The
// strokes stay normalized — renderSignatureCard maps them onto the card.

const MAX_POINTS_PER_STROKE = 512;

export default function SignatureCanvas({
  strokes,
  onChange,
}: {
  strokes: SignatureStroke[];
  onChange: (strokes: SignatureStroke[]) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState(false);

  const toNorm = (e: React.PointerEvent): { x: number; y: number } | null => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handleDown = (e: React.PointerEvent) => {
    const p = toNorm(e);
    if (!p) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrawing(true);
    onChange([...strokes, [p]]);
  };

  const handleMove = (e: React.PointerEvent) => {
    if (!drawing) return;
    const p = toNorm(e);
    if (!p) return;
    const next = strokes.slice();
    const current = next[next.length - 1];
    if (!current || current.length >= MAX_POINTS_PER_STROKE) return;
    next[next.length - 1] = [...current, p];
    onChange(next);
  };

  const handleUp = () => setDrawing(false);

  return (
    <div>
      <div
        ref={boxRef}
        className="relative w-full h-40 bg-surface border-2 border-dashed border-border-strong rounded-lg touch-none cursor-crosshair"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        role="img"
        aria-label="Signature box — sign with your finger or mouse"
      >
        <svg viewBox="0 0 100 50" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
          {strokes.map((stroke, i) => (
            <polyline
              key={i}
              points={stroke.map(p => `${p.x * 100},${p.y * 50}`).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="0.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
            />
          ))}
        </svg>
        {strokes.length === 0 && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-faint pointer-events-none">
            Sign here
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange([])}
        disabled={strokes.length === 0}
        className="mt-1 inline-flex min-h-[44px] items-center text-xs font-semibold text-brand-fg hover:underline disabled:opacity-40 disabled:no-underline"
      >
        Clear signature
      </button>
    </div>
  );
}
