'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useMessages } from '@/lib/messages';
import AppHeader from '@/components/AppHeader';
import ConversationList from '@/components/messages/ConversationList';
import ChatWindow from '@/components/messages/ChatWindow';
import NewConversationModal from '@/components/messages/NewConversationModal';

function MessagesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { conversations, loading } = useMessages();
  const [showNewModal, setShowNewModal] = useState(false);

  const activeId = searchParams.get('c');

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [authLoading, user, router]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fas fa-spinner fa-spin text-gray-400 text-2xl"></i>
      </div>
    );
  }

  if (!user) return null;

  return (
    <>
      <div className="flex h-full">
        {/* Conversation list — full width on mobile when no active chat, sidebar on desktop */}
        <div className={`
          flex-shrink-0 border-r border-gray-200
          ${activeId ? 'hidden lg:block lg:w-80' : 'w-full lg:w-80'}
        `}>
          <ConversationList
            conversations={conversations}
            currentUserId={user.id}
            loading={loading}
            activeId={activeId}
            onSelect={(id) => router.push(`/messages?c=${id}`)}
            onNewConversation={() => setShowNewModal(true)}
          />
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
          <div className="hidden lg:flex flex-1 items-center justify-center bg-gray-50">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-comment-alt text-gray-400 text-2xl"></i>
              </div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Your Messages</p>
              <p className="text-xs text-gray-400 mb-4">Select a conversation or start a new one</p>
              <button
                onClick={() => setShowNewModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors"
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
    <div className="flex flex-col h-dvh bg-white">
      <AppHeader showSearch={false} />
      <div className="flex-1 min-h-0">
        <Suspense fallback={
          <div className="flex items-center justify-center h-full">
            <i className="fas fa-spinner fa-spin text-gray-400 text-2xl"></i>
          </div>
        }>
          <MessagesContent />
        </Suspense>
      </div>
    </div>
  );
}
