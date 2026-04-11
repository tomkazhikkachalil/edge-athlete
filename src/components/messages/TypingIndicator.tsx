'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface Props {
  conversationId: string;
  currentUserId: string;
}

export default function TypingIndicator({ conversationId, currentUserId }: Props) {
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set());
  const timeoutsRef: Record<string, ReturnType<typeof setTimeout>> = {};

  const clearTyping = useCallback((userId: string) => {
    setTypingUserIds(prev => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`typing:${conversationId}`)
      .on('broadcast', { event: 'typing' }, ({ payload }: { payload: { user_id: string } }) => {
        const userId = payload?.user_id;
        if (!userId || userId === currentUserId) return;

        setTypingUserIds(prev => {
          const next = new Set(prev);
          next.add(userId);
          return next;
        });

        // Clear typing after 3 seconds of no new broadcast
        if (timeoutsRef[userId]) clearTimeout(timeoutsRef[userId]);
        timeoutsRef[userId] = setTimeout(() => clearTyping(userId), 3000);
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
      Object.values(timeoutsRef).forEach(clearTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, currentUserId]);

  if (typingUserIds.size === 0) return null;

  return (
    <div className="px-4 pb-1 flex items-center gap-1.5">
      <div className="flex gap-0.5 items-center">
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-xs text-gray-400 italic">
        {typingUserIds.size === 1 ? 'Someone is typing…' : 'Several people are typing…'}
      </span>
    </div>
  );
}
