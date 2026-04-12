'use client';

import { useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { EmojiClickData } from 'emoji-picker-react';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import SharedPostPreview from './SharedPostPreview';
import SharedProfilePreview from './SharedProfilePreview';
import ReactionBar from './ReactionBar';
import GifReactionBubble from './GifReactionBubble';
import QuotedReply from './QuotedReply';
import type { Message } from '@/types/messages';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => null,
});

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥'];

interface Props {
  message: Message;
  isOwn: boolean;
  showSender: boolean;
  currentUserId: string;
  onDelete?: (messageId: string) => void;
  onViewPost?: (postId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onGifReact: (parentMessageId: string) => void;
  onReply: (message: Message) => void;
  onScrollToMessage?: (messageId: string) => void;
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

export default function MessageBubble({
  message,
  isOwn,
  showSender,
  currentUserId,
  onDelete,
  onViewPost,
  onToggleReaction,
  onGifReact,
  onReply,
  onScrollToMessage,
}: Props) {
  const [showMenu, setShowMenu] = useState(false);
  const [showQuickReact, setShowQuickReact] = useState(false);
  const [showFullPicker, setShowFullPicker] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Long-press handlers for mobile — must be before any early return
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

  if (message.deleted_at) {
    return (
      <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1`}>
        <p className="text-sm italic text-gray-400 px-2">Message deleted</p>
      </div>
    );
  }

  const senderName = formatDisplayName(
    message.sender?.first_name,
    null,
    message.sender?.last_name,
    message.sender?.full_name
  );

  const bubbleBase = isOwn
    ? 'bg-blue-600 text-white rounded-l-2xl rounded-tr-2xl'
    : 'bg-gray-100 text-gray-900 rounded-r-2xl rounded-tl-2xl';

  const handleCopy = () => {
    if (message.content) navigator.clipboard.writeText(message.content);
    setShowMenu(false);
  };

  const handleDelete = () => {
    onDelete?.(message.id);
    setShowMenu(false);
  };

  const handleQuickEmoji = (emoji: string) => {
    onToggleReaction(message.id, emoji);
    setShowQuickReact(false);
  };

  const handleGifReactClick = () => {
    onGifReact(message.id);
    setShowQuickReact(false);
  };

  const handleFullPickerEmoji = (data: EmojiClickData) => {
    onToggleReaction(message.id, data.emoji);
    setShowFullPicker(false);
    setShowQuickReact(false);
  };

  const handleReply = () => {
    onReply(message);
    setShowQuickReact(false);
    setShowMenu(false);
  };

  const reactions = message.reactions || [];
  const gifReactions = message.gif_reactions || [];

  return (
    <div className={`flex flex-col mb-2 ${isOwn ? 'items-end' : 'items-start'}`}>
      {/* Sender name + avatar for group chats */}
      {showSender && !isOwn && (
        <div className="flex items-center gap-1.5 mb-1 ml-1">
          {message.sender?.avatar_url ? (
            <LazyImage
              src={message.sender.avatar_url}
              alt={senderName}
              className="w-5 h-5 rounded-full object-cover"
              width={20}
              height={20}
            />
          ) : (
            <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">
              {getInitials(senderName)}
            </div>
          )}
          <span className="text-xs font-medium text-gray-600">{senderName}</span>
        </div>
      )}

      <div className={`flex items-end gap-2 max-w-xs sm:max-w-sm md:max-w-md ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Message content */}
        <div
          className="relative group"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          {/* Quoted reply preview */}
          {message.reply_to && (
            <QuotedReply
              replyTo={message.reply_to}
              isOwn={isOwn}
              onScrollToMessage={onScrollToMessage}
            />
          )}

          {message.type === 'text' && (
            <div className={`px-4 py-2.5 ${bubbleBase} max-w-full`}>
              <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
            </div>
          )}

          {message.type === 'image' && message.media_url && (
            <div className="rounded-2xl overflow-hidden max-w-xs">
              <LazyImage
                src={message.media_url}
                alt="Sent image"
                className="w-full max-h-64 object-cover"
                width={300}
                height={256}
              />
            </div>
          )}

          {message.type === 'video' && message.media_url && (
            <div className="rounded-2xl overflow-hidden max-w-xs">
              <video
                src={message.media_url}
                controls
                className="w-full max-h-64"
                style={{ maxWidth: 300 }}
              />
            </div>
          )}

          {message.type === 'shared_post' && message.shared_post && (
            <div className="max-w-xs">
              <SharedPostPreview
                post={message.shared_post}
                onClick={message.shared_post_id && onViewPost
                  ? () => onViewPost(message.shared_post_id!)
                  : undefined
                }
              />
            </div>
          )}

          {message.type === 'shared_profile' && message.shared_profile && (
            <div className="max-w-xs">
              <SharedProfilePreview profile={message.shared_profile} />
            </div>
          )}

          {/* Quick-reaction bar — desktop hover */}
          <div
            className={`absolute z-10 opacity-0 group-hover:opacity-100 transition-opacity ${
              isOwn ? 'right-0' : 'left-0'
            } bottom-full mb-1`}
          >
            <div className="hidden sm:flex items-center gap-0.5 bg-white border border-gray-200 rounded-full shadow-lg px-1.5 py-1">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleQuickEmoji(emoji)}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-sm"
                  title={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={handleGifReactClick}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-[10px] font-bold text-gray-500"
                title="React with GIF"
              >
                GIF
              </button>
              <button
                onClick={() => setShowFullPicker(prev => !prev)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors text-sm text-gray-400"
                title="More emojis"
              >
                +
              </button>
              <div className="w-px h-4 bg-gray-200 mx-0.5" />
              <button
                onClick={handleReply}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
                title="Reply"
              >
                <i className="fas fa-reply text-xs text-gray-400"></i>
              </button>
              {/* Context actions */}
              {(message.type === 'text' || isOwn) && (
                <>
                  <div className="w-px h-4 bg-gray-200 mx-0.5" />
                  <button
                    onClick={() => { setShowMenu(prev => !prev); }}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
                    aria-label="More options"
                  >
                    <i className="fas fa-ellipsis-h text-xs text-gray-400"></i>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Mobile: long-press quick reaction overlay */}
          {showQuickReact && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowQuickReact(false)} />
              <div
                className={`absolute z-20 ${
                  isOwn ? 'right-0' : 'left-0'
                } bottom-full mb-1`}
              >
                <div className="flex items-center gap-0.5 bg-white border border-gray-200 rounded-full shadow-lg px-1.5 py-1">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleQuickEmoji(emoji)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors text-base"
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    onClick={handleGifReactClick}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors text-[10px] font-bold text-gray-500"
                  >
                    GIF
                  </button>
                  <button
                    onClick={() => setShowFullPicker(prev => !prev)}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors text-base text-gray-400"
                    title="More emojis"
                  >
                    +
                  </button>
                  <div className="w-px h-5 bg-gray-200 mx-0.5" />
                  <button
                    onClick={handleReply}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors"
                    title="Reply"
                  >
                    <i className="fas fa-reply text-xs text-gray-400"></i>
                  </button>
                  {(message.type === 'text' || isOwn) && (
                    <>
                      <div className="w-px h-5 bg-gray-200 mx-0.5" />
                      <button
                        onClick={() => { setShowQuickReact(false); setShowMenu(true); }}
                        className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors"
                      >
                        <i className="fas fa-ellipsis-h text-xs text-gray-400"></i>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Full emoji picker */}
          {showFullPicker && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowFullPicker(false)} />
              <div
                className={`absolute z-20 ${
                  isOwn ? 'right-0' : 'left-0'
                } bottom-full mb-1`}
              >
                <EmojiPicker
                  onEmojiClick={handleFullPickerEmoji}
                  lazyLoadEmojis
                  height={350}
                  width={300}
                  searchPlaceholder="Search emoji…"
                />
              </div>
            </>
          )}

          {/* Context menu */}
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div
                className={`absolute z-20 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[120px] ${
                  isOwn ? 'right-0' : 'left-0'
                } top-full`}
              >
                <button
                  onClick={handleReply}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <i className="fas fa-reply text-xs w-4"></i>
                  Reply
                </button>
                {message.type === 'text' && (
                  <button
                    onClick={handleCopy}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <i className="fas fa-copy text-xs w-4"></i>
                    Copy
                  </button>
                )}
                {isOwn && (
                  <button
                    onClick={handleDelete}
                    className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    <i className="fas fa-trash text-xs w-4"></i>
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Emoji reactions */}
      {reactions.length > 0 && (
        <ReactionBar
          messageId={message.id}
          reactions={reactions}
          onToggleReaction={onToggleReaction}
        />
      )}

      {/* GIF reactions */}
      {gifReactions.length > 0 && (
        <GifReactionBubble
          gifReactions={gifReactions}
          currentUserId={currentUserId}
          isOwnParent={isOwn}
          onToggleReaction={onToggleReaction}
          onReply={onReply}
        />
      )}

      {/* Timestamp */}
      <span className={`text-xs text-gray-400 mt-0.5 px-1 ${isOwn ? 'text-right' : 'text-left'}`}>
        {getRelativeTime(message.created_at)}
      </span>
    </div>
  );
}
