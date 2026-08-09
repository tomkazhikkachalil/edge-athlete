'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import EmojiPickerButton from '@/components/EmojiPickerButton';
import ReactionDetails from './ReactionDetails';
import type { AggregatedReaction } from '@/types/messages';

interface Props {
  messageId: string;
  reactions: AggregatedReaction[];
  onToggleReaction: (messageId: string, emoji: string) => void;
  /** Anchor side for popovers — defaults to 'left'. Set to 'right' for own messages. */
  align?: 'left' | 'right';
}

const RECENTS_KEY = 'ea:msg:recentEmojis';
const RECENTS_MAX = 16;
const LONG_PRESS_MS = 400;

function readRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((e): e is string => typeof e === 'string').slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecents(next: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next.slice(0, RECENTS_MAX)));
  } catch {
    // localStorage can throw (private mode, quota); ignore — non-critical
  }
}

/** Promote an emoji to the front of the MRU list. Exported for use by other surfaces. */
export function rememberRecentEmoji(emoji: string) {
  const current = readRecents();
  const next = [emoji, ...current.filter(e => e !== emoji)].slice(0, RECENTS_MAX);
  writeRecents(next);
}

export default function ReactionBar({
  messageId,
  reactions,
  onToggleReaction,
  align = 'left',
}: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [detailsEmoji, setDetailsEmoji] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);

  // Refresh recents whenever the picker opens — keeps the list fresh across tabs.
  useEffect(() => {
    if (showPicker) setRecents(readRecents());
  }, [showPicker]);

  const handleToggle = useCallback((emoji: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    rememberRecentEmoji(emoji);
    onToggleReaction(messageId, emoji);
  }, [messageId, onToggleReaction]);

  const handlePickerSelect = useCallback((emoji: string) => {
    rememberRecentEmoji(emoji);
    onToggleReaction(messageId, emoji);
    setShowPicker(false);
  }, [messageId, onToggleReaction]);

  const startLongPress = (emoji: string) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      suppressClickRef.current = true;
      setDetailsEmoji(emoji);
    }, LONG_PRESS_MS);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  if (reactions.length === 0 && !showPicker) return null;

  return (
    <div className="relative flex flex-wrap items-center gap-1 mt-1 px-1">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => handleToggle(r.emoji)}
          onContextMenu={(e) => {
            e.preventDefault();
            setDetailsEmoji(r.emoji);
          }}
          onTouchStart={() => startLongPress(r.emoji)}
          onTouchEnd={cancelLongPress}
          onTouchCancel={cancelLongPress}
          onTouchMove={cancelLongPress}
          className={`ea-reaction-chip relative after:absolute after:content-[''] after:-inset-y-2.5 after:inset-x-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors border ${
            r.reacted
              ? 'bg-brand-soft border-violet-300 dark:border-violet-700 text-brand-fg-strong'
              : 'bg-surface-muted border-border text-tertiary hover:bg-surface-sunken'
          }`}
          title={r.reacted ? 'Remove reaction (long-press to see who)' : 'React (long-press to see who)'}
        >
          <span>{r.emoji}</span>
          <span className="font-medium">{r.count}</span>
        </button>
      ))}

      {/* Add reaction button */}
      <div className="relative">
        {showPicker ? (
          <div className={`absolute bottom-full mb-2 z-30 bg-surface-raised rounded-xl shadow-xl border border-border p-2 w-72 max-w-[80vw] ${align === 'right' ? 'right-0' : 'left-0'}`}>
            {recents.length > 0 && (
              <div className="mb-2 pb-2 border-b border-border-subtle">
                <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1 px-1">Recent</p>
                <div className="flex flex-wrap gap-1">
                  {recents.map(e => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => handlePickerSelect(e)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-sunken text-base"
                      aria-label={`React with ${e}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <EmojiPickerButton onEmojiSelect={handlePickerSelect} className="text-faint" />
            <button
              type="button"
              onClick={() => setShowPicker(false)}
              className="absolute -top-1 -right-1 w-5 h-5 after:absolute after:content-[''] after:-inset-2.5 bg-surface border border-border text-faint hover:text-tertiary active:text-tertiary rounded-full flex items-center justify-center text-[10px] shadow-sm"
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowPicker(true)}
            className="relative after:absolute after:content-[''] after:-inset-y-2 after:-inset-x-1 inline-flex items-center justify-center w-7 h-7 rounded-full bg-surface-muted border border-border text-faint hover:bg-surface-sunken hover:text-tertiary active:text-tertiary transition-colors text-xs"
            title="Add reaction"
            aria-label="Add reaction"
          >
            +
          </button>
        )}
      </div>

      {detailsEmoji && (
        <ReactionDetails
          reactions={reactions}
          initialEmoji={detailsEmoji}
          align={align}
          onClose={() => setDetailsEmoji(null)}
        />
      )}
    </div>
  );
}
