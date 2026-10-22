'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useMessages } from '@/lib/messages';
import AppHeader from '@/components/AppHeader';
import ConversationList from '@/components/messages/ConversationList';
import ChatWindow from '@/components/messages/ChatWindow';
import NewConversationModal from '@/components/messages/NewConversationModal';
import QuickMessagesToggle from '@/components/messages/QuickMessagesToggle';
import { useVisualViewportHeight } from '@/hooks/useVisualViewportHeight';
import { useThreadViewport } from '@/hooks/useThreadViewport';
import { useIsDesktop } from '@/hooks/useIsDesktop';

function MessagesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { conversations, loading } = useMessages();
  const [showNewModal, setShowNewModal] = useState(false);
  useVisualViewportHeight();

  const activeId = searchParams.get('c');
  // The phone thread shell follows the visual viewport (Oct 14 2026); the
  // list screen keeps the --vvh model above. Inert from lg (the split pane).
  const shellRef = useRef<HTMLDivElement | null>(null);
  const isDesktop = useIsDesktop();
  // Enabled only once the shell can be in the DOM (auth resolved, a thread
  // open): the hook's effect re-runs on `enabled`, and the shell renders
  // below the auth-loading branch — enabled earlier, the effect found no
  // element and never ran again (the first staging run, Oct 15 2026).
  const { keyboardOpen } = useThreadViewport(shellRef, !isDesktop && !!activeId && !authLoading && !!user);
  // `compose=1` (the profile's Message door, Oct 14 2026): the composer takes
  // focus once the thread has loaded. The intent is captured at mount and the
  // flag replaced out of the URL, so a refresh or a shared link does not
  // refocus — and the prop cannot flip back before the thread has loaded.
  const [composeIntent] = useState(() => searchParams.get('compose') === '1');
  useEffect(() => {
    if (composeIntent && activeId) window.history.replaceState(null, '', `/messages?c=${activeId}`);
  }, [composeIntent, activeId]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [authLoading, user, router]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <i className="fas fa-spinner fa-spin text-decor text-2xl"></i>
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
          <div ref={shellRef} data-thread-shell="" className="flex-1 min-w-0 ea-thread-shell flex flex-col bg-surface">
            <ChatWindow
              key={activeId}
              conversationId={activeId}
              autoFocusComposer={composeIntent}
              keyboardOpen={keyboardOpen}
              onBack={() => router.push('/messages')}
            />
          </div>
        ) : (
          <div className="hidden lg:flex flex-1 items-center justify-center bg-surface-muted">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-200 dark:bg-stone-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-comment-alt text-decor text-2xl"></i>
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

/** The app header — hidden below lg while a thread is open (the thread has its own: Back, the name, the menu). */
function ThreadAwareHeader() {
  const searchParams = useSearchParams();
  return (
    <div className={searchParams.get('c') ? 'hidden lg:block' : ''}>
      <AppHeader showSearch={false} />
    </div>
  );
}

export default function MessagesPage() {
  return (
    <div className="flex flex-col h-dvh bg-surface" style={{ height: 'calc(var(--vvh, 100dvh) - var(--ea-tabbar-h, 0px) - var(--ea-dock-h, 0px))' }}>
      <Suspense fallback={<AppHeader showSearch={false} />}>
        <ThreadAwareHeader />
      </Suspense>
      <div className="flex-1 min-h-0">
        <Suspense fallback={
          <div className="flex items-center justify-center h-full">
            <i className="fas fa-spinner fa-spin text-decor text-2xl"></i>
          </div>
        }>
          <MessagesContent />
        </Suspense>
      </div>
    </div>
  );
}
