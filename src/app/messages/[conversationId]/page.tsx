'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import ChatWindow from '@/components/messages/ChatWindow';

export default function ConversationPage() {
  const router = useRouter();
  const params = useParams();
  const { user, loading: authLoading } = useAuth();
  const conversationId = params.conversationId as string;

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [authLoading, user, router]);

  // On large screens, redirect to split-pane view
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      router.replace(`/messages?c=${conversationId}`);
    }
  }, [conversationId, router]);

  if (authLoading || !user) return null;

  return (
    <div className="flex flex-col h-screen h-[100dvh] bg-white">
      <AppHeader showSearch={false} />
      <div className="flex-1 min-h-0">
        <ChatWindow
          conversationId={conversationId}
          onBack={() => router.push('/messages')}
        />
      </div>
    </div>
  );
}
