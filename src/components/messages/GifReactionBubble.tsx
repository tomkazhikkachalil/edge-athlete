'use client';

import { useState, useRef, useCallback } from 'react';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import ReactionBar from './ReactionBar';
import type { Message } from '@/types/messages';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥'];

interface Props {
  gifReactions: Message[];
  currentUserId: string;
  isOwnParent: boolean;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onReply: (message: Message) => void;
}

function getRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function GifReactionItem({
  gr,
  currentUserId,
  onToggleReaction,
  onReply,
}: {
  gr: Message;
  currentUserId: string;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onReply: (message: Message) => void;
}) {
  const [showQuickReact, setShowQuickReact] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      setShowQuickReact(true);
    }, 400);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const isOwn = gr.sender_id === currentUserId;
  const senderName = formatDisplayName(
    gr.sender?.first_name,
    null,
    gr.sender?.last_name,
    gr.sender?.full_name
  );
  const reactions = gr.reactions || [];

  const handleQuickEmoji = (emoji: string) => {
    onToggleReaction(gr.id, emoji);
    setShowQuickReact(false);
  };

  const handleReply = () => {
    onReply(gr);
    setShowQuickReact(false);
  };

  return (
    <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
      <div
        className={`flex items-end gap-1.5 max-w-[200px] ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
      >
        {/* Small avatar */}
        <div className="shrink-0">
          {gr.sender?.avatar_url ? (
            <LazyImage
              src={gr.sender.avatar_url}
              alt={senderName}
              className="w-4 h-4 rounded-full object-cover"
              width={16}
              height={16}
            />
          ) : (
            <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold" style={{ fontSize: '7px' }}>
              {getInitials(senderName)}
            </div>
          )}
        </div>

        {/* GIF + label */}
        <div className="flex flex-col">
          <div
            className="relative group"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            <div className="relative rounded-lg overflow-hidden border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={gr.media_url!}
                alt="GIF reaction"
                className="max-h-24 max-w-[180px] object-contain"
                loading="lazy"
              />
              {/* Reaction label */}
              <div className="absolute top-1 left-1 bg-black/50 text-white text-[9px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                <i className="fas fa-reply text-[7px]"></i>
                reacted
              </div>
            </div>

            {/* Desktop hover quick-reaction bar */}
            <div
              className={`absolute z-10 opacity-0 group-hover:opacity-100 transition-opacity ${
                isOwn ? 'right-0' : 'left-0'
              } bottom-full mb-1`}
            >
              <div className="hidden sm:flex items-center gap-0.5 bg-white border border-gray-200 rounded-full shadow-lg px-1 py-0.5">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleQuickEmoji(emoji)}
                    className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-xs"
                    title={`React with ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
                <div className="w-px h-3 bg-gray-200 mx-0.5" />
                <button
                  onClick={handleReply}
                  className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
                  title="Reply"
                >
                  <i className="fas fa-reply text-[10px] text-gray-400"></i>
                </button>
              </div>
            </div>

            {/* Mobile long-press overlay */}
            {showQuickReact && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowQuickReact(false)} />
                <div
                  className={`absolute z-20 ${
                    isOwn ? 'right-0' : 'left-0'
                  } bottom-full mb-1`}
                >
                  <div className="flex items-center gap-0.5 bg-white border border-gray-200 rounded-full shadow-lg px-1 py-0.5">
                    {QUICK_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => handleQuickEmoji(emoji)}
                        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors text-sm"
                      >
                        {emoji}
                      </button>
                    ))}
                    <div className="w-px h-4 bg-gray-200 mx-0.5" />
                    <button
                      onClick={handleReply}
                      className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors"
                      title="Reply"
                    >
                      <i className="fas fa-reply text-xs text-gray-400"></i>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Emoji reactions on this GIF */}
          {reactions.length > 0 && (
            <ReactionBar
              messageId={gr.id}
              reactions={reactions}
              onToggleReaction={onToggleReaction}
            />
          )}

          <span className={`text-[10px] text-gray-400 mt-0.5 ${isOwn ? 'text-right' : 'text-left'}`}>
            {getRelativeTime(gr.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function GifReactionBubble({ gifReactions, currentUserId, isOwnParent, onToggleReaction, onReply }: Props) {
  if (gifReactions.length === 0) return null;

  return (
    <div className={`flex flex-col gap-1.5 mt-1.5 ${isOwnParent ? 'items-end' : 'items-start'}`}>
      {gifReactions.map((gr) => (
        <GifReactionItem
          key={gr.id}
          gr={gr}
          currentUserId={currentUserId}
          onToggleReaction={onToggleReaction}
          onReply={onReply}
        />
      ))}
    </div>
  );
}
