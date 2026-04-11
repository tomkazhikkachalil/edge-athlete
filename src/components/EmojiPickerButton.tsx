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
}

export default function EmojiPickerButton({ onEmojiSelect, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="shrink-0 p-2 text-gray-400 hover:text-yellow-500 transition-colors"
        aria-label="Add emoji"
        title="Add emoji"
      >
        <i className="fas fa-smile text-lg"></i>
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-0 z-50">
          <EmojiPicker
            onEmojiClick={handleEmojiClick}
            lazyLoadEmojis
            height={350}
            width={300}
            searchPlaceholder="Search emoji…"
          />
        </div>
      )}
    </div>
  );
}
