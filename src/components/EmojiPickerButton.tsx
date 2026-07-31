'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { EmojiClickData } from 'emoji-picker-react';

// Lazy-load the picker so it doesn't bloat the initial bundle
const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => null,
});

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
}

export default function EmojiPickerButton({
  onEmojiSelect,
  className = '',
  align = 'left',
  disabled = false,
  anchor = 'trigger',
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // A panel left open while the button goes disabled (a send starting, say)
  // would hover over a dead control. Render-phase sync, not an effect — the
  // orphaned panel would otherwise paint for a frame.
  const [syncedDisabled, setSyncedDisabled] = useState(disabled);
  if (syncedDisabled !== disabled) {
    setSyncedDisabled(disabled);
    if (disabled) setOpen(false);
  }

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  const handleEmojiClick = (data: EmojiClickData) => {
    onEmojiSelect(data.emoji);
    setOpen(false);
  };

  return (
    <div
      className={`${anchor === 'trigger' ? 'relative ' : ''}${className}`}
      ref={containerRef}
    >
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        disabled={disabled}
        className="shrink-0 p-2.5 text-gray-400 hover:text-yellow-500 transition-colors disabled:opacity-40"
        aria-label="Add emoji"
        title="Add emoji"
      >
        <i className="fas fa-smile text-lg"></i>
      </button>

      {open && (
        <div className={`absolute bottom-full mb-2 z-50 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <EmojiPicker
            onEmojiClick={handleEmojiClick}
            lazyLoadEmojis
            height={350}
            width="min(300px, calc(100vw - 2rem))"
            searchPlaceholder="Search emoji…"
          />
        </div>
      )}
    </div>
  );
}
