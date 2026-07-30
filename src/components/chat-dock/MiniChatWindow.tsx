'use client';

import { useMemo, useRef } from 'react';
import LazyImage from '@/components/LazyImage';
import GifPickerModal from '@/components/GifPickerModal';
import MessageBubble from '@/components/messages/MessageBubble';
import MessageInput from '@/components/messages/MessageInput';
import TypingIndicator from '@/components/messages/TypingIndicator';
import { useMiniThread } from './useMiniThread';
import { conversationIdentity, isConversationPartnerOnline } from './conversation-identity';
import { loadDraft, saveDraft } from './drafts';
import type { Conversation } from '@/types/messages';

// A fully working conversation in miniature: the same MessageBubble /
// MessageInput / TypingIndicator the full page uses, the same endpoints,
// smaller chrome. "Open full view" jumps to /messages?c=<id> — one system,
// two doors. Note: the rounded shell deliberately avoids overflow-hidden
// so the emoji/reaction popovers can escape the window bounds.

export default function MiniChatWindow({
  conversation,
  currentUserId,
  minimized,
  onlineIds,
  onMinimize,
  onClose,
  onOpenFull,
}: {
  conversation: Conversation;
  currentUserId: string;
  minimized: boolean;
  onlineIds: Set<string>;
  onMinimize: () => void;
  onClose: () => void;
  onOpenFull: () => void;
}) {
  const thread = useMiniThread(conversation.id, currentUserId, minimized);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialDraft = useMemo(() => loadDraft(conversation.id), [conversation.id]);

  const identity = conversationIdentity(conversation, currentUserId);
  const { title, avatarUrl, initials, isGroup } = identity;
  const online = isConversationPartnerOnline(identity, onlineIds);

  const handleTextChange = (text: string) => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    if (text === '') {
      // Write-through on empty so send reliably clears the draft.
      saveDraft(conversation.id, '');
      return;
    }
    draftTimerRef.current = setTimeout(() => saveDraft(conversation.id, text), 400);
  };

  return (
    <div
      data-testid="mini-chat-window"
      className="w-80 bg-white rounded-t-lg shadow-2xl border border-gray-200 border-b-0 flex flex-col"
      /* 30rem gives the emoji/reaction pickers room inside the message
         scroller (they need ~350px and were being clipped at 26rem); the
         min() keeps the whole window on-screen on short viewports. */
      style={{ height: 'min(30rem, calc(100vh - 2rem))' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-violet-600 text-white rounded-t-lg shrink-0">
        <span className="relative shrink-0">
          <span className="block w-7 h-7 rounded-full overflow-hidden bg-violet-400">
            {avatarUrl ? (
              <LazyImage src={avatarUrl} alt={title} className="w-full h-full object-cover" />
            ) : (
              <span className="w-full h-full flex items-center justify-center text-[10px] font-semibold text-white">
                {initials}
              </span>
            )}
          </span>
          {online && (
            <span className="absolute bottom-0 right-0 w-2 h-2 bg-emerald-400 border border-violet-600 rounded-full"></span>
          )}
        </span>
        <span className="flex-1 text-sm font-semibold truncate">{title}</span>
        <button
          type="button"
          onClick={onOpenFull}
          aria-label="Open full view"
          title="Open full view"
          className="w-6 h-6 rounded hover:bg-violet-500 flex items-center justify-center"
        >
          <i className="fas fa-up-right-and-down-left-from-center text-[10px]"></i>
        </button>
        <button
          type="button"
          onClick={onMinimize}
          aria-label="Minimize"
          title="Minimize"
          className="w-6 h-6 rounded hover:bg-violet-500 flex items-center justify-center"
        >
          <i className="fas fa-minus text-[10px]"></i>
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          title="Close"
          className="w-6 h-6 rounded hover:bg-violet-500 flex items-center justify-center"
        >
          <i className="fas fa-xmark text-xs"></i>
        </button>
      </div>

      {/* Messages — newest-first + column-reverse = free stick-to-bottom. */}
      <div className="flex-1 overflow-y-auto flex flex-col-reverse px-2 py-2 gap-1 bg-gray-50/50">
        {thread.loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-violet-600"></div>
          </div>
        ) : thread.messages.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-8">Say hi 👋</p>
        ) : (
          <>
            {thread.messages.map(message => (
              <MessageBubble
                key={message.id}
                message={message}
                isOwn={message.sender_id === currentUserId}
                showSender={isGroup && message.sender_id !== currentUserId}
                onDelete={thread.handleDelete}
                onToggleReaction={thread.handleToggleReaction}
                onGifReact={thread.setGifReactingMessageId}
                onReply={thread.handleReply}
                onMessageEdited={thread.handleMessageEdited}
              />
            ))}
            {thread.hasMore && (
              <button
                type="button"
                onClick={thread.loadOlder}
                disabled={thread.loadingMore}
                className="text-xs text-violet-600 hover:underline py-1.5 disabled:opacity-50"
              >
                {thread.loadingMore ? 'Loading…' : 'Load earlier messages'}
              </button>
            )}
          </>
        )}
      </div>

      <TypingIndicator conversationId={conversation.id} currentUserId={currentUserId} />

      <div className="shrink-0 border-t border-gray-100">
        <MessageInput
          conversationId={conversation.id}
          currentUserId={currentUserId}
          onSend={thread.handleSend}
          replyingTo={thread.replyingTo}
          onCancelReply={thread.handleCancelReply}
          initialText={initialDraft}
          onTextChange={handleTextChange}
        />
      </div>

      {thread.gifReactingMessageId && (
        <GifPickerModal
          title="React with a GIF"
          onGifSelect={thread.handleGifReactSelect}
          onClose={() => thread.setGifReactingMessageId(null)}
        />
      )}
    </div>
  );
}
