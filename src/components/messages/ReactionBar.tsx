'use client';

import { useState } from 'react';
import EmojiPickerButton from '@/components/EmojiPickerButton';
import type { AggregatedReaction } from '@/types/messages';

interface Props {
  messageId: string;
  reactions: AggregatedReaction[];
  onToggleReaction: (messageId: string, emoji: string) => void;
}

export default function ReactionBar({
  messageId,
  reactions,
  onToggleReaction,
}: Props) {
  const [showPicker, setShowPicker] = useState(false);

  if (reactions.length === 0 && !showPicker) return null;

  const handleEmojiSelect = (emoji: string) => {
    onToggleReaction(messageId, emoji);
    setShowPicker(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1 px-1">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => onToggleReaction(messageId, r.emoji)}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors border ${
            r.reacted
              ? 'bg-blue-50 border-blue-300 text-blue-700'
              : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
          }`}
          title={r.reacted ? 'Remove reaction' : 'React'}
        >
          <span>{r.emoji}</span>
          <span className="font-medium">{r.count}</span>
        </button>
      ))}

      {/* Add reaction button */}
      <div className="relative">
        {showPicker ? (
          <EmojiPickerButton
            onEmojiSelect={handleEmojiSelect}
            className="text-gray-400"
          />
        ) : (
          <button
            onClick={() => setShowPicker(true)}
            className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-50 border border-gray-200 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors text-xs"
            title="Add reaction"
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
