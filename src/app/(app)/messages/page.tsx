'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useMessages } from '@/lib/messages';
import AppHeader from '@/components/AppHeader';
import ConversationList from '@/components/messages/ConversationList';
import ChatWindow from '@/components/messages/ChatWindow';
import NewConversationModal from '@/components/messages/NewConversationModal';
import QuickMessagesToggle from '@/components/messages/QuickMessagesToggle';
import { useVisualViewportHeight } from '@/hooks/useVisualViewportHeight';

function MessagesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { conversations, loading } = useMessages();
  const [showNewModal, setShowNewModal] = useState(false);
  useVisualViewportHeight();

  const activeId = searchParams.get('c');

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [authLoading, user, router]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fas fa-spinner fa-spin text-faint text-2xl"></i>
      </div>
    );
  }

  if (!user) return null;

  return (
    <>
      <div className="flex h-full">
        {/* Conversation list — full width on mobile when no active chat, sidebar on desktop.
            A flex column with min-h-0 so the list keeps its own scroll and the
            Quick messages row stays pinned at the bottom instead of being
            pushed off-screen. Note lg:flex (not lg:block) for the same reason. */}
        <div className={`
          flex-shrink-0 border-r border-border flex flex-col min-h-0
          ${activeId ? 'hidden lg:flex lg:w-80' : 'w-full lg:w-80'}
        `}>
          <div className="flex-1 min-h-0">
            <ConversationList
              conversations={conversations}
              currentUserId={user.id}
              loading={loading}
              activeId={activeId}
              onSelect={(id) => router.push(`/messages?c=${id}`)}
              onNewConversation={() => setShowNewModal(true)}
            />
          </div>
          <div className="shrink-0">
            <QuickMessagesToggle />
          </div>
        </div>

        {/* Chat pane */}
        {activeId ? (
          <div className="flex-1 min-w-0">
            <ChatWindow
              key={activeId}
              conversationId={activeId}
              onBack={() => router.push('/messages')}
            />
          </div>
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center bg-surface-muted">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-200 dark:bg-stone-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-comment-alt text-faint text-2xl"></i>
              </div>
              <p className="text-sm font-semibold text-secondary mb-1">Your Messages</p>
              <p className="text-xs text-faint mb-4">Select a conversation or start a new one</p>
              <button
                onClick={() => setShowNewModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg text-sm font-semibold hover:bg-brand-hover transition-colors"
              >
                <i className="fas fa-plus text-xs"></i>
                New Message
              </button>
            </div>
          </div>
        )}
      </div>

      {showNewModal && (
        <NewConversationModal onClose={() => setShowNewModal(false)} />
      )}
    </>
  );
}

export default function MessagesPage() {
  return (
    <div className="flex flex-col h-dvh bg-surface" style={{ height: 'var(--vvh, 100dvh)' }}>
      <AppHeader showSearch={false} />
      <div className="flex-1 min-h-0">
        <Suspense fallback={
          <div className="flex items-center justify-center h-full">
            <i className="fas fa-spinner fa-spin text-faint text-2xl"></i>
          </div>
        }>
          <MessagesContent />
        </Suspense>
      </div>
    </div>
  );
}
