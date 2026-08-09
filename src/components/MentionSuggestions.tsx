'use client';

import { useRef } from 'react';
import Image from 'next/image';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import type { MentionCandidate } from '@/hooks/useMentionTypeahead';

interface Props {
  open: boolean;
  candidates: MentionCandidate[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (candidate: MentionCandidate) => void;
  onClose: () => void;
}

/**
 * The @mention dropdown. Rendered INSIDE the composer field's
 * `relative flex-1 min-w-0` wrapper as `absolute bottom-full` — it tracks
 * the growing textarea the same way the emoji panel does, and full field
 * width means it fits the 320px chat dock by construction. Dismissal is
 * usePopoverDismiss (mousedown + Escape), never a backdrop — an
 * autocomplete must not eat the click that dismisses it.
 */
export default function MentionSuggestions({
  open,
  candidates,
  activeIndex,
  onHover,
  onSelect,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  usePopoverDismiss(ref, open, onClose);

  if (!open || candidates.length === 0) return null;

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Mention suggestions"
      className="absolute bottom-full left-0 right-0 mb-2 z-30 bg-surface-raised rounded-xl shadow-xl border border-border py-1 max-h-72 overflow-y-auto overscroll-contain"
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
    </div>
  );
}
