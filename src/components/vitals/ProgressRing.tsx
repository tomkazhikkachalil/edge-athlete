'use client';

import type { CSSProperties, ReactNode } from 'react';

/**
 * A round progress ring that fills on mount. The fill animation is CSS-owned
 * (`vt-ring-fill` animates from the full circumference to this element's own
 * inline offset), so it costs no render, trips no set-state-in-effect rule,
 * and is neutralised by the global reduced-motion block for free.
 *
 * `color` accepts any SVG stroke value — pass a CSS var (e.g.
 * `var(--brand-fg)`) so the ring re-themes without a useTheme() read.
 */
interface ProgressRingProps {
  /** Fill fraction, clamped to 0..1. */
  value: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  ariaLabel: string;
  /** Centered content — the big number and its quiet label. */
  children?: ReactNode;
}

export default function ProgressRing({
  value,
  size = 112,
  strokeWidth = 10,
  color,
  ariaLabel,
  children,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(1, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-sunken)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="vt-ring-fill"
          style={{ '--vt-ring-c': String(circumference) } as CSSProperties}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {children}
        </div>
      )}
    </div>
  );
}
