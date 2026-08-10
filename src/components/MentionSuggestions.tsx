'use client';

import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import type { MentionCandidate } from '@/hooks/useMentionTypeahead';

/** Tight gap so the panel reads ATTACHED to the composer, not floating. */
const GAP_PX = 4;

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
 * against its anchor. Rendered in place it kept getting clipped: PostCard's
 * rounded `overflow-hidden` root cut the upward panel exactly when the
 * composer sat high in the card (wide screens — "works on mobile, broken
 * on desktop" with zero breakpoint code), the post-detail modal stacks
 * three clippers, and the chat dock caps everything at z-[45]. The portal
 * escapes all of them with one mechanism.
 *
 * Positioning rules (Tom's device feedback shaped all three):
 * - Prefers ABOVE the anchor, tight (4px); FLIPS BELOW when there isn't
 *   room above — never renders off-viewport.
 * - Scrolling REPOSITIONS the panel, it never closes it: phones fire stray
 *   scroll events (address bar, keyboard settle) with zero user intent,
 *   and close-on-scroll read as "it closes itself after a few seconds".
 *   Dismissal is only: outside mousedown, Escape, token gone, selection.
 * - Re-measures on every render while open, so it tracks the growing
 *   textarea per keystroke.
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

  // Position: straight style writes (before paint — no flash, no re-render
  // loop, nothing for set-state-in-effect to object to). Above-with-flip:
  // prefer sitting tight above the anchor; when the panel wouldn't fit,
  // open below instead — a panel must never leave the viewport.
  const reposition = () => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    const panelH = panel.offsetHeight;
    panel.style.left = `${r.left}px`;
    panel.style.width = `${r.width}px`;
    if (r.top >= panelH + GAP_PX + 4) {
      panel.style.bottom = `${window.innerHeight - r.top + GAP_PX}px`;
      panel.style.top = 'auto';
    } else {
      panel.style.top = `${r.bottom + GAP_PX}px`;
      panel.style.bottom = 'auto';
    }
  };

  // Deliberately no dependency array: re-measure after every render while
  // open — the anchor grows/moves as the user types.
  useLayoutEffect(() => {
    if (open) reposition();
  });

  // Scrolling repositions — NEVER closes (see header). rAF-coalesced.
  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(reposition);
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || candidates.length === 0) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="listbox"
      aria-label="Mention suggestions"
      style={{ position: 'fixed' }}
      className="z-[70] ea-dropdown-in bg-surface-raised rounded-xl shadow-[var(--ea-shadow-raised)] border border-border py-1 max-h-72 overflow-y-auto overscroll-contain"
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
            className={`w-full text-left px-3 min-h-[48px] flex items-center gap-2.5 text-sm ${
              i === activeIndex ? 'bg-surface-muted' : 'hover:bg-surface-muted'
            }`}
          >
            {c.avatar_url ? (
              <Image
                src={c.avatar_url}
                alt=""
                width={32}
                height={32}
                className="w-8 h-8 rounded-full object-cover shrink-0"
              />
            ) : (
              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                {getInitials(name)}
              </span>
            )}
            {/* Two lines — name over @handle — reads cleaner than one
                crowded line, and the @handle (the thing being inserted)
                never truncates; the display name gives way instead. */}
            <span className="min-w-0 flex-1 flex flex-col leading-tight">
              <span className="font-medium text-primary truncate min-w-0">{name}</span>
              <span className="text-muted text-xs">@{c.handle}</span>
            </span>
          </button>
        );
      })}
    </div>,
    document.body
  );
}
