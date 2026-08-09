'use client';

import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import type { MentionCandidate } from '@/hooks/useMentionTypeahead';

interface Props {
  open: boolean;
  candidates: MentionCandidate[];
  activeIndex: number;
  /** The composer row / field wrapper the dropdown should span. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onHover: (index: number) => void;
  onSelect: (candidate: MentionCandidate) => void;
  onClose: () => void;
}

/**
 * The @mention dropdown — PORTALED to document.body and fixed-positioned
 * over its anchor. Rendered in place it kept getting clipped: PostCard's
 * rounded `overflow-hidden` root cut the upward panel exactly when the
 * composer sat high in the card (wide screens — "works on mobile, broken
 * on desktop" with zero breakpoint code), the post-detail modal stacks
 * three clippers, and the chat dock caps everything at z-[45]. The portal
 * escapes all of them with one mechanism.
 *
 * The rect re-measures on every render while open (each keystroke
 * re-renders, so it tracks the growing textarea) and any scroll CLOSES the
 * dropdown rather than letting it visually detach — the next keystroke
 * reopens it. Dismissal is usePopoverDismiss on the PANEL ref (mousedown +
 * Escape), never a backdrop; selection fires on MOUSEDOWN so the textarea
 * doesn't blur first.
 */
export default function MentionSuggestions({
  open,
  candidates,
  activeIndex,
  anchorRef,
  onHover,
  onSelect,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  usePopoverDismiss(panelRef, open, onClose);

  // Deliberately no dependency array: re-measure after every render while
  // open — the anchor grows/moves as the user types. Positions are written
  // straight to the panel's style (before paint, so no flash) rather than
  // through state: no re-render loop, nothing for the set-state-in-effect
  // rule to object to.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    panel.style.left = `${r.left}px`;
    panel.style.width = `${r.width}px`;
    panel.style.bottom = `${window.innerHeight - r.top + 8}px`;
  });

  useLayoutEffect(() => {
    if (!open) return;
    // capture:true sees scrolls from EVERY scroller — including this panel's
    // own overflow-y-auto list. Only scrolls OUTSIDE the panel close it.
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    // Grace before arming: the open-click's own auto-scroll can deliver a
    // trailing scroll event a few ms after mount and instantly close the
    // panel (observed at +11ms).
    const t = setTimeout(() => {
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    }, 150);
    return () => {
      clearTimeout(t);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open, onClose]);

  if (!open || candidates.length === 0) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="listbox"
      aria-label="Mention suggestions"
      style={{ position: 'fixed' }}
      className="z-[70] bg-surface-raised rounded-xl shadow-xl border border-border py-1 max-h-72 overflow-y-auto overscroll-contain"
    >
      {candidates.map((c, i) => {
        const name = formatDisplayName(c.first_name, null, c.last_name, c.full_name);
        return (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            onMouseEnter={() => onHover(i)}
            // mousedown, not click: the click would blur the textarea first
            // and some browsers re-dispatch layout before click lands.
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(c);
            }}
            className={`w-full text-left px-3 min-h-[44px] flex items-center gap-2 text-sm ${
              i === activeIndex ? 'bg-surface-muted' : 'hover:bg-surface-muted'
            }`}
          >
            {c.avatar_url ? (
              <Image
                src={c.avatar_url}
                alt=""
                width={24}
                height={24}
                className="w-6 h-6 rounded-full object-cover shrink-0"
              />
            ) : (
              <span className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-semibold shrink-0">
                {getInitials(name)}
              </span>
            )}
            {/* The @handle is the thing being inserted — it must NEVER
                truncate; the display name gives way instead. */}
            <span className="min-w-0 flex-1 flex items-baseline gap-1.5">
              <span className="font-medium text-primary truncate min-w-0">{name}</span>
              <span className="text-muted shrink-0">@{c.handle}</span>
            </span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}
