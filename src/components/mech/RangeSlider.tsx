'use client';

import { useRef, useState } from 'react';
import { rangeFraction, rangeKeyStep, rangeTravel, rangeValueAt, type RangeScale } from '@/lib/mech/range';

/**
 * A range slider of the mechanical dialect (Nov 27 2026): a recessed track
 * whose part behind the key is filled, and a light metal key that rides it.
 * The whole 44 px row is the target: a press anywhere moves the key there
 * and a drag carries it (touch and mouse, one pointer path); arrows step it,
 * Page keys jump, Home / End go to the ends. It is a real `role="slider"`,
 * so it reads and tests as one. It owns no data: the caller holds the value.
 * The numbers are range.ts's.
 */
const KEY_WIDTH = 26;

interface RangeSliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** The slider's accessible name, e.g. "Gimme distance in feet". */
  label: string;
  /** How assistive tech says the value, e.g. "6 feet". */
  valueText?: string;
  className?: string;
}

export default function RangeSlider({ value, onChange, min, max, step = 1, label, valueText, className = '' }: RangeSliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const scale: RangeScale = { min, max, step };
  const fraction = rangeFraction(value, scale);
  // The key's left edge, without measuring: a share of the track minus the key.
  const left = `calc(${fraction} * (100% - ${KEY_WIDTH}px))`;

  const moveTo = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const next = rangeValueAt(clientX - box.left, KEY_WIDTH, rangeTravel(box.width, KEY_WIDTH), scale);
    if (next !== value) onChange(next);
  };
  const release = () => setDragging(false);

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      data-range-slider=""
      data-range-value={value}
      {...(dragging ? { 'data-dragging': '' } : {})}
      className={`ea-mech-range relative h-11 min-w-0 select-none touch-pan-y ${className}`}
      onPointerDown={e => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        moveTo(e.clientX);
      }}
      onPointerMove={e => { if (dragging) moveTo(e.clientX); }}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={e => {
        const next = rangeKeyStep(e.key, value, scale);
        if (next === null) return;
        e.preventDefault();
        if (next !== value) onChange(next);
      }}
    >
      <span aria-hidden="true" className="ea-mech-range-track absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded" />
      <span
        aria-hidden="true"
        className="ea-mech-range-fill absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded"
        style={{ width: `calc(${left} + ${KEY_WIDTH / 2}px)` }}
      />
      <span
        aria-hidden="true"
        className="ea-mech-range-key absolute top-1/2 -translate-y-1/2 rounded-[9px]"
        style={{ left, width: KEY_WIDTH, height: 30 }}
        data-range-key=""
      />
    </div>
  );
}
