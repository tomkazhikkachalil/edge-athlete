'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { Theme } from 'emoji-picker-react';
import type { EmojiClickData } from 'emoji-picker-react';
import { useTheme } from '@/lib/use-theme';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import MessageBubbleContent from './MessageBubbleContent';
import QuotedReply from './QuotedReply';
import { clampSheetTop, SHEET_VIEWPORT_MARGIN_PX } from './action-sheet-layout';
import { EMOJI_PANEL_WIDTH_PX, EMOJI_PANEL_HEIGHT_PX } from './composer-layout';
import type { Message } from '@/types/messages';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => null,
});

/** How long after mount the backdrop ignores clicks: the finger lifting off
 *  a completed long-press can synthesize a click at that point, which lands
 *  on the backdrop (topmost) and would close the sheet the instant it opened. */
const OPEN_GRACE_MS = 400;

export interface SheetAnchor {
  top: number;
  left: number;
  right: number;
}

interface Props {
  message: Message;
  isOwn: boolean;
  canEdit: boolean;
  quickEmojis: string[];
  anchorRect: SheetAnchor;
  onClose: () => void;
  onEmoji: (emoji: string) => void;
  onGif: () => void;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onReport: () => void;
  onDelete: () => void;
}

const actionRowClass =
  'w-full text-left px-4 min-h-[44px] text-sm flex items-center gap-3';

/**
 * The long-press "message actions" sheet — the ONE touch surface for
 * reactions and message actions (Tom's call: long-press is the one touch
 * affordance; desktop keeps the hover strip + ⋯ menu).
 *
 * PORTALED to document.body: inside the chat dock everything lives under a
 * z-[45] stacking context (ChatDock row) and both thread panes are
 * overflow-y-auto scrollers — rendered in place, the sheet would be z-capped
 * below real modals and its panel clipped by the scroller. SSR-safe the
 * HeaderSearch way: the parent only mounts this while open, never on the
 * server. Dimmed backdrop swallows the outside tap — dialog semantics
 * (usePopoverDismiss's mousedown pattern is for non-modal popovers).
 *
 * Every action closes the sheet FIRST (in the parent's callbacks) so the
 * z-50 surfaces it can open (GifPickerModal, ReportMessageModal) aren't
 * buried under this z-[60] backdrop.
 */
export default function MessageActionSheet({
  message,
  isOwn,
  canEdit,
  quickEmojis,
  anchorRect,
  onClose,
  onEmoji,
  onGif,
  onReply,
  onCopy,
  onEdit,
  onReport,
  onDelete,
}: Props) {
  const { theme } = useTheme();
  const [showPicker, setShowPicker] = useState(false);
  const [top, setTop] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const emojiRowRef = useRef<HTMLDivElement | null>(null);
  const openedAtRef = useRef(0);

  useBodyScrollLock(true);

  useEffect(() => {
    openedAtRef.current = Date.now();
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Measure-then-place before paint. The visual viewport (not innerHeight)
  // is what matters when the keyboard is up; the --vvh CSS var is /messages
  // only, so read the API directly. Re-runs when the picker swaps in — the
  // panel height changes by ~350px.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    setTop(
      clampSheetTop({
        anchorTop: anchorRect.top,
        emojiRowHeight: emojiRowRef.current?.offsetHeight ?? 0,
        panelHeight: panel.offsetHeight,
        viewportTop: vv?.offsetTop ?? 0,
        viewportHeight: vv?.height ?? window.innerHeight,
      })
    );
  }, [anchorRect.top, showPicker]);

  const handleBackdropClick = () => {
    if (Date.now() - openedAtRef.current < OPEN_GRACE_MS) return;
    onClose();
  };

  const handlePickerEmoji = (data: EmojiClickData) => {
    onEmoji(data.emoji);
  };

  const horizontal = isOwn
    ? { right: Math.max(SHEET_VIEWPORT_MARGIN_PX, window.innerWidth - anchorRect.right) }
    : { left: Math.max(SHEET_VIEWPORT_MARGIN_PX, anchorRect.left) };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm ea-backdrop-fade"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Message actions"
        tabIndex={-1}
        className={`fixed z-[61] ea-sheet-pop ${isOwn ? 'ea-sheet-pop-right items-end' : 'ea-sheet-pop-left items-start'} flex flex-col gap-2 max-w-[calc(100vw-1rem)] outline-none`}
        style={{ top: top ?? anchorRect.top, ...horizontal, visibility: top === null ? 'hidden' : undefined }}
      >
        {showPicker ? (
          <EmojiPicker
            onEmojiClick={handlePickerEmoji}
            theme={theme === 'dark' ? Theme.DARK : Theme.LIGHT}
            lazyLoadEmojis
            height={EMOJI_PANEL_HEIGHT_PX}
            width={`min(${EMOJI_PANEL_WIDTH_PX}px, calc(100vw - 2rem))`}
            searchPlaceholder="Search emoji…"
          />
        ) : (
          <>
            <div
              ref={emojiRowRef}
              className="flex flex-wrap items-center gap-0.5 bg-surface-raised border border-border rounded-full shadow-lg px-1.5 py-1 max-w-full"
            >
              {quickEmojis.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => onEmoji(emoji)}
                  className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-surface-sunken active:bg-gray-200 dark:active:bg-stone-800 transition-colors text-lg"
                >
                  {emoji}
                </button>
              ))}
              <button
                onClick={onGif}
                className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-surface-sunken active:bg-gray-200 dark:active:bg-stone-800 transition-colors text-[11px] font-bold text-muted"
              >
                GIF
              </button>
              <button
                onClick={() => setShowPicker(true)}
                className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-surface-sunken active:bg-gray-200 dark:active:bg-stone-800 transition-colors text-lg text-faint"
                aria-label="More emojis"
              >
                +
              </button>
            </div>

            {/* Replica of the pressed message. pointer-events-none is what
                neutralises the nested interactive bits (SharedPostPreview's
                <button>, <video controls>) — this is a preview, not a target.
                The max-w must be a VIEWPORT-based definite cap: a max-w-full
                would resolve circularly against the fit-content panel, and
                QuotedReply's nowrap truncate line needs a definite containing
                block to actually ellipse. */}
            <div className="pointer-events-none max-h-[40vh] max-w-[calc(100vw-2rem)] overflow-hidden">
              {message.reply_to && (
                <QuotedReply replyTo={message.reply_to} isOwn={isOwn} />
              )}
              <MessageBubbleContent message={message} isOwn={isOwn} />
            </div>

            <div className="bg-surface-raised border border-border rounded-xl shadow-lg py-1 min-w-[180px]">
              <button onClick={onReply} className={`${actionRowClass} text-secondary hover:bg-surface-muted`}>
                <i className="fas fa-reply text-xs w-4"></i>
                Reply
              </button>
              {message.type === 'text' && (
                <button onClick={onCopy} className={`${actionRowClass} text-secondary hover:bg-surface-muted`}>
                  <i className="fas fa-copy text-xs w-4"></i>
                  Copy
                </button>
              )}
              {canEdit && (
                <button onClick={onEdit} className={`${actionRowClass} text-secondary hover:bg-surface-muted`}>
                  <i className="fas fa-pen text-xs w-4"></i>
                  Edit
                </button>
              )}
              {!isOwn && (
                <button onClick={onReport} className={`${actionRowClass} text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40`}>
                  <i className="fas fa-flag text-xs w-4"></i>
                  Report
                </button>
              )}
              {isOwn && (
                <button onClick={onDelete} className={`${actionRowClass} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40`}>
                  <i className="fas fa-trash text-xs w-4"></i>
                  Delete
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>,
    document.body
  );
}
