'use client';

import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { Theme } from 'emoji-picker-react';
import type { EmojiClickData } from 'emoji-picker-react';
import { useTheme } from '@/lib/use-theme';

// Lazy-load the picker so it doesn't bloat the initial bundle
const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => null,
});

const PANEL_WIDTH_PX = 300;

interface Props {
  onEmojiSelect: (emoji: string) => void;
  className?: string;
  /** Anchor side for the panel — defaults to 'left'. Set to 'right' when the
   *  button sits at a container's trailing edge, or the 300px panel runs off
   *  screen. Same vocabulary as ReactionBar's `align`. */
  align?: 'left' | 'right';
  disabled?: boolean;
  /** What the panel positions against.
   *
   *  'trigger' (default) — this component's own wrapper, i.e. the button. Every
   *  existing call site wants this.
   *
   *  'container' — leave the wrapper static so the panel resolves against the
   *  nearest positioned ANCESTOR. The composer needs it: the anchor there must
   *  be the growing text field, not the fixed-height button pinned to its
   *  bottom edge. Outside-click is unaffected either way — the panel stays a
   *  DOM descendant of containerRef regardless of what it positions against. */
  anchor?: 'trigger' | 'container';
  /** Render the open panel through a PORTAL to document.body, fixed-positioned
   *  above the trigger. Required wherever a clipping ancestor would eat an
   *  in-flow panel — the comment composer's collapsing cluster is
   *  overflow-hidden, and PostCard's rounded root clips anything that leaves
   *  the card (the globals.css CLIPPING RULE). Scrolling closes the panel
   *  rather than letting it detach. Default off: in-flow call sites are
   *  byte-identical to before. */
  portal?: boolean;
}

export default function EmojiPickerButton({
  onEmojiSelect,
  className = '',
  align = 'left',
  disabled = false,
  anchor = 'trigger',
  portal = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  // A panel left open while the button goes disabled (a send starting, say)
  // would hover over a dead control. Render-phase sync, not an effect — the
  // orphaned panel would otherwise paint for a frame.
  const [syncedDisabled, setSyncedDisabled] = useState(disabled);
  if (syncedDisabled !== disabled) {
    setSyncedDisabled(disabled);
    if (disabled) setOpen(false);
  }

  // Close on outside click or Escape. The portaled panel is NOT a DOM
  // descendant of containerRef, so the outside test must consult both refs.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Portal mode: position above the trigger before paint (clamped to the
  // viewport), close on any scroll instead of visually detaching.
  useLayoutEffect(() => {
    if (!portal || !open) return;
    const trigger = containerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const r = trigger.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH_PX - 8));
    panel.style.left = `${left}px`;
    panel.style.bottom = `${window.innerHeight - r.top + 8}px`;
  }, [portal, open]);

  useEffect(() => {
    if (!portal || !open) return;
    // capture:true sees scrolls from EVERY scroller — including the panel's
    // own internal list, which fires on mount. Only outside scrolls close.
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
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
  }, [portal, open]);

  const handleEmojiClick = (data: EmojiClickData) => {
    onEmojiSelect(data.emoji);
    setOpen(false);
  };

  const panel = (
    <EmojiPicker
      onEmojiClick={handleEmojiClick}
      theme={theme === 'dark' ? Theme.DARK : Theme.LIGHT}
      lazyLoadEmojis
      height={350}
      width={`min(${PANEL_WIDTH_PX}px, calc(100vw - 2rem))`}
      searchPlaceholder="Search emoji…"
    />
  );

  return (
    <div
      className={`${anchor === 'trigger' && !portal ? 'relative ' : ''}${className}`}
      ref={containerRef}
    >
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        disabled={disabled}
        className="shrink-0 relative after:absolute after:content-[''] after:-inset-y-1 after:inset-x-0 p-2.5 text-faint hover:text-yellow-500 active:text-yellow-500 transition-colors disabled:opacity-40"
        aria-label="Add emoji"
        title="Add emoji"
      >
        <i className="fas fa-smile text-lg"></i>
      </button>

      {open && !portal && (
        <div className={`absolute bottom-full mb-2 z-50 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {panel}
        </div>
      )}
      {open && portal &&
        createPortal(
          <div ref={panelRef} style={{ position: 'fixed' }} className="z-[70]">
            {panel}
          </div>,
          document.body
        )}
    </div>
  );
}
