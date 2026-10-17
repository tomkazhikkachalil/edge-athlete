'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTruncated } from '@/lib/workouts/name-field';

// ── An exercise name on one line (Oct 17 2026) ─────────────────────────────
// Tom: a name too long to fit ends in "…"; a tap shows it whole; a second tap
// or a tap anywhere else closes it; a name that fits does not react. One
// element throughout (so it stays measured); it is a button only while cut.

interface Props {
  name: string;
  /** Size, weight, colour and flex sizing from the host (never `truncate`). */
  className?: string;
  as?: 'span' | 'p' | 'h3';
}

export default function ExerciseName({ name, className = '', as = 'span' }: Props) {
  const ref = useRef<HTMLElement | null>(null);
  const [cut, setCut] = useState(false);
  const [open, setOpen] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (el && !open) setCut(isTruncated(el.scrollWidth, el.clientWidth));
  }, [open]);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, name]);

  // Open: a tap anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const interactive = cut || open;
  const toggle = () => setOpen(o => !o);

  const Tag = as;
  return (
    <Tag
      ref={ref as React.Ref<HTMLHeadingElement & HTMLParagraphElement & HTMLSpanElement>}
      className={`block min-w-0 ${open ? 'whitespace-normal break-words' : 'truncate'} ${interactive ? 'cursor-pointer' : ''} ${className}`}
      data-exercise-name=""
      data-exercise-name-state={open ? 'open' : cut ? 'cut' : 'fits'}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-expanded={interactive ? open : undefined}
      title={interactive && !open ? name : undefined}
      onClick={interactive ? (e: React.MouseEvent) => { e.stopPropagation(); toggle(); } : undefined}
      onKeyDown={interactive ? (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      } : undefined}
    >
      {name}
    </Tag>
  );
}
