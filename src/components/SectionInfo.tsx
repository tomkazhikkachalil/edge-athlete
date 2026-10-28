'use client';

import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';

// ── Explanatory text behind an (i) (Oct 28 2026) ─────────────────────────────
// Tom: a paragraph that only says what a section is for is not on screen
// until asked. An (i) beside the heading expands it inline below; a second
// tap, a tap anywhere else, or Escape collapses it. Always collapsed on
// load, nothing remembered — no storage, no persistence. Labels, fields,
// errors, empty states, consequence captions and anything a person must
// read before acting are NOT this component; they stay visible.
//
// ONE dismiss hook (usePopoverDismiss) on ONE wrapper ref: the wrapper holds
// both the button and the panel, so a tap on the expanded text is "inside"
// and keeps it open, while the button's own click toggles it closed. The
// button is a REAL 44 px box, never the `after:` extender — the Settings
// shell and the site editor's canvases are overflow-hidden, where an
// extender is clipped without warning (the CLIPPING RULE in globals.css).
// The negative margins keep a text-lg heading row at its own line height.
// The panel stays mounted and uses `hidden`, so aria-controls always
// resolves and the fade replays on every open (display:none restarts it).

export function useInfoDisclosure(label: string) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  usePopoverDismiss(wrapRef, open, close);
  // A tuple, the ref apart from the state: the React Compiler lint reads an
  // object that carries a ref as a ref, and refuses every render-time access.
  return [
    wrapRef,
    {
      open,
      buttonProps: {
        type: 'button' as const,
        'aria-expanded': open,
        'aria-controls': panelId,
        'aria-label': `More information about ${label}`,
        onClick: () => setOpen(o => !o),
      },
      panelProps: { id: panelId, hidden: !open },
    },
  ] as const;
}

export type InfoDisclosure = ReturnType<typeof useInfoDisclosure>[1];

/**
 * The (i). A real 44 px target; the negative vertical margin keeps the row at
 * the heading's own line height: `-my-2` for a text-lg row (28 px), `dense`
 * (`-my-3`) for a text-sm label row (20 px).
 */
export function InfoButton({ d, dense = false, className = '' }: { d: InfoDisclosure; dense?: boolean; className?: string }) {
  return (
    <button
      {...d.buttonProps}
      data-section-info-button=""
      className={`ea-interactive inline-flex h-11 w-11 shrink-0 ${dense ? '-my-3' : '-my-2'} -mx-2.5 items-center justify-center rounded-full ${
        d.open ? 'text-brand-fg' : 'text-muted'
      } ${className}`}
    >
      <i className="fas fa-circle-info text-base" aria-hidden="true"></i>
    </button>
  );
}

/** The text, directly under the heading row. Several <p> are fine (`mt-2` on the later ones). */
export function InfoPanel({ d, children, className = '' }: { d: InfoDisclosure; children: ReactNode; className?: string }) {
  return (
    <div {...d.panelProps} data-section-info-panel="" className={`ea-dropdown-in mt-1 text-sm text-tertiary ${className}`}>
      {children}
    </div>
  );
}

interface SectionInfoProps {
  /** The heading text (or node). */
  heading: ReactNode;
  /** The plain name for the button's label; required when `heading` is not a string. */
  label?: string;
  as?: 'h1' | 'h2' | 'h3' | 'h4';
  headingClassName?: string;
  /** The heading's own id (a section's `aria-labelledby` target). */
  headingId?: string;
  /** Right-hand action(s) that already live in the heading row. */
  trailing?: ReactNode;
  /** A text-sm heading row (the button's margin keeps it at 20 px). */
  dense?: boolean;
  /** The old paragraph's margin (`mb-4`, `mb-6`) goes here — the row never moves. */
  className?: string;
  /** The explanatory copy. */
  children: ReactNode;
}

/**
 * A heading row with the (i) glued to the title and the copy below it.
 * Sites whose heading row cannot be owned (a two-column header, a toggle
 * label, a card title) use `useInfoDisclosure` + `InfoButton` + `InfoPanel`.
 */
export default function SectionInfo({
  heading,
  label,
  as: Tag = 'h2',
  headingClassName = 'text-lg font-semibold text-primary',
  headingId,
  trailing,
  dense = false,
  className = '',
  children,
}: SectionInfoProps) {
  const name = label ?? (typeof heading === 'string' ? heading : '');
  if (process.env.NODE_ENV !== 'production' && !name) {
    console.warn('SectionInfo: pass `label` when `heading` is not a string');
  }
  const [wrapRef, d] = useInfoDisclosure(name);
  return (
    <div ref={wrapRef} className={className} data-section-info="">
      <div className="flex flex-wrap items-center gap-1">
        <Tag id={headingId} className={headingClassName}>{heading}</Tag>
        <InfoButton d={d} dense={dense} />
        {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
      </div>
      <InfoPanel d={d}>{children}</InfoPanel>
    </div>
  );
}
