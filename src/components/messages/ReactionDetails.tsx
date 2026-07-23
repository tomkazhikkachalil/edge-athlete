'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import type { AggregatedReaction, ParticipantProfile } from '@/types/messages';

interface Props {
  reactions: AggregatedReaction[];
  initialEmoji?: string;
  /** Where to anchor the popover relative to the message bubble. */
  align?: 'left' | 'right';
  onClose: () => void;
}

export default function ReactionDetails({
  reactions,
  initialEmoji,
  align = 'left',
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Tabs are the emojis that actually have reactors. If a tab loses reactors
  // (e.g. all users removed) the popover closes silently — that's correct.
  const tabs = useMemo(
    () => reactions.filter(r => r.count > 0),
    [reactions]
  );

  const defaultEmoji = initialEmoji && tabs.some(t => t.emoji === initialEmoji)
    ? initialEmoji
    : tabs[0]?.emoji ?? null;

  const [activeEmoji, setActiveEmoji] = useState<string | null>(defaultEmoji);

  useEffect(() => {
    if (activeEmoji && tabs.some(t => t.emoji === activeEmoji)) return;
    setActiveEmoji(tabs[0]?.emoji ?? null);
  }, [tabs, activeEmoji]);

  // Outside-click + Escape to close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Close via effect, not during render — calling onClose() mid-render is a
  // React "setState while rendering" error (hit when reactions are removed
  // via broadcast while this popover is open).
  const shouldClose = tabs.length === 0 || !activeEmoji;
  useEffect(() => {
    if (shouldClose) onClose();
  }, [shouldClose, onClose]);

  if (shouldClose) return null;

  const active = tabs.find(t => t.emoji === activeEmoji);
  const reactors: ParticipantProfile[] = active?.reactors ?? [];

  return (
    <div
      ref={containerRef}
      className={`absolute z-30 bg-white rounded-xl shadow-xl border border-gray-200 w-64 max-w-[80vw] ${
        align === 'right' ? 'right-0' : 'left-0'
      } top-full mt-1`}
      role="dialog"
      aria-label="Reaction details"
    >
      {/* Emoji tabs */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-1 border-b border-gray-100 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.emoji}
            onClick={() => setActiveEmoji(t.emoji)}
            className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-colors ${
              t.emoji === activeEmoji
                ? 'bg-blue-50 text-blue-700 font-semibold'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
            aria-pressed={t.emoji === activeEmoji}
          >
            <span className="text-sm leading-none">{t.emoji}</span>
            <span>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Reactor list */}
      <div className="max-h-60 overflow-y-auto py-1">
        {reactors.length === 0 ? (
          <p className="px-3 py-3 text-xs text-gray-400">No reactor details available.</p>
        ) : (
          reactors.map(p => {
            const name = formatDisplayName(p.first_name, null, p.last_name, p.full_name) || 'Unknown';
            return (
              <div
                key={p.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50"
              >
                {p.avatar_url ? (
                  <LazyImage
                    src={p.avatar_url}
                    alt={name}
                    className="w-7 h-7 rounded-full object-cover shrink-0"
                    width={28}
                    height={28}
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                    {getInitials(name)}
                  </div>
                )}
                <span className="text-sm text-gray-900 truncate">{name}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
