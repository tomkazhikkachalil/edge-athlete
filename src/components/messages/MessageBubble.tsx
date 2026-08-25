'use client';

import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { Theme } from 'emoji-picker-react';
import type { EmojiClickData } from 'emoji-picker-react';
import { useTheme } from '@/lib/use-theme';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import ReactionBar, { rememberRecentEmoji } from './ReactionBar';
import QuotedReply from './QuotedReply';
import EditMessageInline from './EditMessageInline';
import ReportMessageModal from './ReportMessageModal';
import ConfirmModal from '@/components/ConfirmModal';
import MessageBubbleContent from './MessageBubbleContent';
import MessageActionSheet, { type SheetAnchor } from './MessageActionSheet';
import { haptic } from '@/lib/haptics';
import type { Message, ParticipantProfile } from '@/types/messages';

const EDIT_WINDOW_MS = 15 * 60 * 1000; // mirror server-side window for UI gating

const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => null,
});

export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥'];

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
  /** Active members, for @mention rendering + the action sheet replica. */
  participants?: ParticipantProfile[];
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
  participants,
}: Props) {
  const { theme } = useTheme();
  const [showMenu, setShowMenu] = useState(false);
  // Timestamp captured when the menu OPENS, not read during render.
  // Date.now() in render is impure (react-hooks/purity) and made the edit
  // window depend on whenever React happened to re-render this bubble.
  // Evaluating it at open time is what the check actually means.
  const [menuOpenedAt, setMenuOpenedAt] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetAnchor, setSheetAnchor] = useState<SheetAnchor | null>(null);
  const [showFullPicker, setShowFullPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  // Delete is confirmed here, ONCE, so every entry point (desktop hover
  // menu, mobile action sheet, full page, dock) gets the same gate —
  // deleting a message is permanent and was a single stray tap
  // (dummy-proofing round).
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // A completed long-press must not ALSO deliver the tap underneath it
  // (SharedPostPreview's button, video controls) — ReactionBar's
  // suppressClickRef pattern.
  const suppressClickRef = useRef(false);

  // Long-press opens the action sheet — the ONE touch path to reactions and
  // message actions. Must be before any early return. Arming bails while
  // editing: the sheet's replica would show stale non-editing content over
  // the live textarea.
  const handleTouchStart = useCallback(() => {
    if (editing) return;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      // Armed for the ghost click the press-release synthesizes; expires on
      // its own because not every browser fires one — without the timeout
      // the flag would eat the user's next genuine tap on this bubble.
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 600);
      haptic();
      // Stamp the edit-window gate exactly like the ⋯ menu does: canEdit
      // derives from menuOpenedAt, and an unstamped open would make the
      // age negative — Edit would show forever.
      setMenuOpenedAt(Date.now());
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect) {
        setSheetAnchor({ top: rect.top, left: rect.left, right: rect.right });
        setSheetOpen(true);
      }
    }, 400);
  }, [editing]);

  // Also wired to onTouchMove: a scroll that starts with a finger on a
  // bubble must cancel the press, not open the sheet 400ms into the
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

  const handleCopy = () => {
    if (message.content) navigator.clipboard.writeText(message.content);
    setShowMenu(false);
  };

  // The modal PORTALS to body per the messages-surface rule: bubbles sit
  // under transformed/scrolling ancestors that break fixed positioning.
  const handleDelete = () => {
    setConfirmingDelete(true);
    setShowMenu(false);
  };

  const handleQuickEmoji = (emoji: string) => {
    rememberRecentEmoji(emoji);
    onToggleReaction(message.id, emoji);
  };

  const handleGifReactClick = () => {
    onGifReact(message.id);
  };

  const handleFullPickerEmoji = (data: EmojiClickData) => {
    rememberRecentEmoji(data.emoji);
    onToggleReaction(message.id, data.emoji);
    setShowFullPicker(false);
  };

  const handleReply = () => {
    onReply(message);
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
          ref={wrapperRef}
          // min-w-0 is load-bearing: QuotedReply's truncate line is nowrap,
          // so without it this flex item's min-content floor is the FULL
          // one-line snippet — the bubble blows past the row's max-w-xs and
          // off the screen edge on phones.
          className="relative group ea-no-touch-select min-w-0"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onTouchMove={handleTouchEnd}
          onClickCapture={(e) => {
            // Swallow the ghost click a completed long-press synthesizes.
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onContextMenu={(e) => {
            // Gesture-scoped, not device-scoped: Android's native long-press
            // menu (~500ms) fires after our 400ms timer set these flags, so
            // it's suppressed — while desktop right-click stays native.
            if (sheetOpen || longPressTimer.current || suppressClickRef.current) {
              e.preventDefault();
            }
          }}
        >
          {/* Quoted reply preview */}
          {message.reply_to && (
            <QuotedReply
              replyTo={message.reply_to}
              isOwn={isOwn}
              onScrollToMessage={onScrollToMessage}
            />
          )}

          {message.type === 'text' && editing ? (
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
            <MessageBubbleContent message={message} isOwn={isOwn} onViewPost={onViewPost} participants={participants} />
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

      {/* Long-press action sheet (touch). Every callback closes the sheet
          FIRST, then invokes: GifPickerModal and ReportMessageModal sit at
          z-50, below the sheet's z-[60] backdrop — React batches the pair,
          so the sheet unmounts in the same commit the modal mounts. */}
      {sheetOpen && sheetAnchor && (
        <MessageActionSheet
          message={message}
          isOwn={isOwn}
          canEdit={canEdit}
          participants={participants}
          quickEmojis={QUICK_EMOJIS}
          anchorRect={sheetAnchor}
          onClose={() => setSheetOpen(false)}
          onEmoji={(emoji) => { setSheetOpen(false); handleQuickEmoji(emoji); }}
          onGif={() => { setSheetOpen(false); handleGifReactClick(); }}
          onReply={() => { setSheetOpen(false); handleReply(); }}
          onCopy={() => { setSheetOpen(false); if (message.content) navigator.clipboard.writeText(message.content); }}
          onEdit={() => { setSheetOpen(false); setEditing(true); }}
          onReport={() => { setSheetOpen(false); setShowReportModal(true); }}
          onDelete={() => { setSheetOpen(false); setConfirmingDelete(true); }}
        />
      )}

      {confirmingDelete &&
        createPortal(
          <ConfirmModal
            isOpen
            title="Delete this message?"
            message="It will be removed for everyone in the conversation. This can't be undone."
            confirmText="Delete"
            onConfirm={() => {
              setConfirmingDelete(false);
              onDelete?.(message.id);
            }}
            onCancel={() => setConfirmingDelete(false)}
          />,
          document.body
        )}
    </div>
  );
}
