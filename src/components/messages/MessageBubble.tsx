'use client';

import { useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Theme } from 'emoji-picker-react';
import type { EmojiClickData } from 'emoji-picker-react';
import { useTheme } from '@/lib/use-theme';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import SharedPostPreview from './SharedPostPreview';
import SharedProfilePreview from './SharedProfilePreview';
import ReactionBar, { rememberRecentEmoji } from './ReactionBar';
import QuotedReply from './QuotedReply';
import EditMessageInline from './EditMessageInline';
import ReportMessageModal from './ReportMessageModal';
import type { Message } from '@/types/messages';

const EDIT_WINDOW_MS = 15 * 60 * 1000; // mirror server-side window for UI gating

const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => null,
});

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥'];

interface Props {
  message: Message;
  isOwn: boolean;
  showSender: boolean;
  onDelete?: (messageId: string) => void;
  onViewPost?: (postId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onGifReact: (parentMessageId: string) => void;
  onReply: (message: Message) => void;
  onScrollToMessage?: (messageId: string) => void;
  onMessageEdited?: (messageId: string, content: string, edited_at: string) => void;
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
  onDelete,
  onViewPost,
  onToggleReaction,
  onGifReact,
  onReply,
  onScrollToMessage,
  onMessageEdited,
}: Props) {
  const { theme } = useTheme();
  const [showMenu, setShowMenu] = useState(false);
  // Timestamp captured when the menu OPENS, not read during render.
  // Date.now() in render is impure (react-hooks/purity) and made the edit
  // window depend on whenever React happened to re-render this bubble.
  // Evaluating it at open time is what the check actually means.
  const [menuOpenedAt, setMenuOpenedAt] = useState(0);
  const [showQuickReact, setShowQuickReact] = useState(false);
  const [showFullPicker, setShowFullPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Long-press handlers for mobile — must be before any early return
  const handleTouchStart = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      setShowQuickReact(true);
    }, 400);
  }, []);

  // Also wired to onTouchMove: a scroll that starts with a finger on a
  // bubble must cancel the press, not open the overlay 400ms into the
  // scroll (same rule as ReactionBar's chip long-press).
  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  if (message.deleted_at) {
    return (
      <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1`}>
        <p className="text-sm italic text-faint px-2">Message deleted</p>
      </div>
    );
  }

  const senderName = formatDisplayName(
    message.sender?.first_name,
    null,
    message.sender?.last_name,
    message.sender?.full_name
  );

  // The metal rim is what stops an own-bubble dissolving into the (also
  // violet) chat header in the dock. Inset shadows, so bubble geometry is
  // unchanged — a real border would add 2px to every bubble in the thread.
  const bubbleBase = isOwn
    ? 'bg-brand text-white rounded-l-2xl rounded-tr-2xl ea-metal-rim-brand'
    : 'bg-surface-sunken text-primary rounded-r-2xl rounded-tl-2xl ea-metal-rim';

  const handleCopy = () => {
    if (message.content) navigator.clipboard.writeText(message.content);
    setShowMenu(false);
  };

  const handleDelete = () => {
    onDelete?.(message.id);
    setShowMenu(false);
  };

  const handleQuickEmoji = (emoji: string) => {
    rememberRecentEmoji(emoji);
    onToggleReaction(message.id, emoji);
    setShowQuickReact(false);
  };

  const handleGifReactClick = () => {
    onGifReact(message.id);
    setShowQuickReact(false);
  };

  const handleFullPickerEmoji = (data: EmojiClickData) => {
    rememberRecentEmoji(data.emoji);
    onToggleReaction(message.id, data.emoji);
    setShowFullPicker(false);
    setShowQuickReact(false);
  };

  const handleReply = () => {
    onReply(message);
    setShowQuickReact(false);
    setShowMenu(false);
  };

  const handleStartEdit = () => {
    setEditing(true);
    setShowMenu(false);
  };

  const handleReport = () => {
    setShowReportModal(true);
    setShowMenu(false);
  };

  const reactions = message.reactions || [];

  // Edit eligibility: own text message, within 15-min window, not deleted.
  // Mirrors the server check so the UI doesn't expose options that will 403.
  const editableAgeMs = menuOpenedAt - new Date(message.created_at).getTime();
  const canEdit =
    isOwn
    && message.type === 'text'
    && !message.deleted_at
    && editableAgeMs < EDIT_WINDOW_MS;

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
            <div className="w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs font-bold">
              {getInitials(senderName)}
            </div>
          )}
          <span className="text-xs font-medium text-tertiary">{senderName}</span>
        </div>
      )}

      <div className={`flex items-end gap-2 max-w-xs sm:max-w-sm md:max-w-md ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Message content */}
        <div
          className="relative group"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onTouchMove={handleTouchEnd}
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
            editing ? (
              <EditMessageInline
                conversationId={message.conversation_id}
                messageId={message.id}
                initialContent={message.content || ''}
                isOwn={isOwn}
                onCancel={() => setEditing(false)}
                onUpdated={(fields) => {
                  setEditing(false);
                  onMessageEdited?.(message.id, fields.content, fields.edited_at);
                }}
              />
            ) : (
              <div className={`px-4 py-2.5 ${bubbleBase} max-w-full`}>
                <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
              </div>
            )
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
              {/* Rim stripped: this caption strip is rounded-none inside a
                  rounded-2xl overflow-hidden parent, so a square inset ring
                  gets sliced diagonally at the bottom corners. */}
              {message.content && (
                <div className={`px-3 py-2 ${bubbleBase.replace(/ ea-metal-rim(-brand)?/, '')} rounded-none`}>
                  <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                </div>
              )}
            </div>
          )}

          {message.type === 'gif_reaction' && message.media_url && (
            <div className="rounded-2xl overflow-hidden max-w-xs border border-border">
              <LazyImage
                src={message.media_url}
                alt="GIF reply"
                className="w-full max-h-64 object-contain"
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
              {message.content && (
                <div className={`px-3 py-2 ${bubbleBase.replace(/ ea-metal-rim(-brand)?/, '')} rounded-none`}>
                  <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                </div>
              )}
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

          {/* Quick-reaction bar — hover/fine-pointer ONLY (sm:pointer-fine:).
              Touch gets the long-press overlay below at every width instead:
              an always-on strip would put 28px targets under thumbs and stack
              with that overlay at this same bottom-full anchor. focus-within
              reveals it for keyboard users tabbing into its buttons. */}
          <div
            className={`absolute z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${
              isOwn ? 'right-0' : 'left-0'
            } bottom-full mb-1`}
          >
            <div className="hidden sm:pointer-fine:flex items-center gap-0.5 bg-surface border border-border rounded-full shadow-lg px-1.5 py-1">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleQuickEmoji(emoji)}
                  className="relative after:absolute after:content-[''] after:-inset-y-2 after:inset-x-0 w-7 h-7 flex items-center justify-center rounded-full hover:bg-surface-sunken transition-colors text-sm"
                  title={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={handleGifReactClick}
                className="relative after:absolute after:content-[''] after:-inset-y-2 after:inset-x-0 w-7 h-7 flex items-center justify-center rounded-full hover:bg-surface-sunken transition-colors text-[10px] font-bold text-muted"
                title="React with GIF"
              >
                GIF
              </button>
              <button
                onClick={() => setShowFullPicker(prev => !prev)}
                className="relative after:absolute after:content-[''] after:-inset-y-2 after:inset-x-0 w-7 h-7 flex items-center justify-center rounded-full hover:bg-surface-sunken transition-colors text-sm text-faint"
                title="More emojis"
              >
                +
              </button>
              <div className="w-px h-4 bg-gray-200 dark:bg-stone-800 mx-0.5" />
              <button
                onClick={handleReply}
                className="relative after:absolute after:content-[''] after:-inset-y-2 after:inset-x-0 w-7 h-7 flex items-center justify-center rounded-full hover:bg-surface-sunken transition-colors"
                title="Reply"
              >
                <i className="fas fa-reply text-xs text-faint"></i>
              </button>
              {/* Context actions — always available so Report is reachable on every incoming message */}
              <div className="w-px h-4 bg-gray-200 dark:bg-stone-800 mx-0.5" />
              <button
                onClick={() => { setMenuOpenedAt(Date.now()); setShowMenu(prev => !prev); }}
                className="relative after:absolute after:content-[''] after:-inset-y-2 after:inset-x-0 w-7 h-7 flex items-center justify-center rounded-full hover:bg-surface-sunken transition-colors"
                aria-label="More options"
              >
                <i className="fas fa-ellipsis-h text-xs text-faint"></i>
              </button>
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
                <div className="flex flex-wrap items-center gap-0.5 bg-surface-raised border border-border rounded-full shadow-lg px-1.5 py-1 max-w-[calc(100vw-3rem)]">
                  {QUICK_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleQuickEmoji(emoji)}
                      className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-sunken active:bg-gray-200 dark:active:bg-stone-800 transition-colors text-base"
                    >
                      {emoji}
                    </button>
                  ))}
                  <button
                    onClick={handleGifReactClick}
                    className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-sunken active:bg-gray-200 dark:active:bg-stone-800 transition-colors text-[10px] font-bold text-muted"
                  >
                    GIF
                  </button>
                  <button
                    onClick={() => setShowFullPicker(prev => !prev)}
                    className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-sunken active:bg-gray-200 dark:active:bg-stone-800 transition-colors text-base text-faint"
                    title="More emojis"
                  >
                    +
                  </button>
                  <div className="w-px h-5 bg-gray-200 dark:bg-stone-800 mx-0.5" />
                  <button
                    onClick={handleReply}
                    className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-sunken active:bg-gray-200 dark:active:bg-stone-800 transition-colors"
                    title="Reply"
                  >
                    <i className="fas fa-reply text-xs text-faint"></i>
                  </button>
                  <div className="w-px h-5 bg-gray-200 dark:bg-stone-800 mx-0.5" />
                  <button
                    onClick={() => { setShowQuickReact(false); setMenuOpenedAt(Date.now()); setShowMenu(true); }}
                    className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-sunken active:bg-gray-200 dark:active:bg-stone-800 transition-colors"
                  >
                    <i className="fas fa-ellipsis-h text-xs text-faint"></i>
                  </button>
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
                  theme={theme === 'dark' ? Theme.DARK : Theme.LIGHT}
                  lazyLoadEmojis
                  height={350}
                  width="min(300px, calc(100vw - 2rem))"
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
                className={`absolute z-20 mt-1 bg-surface-raised border border-border rounded-lg shadow-lg py-1 min-w-[120px] ${
                  isOwn ? 'right-0' : 'left-0'
                } top-full`}
              >
                <button
                  onClick={handleReply}
                  className="w-full text-left px-3 py-2 text-sm text-secondary hover:bg-surface-muted flex items-center gap-2"
                >
                  <i className="fas fa-reply text-xs w-4"></i>
                  Reply
                </button>
                {message.type === 'text' && (
                  <button
                    onClick={handleCopy}
                    className="w-full text-left px-3 py-2 text-sm text-secondary hover:bg-surface-muted flex items-center gap-2"
                  >
                    <i className="fas fa-copy text-xs w-4"></i>
                    Copy
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={handleStartEdit}
                    className="w-full text-left px-3 py-2 text-sm text-secondary hover:bg-surface-muted flex items-center gap-2"
                  >
                    <i className="fas fa-pen text-xs w-4"></i>
                    Edit
                  </button>
                )}
                {!isOwn && (
                  <button
                    onClick={handleReport}
                    className="w-full text-left px-3 py-2 text-sm text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40 flex items-center gap-2"
                  >
                    <i className="fas fa-flag text-xs w-4"></i>
                    Report
                  </button>
                )}
                {isOwn && (
                  <button
                    onClick={handleDelete}
                    className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2"
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
          align={isOwn ? 'right' : 'left'}
        />
      )}

      {/* Timestamp + edited indicator */}
      <span className={`text-xs text-faint mt-0.5 px-1 ${isOwn ? 'text-right' : 'text-left'}`}>
        {getRelativeTime(message.created_at)}
        {message.edited_at && (
          <span className="ml-1 italic" title={`Edited ${new Date(message.edited_at).toLocaleString()}`}>
            · edited
          </span>
        )}
      </span>

      {showReportModal && (
        <ReportMessageModal
          messageId={message.id}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </div>
  );
}
