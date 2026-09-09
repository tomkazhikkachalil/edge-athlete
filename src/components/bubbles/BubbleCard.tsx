'use client';

import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * One bubble in a glance grid — the house bubble card, lifted from
 * vitals/StatBubbleCard in Org Pages R2 (Sep 8 2026) so the league/club
 * pages speak the same language as Vitals. Tappable when `onOpen` is given
 * (the whole card is the button — kid-sized target), static otherwise. Span
 * maps to LITERAL col-span classes (JIT purge — never interpolate) on the
 * host's `grid-cols-2 lg:grid-cols-4` grid. Surface, radius, shadow and
 * entrance come from `.ea-bubble` + `.ea-pop-in`; hover/press from
 * `.ea-interactive` — the dialect's scope (.vt-scope / .org-app-scope)
 * decides how soft the shadows are.
 */

const SPAN_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'col-span-1',
  md: 'col-span-2',
  lg: 'col-span-2 lg:col-span-4',
};

export interface BubbleCardProps {
  span?: 'sm' | 'md' | 'lg';
  icon: LucideIcon;
  /** Accent classes — literal strings only. */
  iconClassName?: string;
  iconBgClassName?: string;
  label: string;
  onOpen?: () => void;
  /** Entry-stagger position; sets the pop-in delay. */
  staggerIndex?: number;
  /** Data attributes for the card's root (e2e hooks like data-org-bubble). */
  rootAttrs?: Record<`data-${string}`, string>;
  children: ReactNode;
}

export default function BubbleCard({
  span = 'md',
  icon: Icon,
  iconClassName = 'text-brand-fg',
  iconBgClassName = 'bg-brand-soft',
  label,
  onOpen,
  staggerIndex = 0,
  rootAttrs,
  children,
}: BubbleCardProps) {
  const delay = { animationDelay: `${Math.min(staggerIndex, 10) * 40}ms` };

  const header = (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconBgClassName}`}>
          <Icon className={`w-4 h-4 ${iconClassName}`} aria-hidden="true" />
        </span>
        <span className="text-xs font-bold text-muted uppercase tracking-wide truncate">{label}</span>
      </div>
      {onOpen && <ChevronRight className="w-4 h-4 text-faint shrink-0" aria-hidden="true" />}
    </div>
  );

  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        style={delay}
        {...rootAttrs}
        className={`ea-bubble ea-pop-in ea-interactive w-full text-left p-4 sm:p-5 ${SPAN_CLASSES[span]}`}
      >
        {header}
        {children}
      </button>
    );
  }
  return (
    <div style={delay} {...rootAttrs} className={`ea-bubble ea-pop-in p-4 sm:p-5 ${SPAN_CLASSES[span]}`}>
      {header}
      {children}
    </div>
  );
}
