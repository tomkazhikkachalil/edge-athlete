'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { Conversation, Message } from '@/types/messages';

interface MessagesContextType {
  conversations: Conversation[];
  totalUnreadCount: number;
  loading: boolean;
  fetchConversations: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  markConversationRead: (conversationId: string) => Promise<void>;
  addOptimisticMessage: (conversationId: string, message: Message) => void;
  removeConversation: (conversationId: string) => void;
}

const MessagesContext = createContext<MessagesContextType | undefined>(undefined);

export function MessagesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // Track subscribed channel refs so we can clean them up
  const channelRefs = useRef<Map<string, ReturnType<typeof supabase.channel>>>(new Map());
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Controller for the auto-fetches kicked off by the user-change effect.
  // Aborted on logout / effect cleanup so navigation races don't surface as scary console errors.
  const fetchAbortRef = useRef<AbortController | null>(null);

  const refreshUnreadCount = useCallback(async (signal?: AbortSignal) => {
    if (!user) return;
    try {
      const res = await fetch('/api/messages/unread-count', { signal });
      if (res.status === 401) return;
      if (res.ok) {
        const data = await res.json();
        setTotalUnreadCount(data.count ?? 0);
      } else {
        console.error('Failed to refresh unread count — status:', res.status);
      }
    } catch (e) {
      // Intentional abort (navigation, logout, unmount) is not a real failure.
      if (e instanceof Error && e.name === 'AbortError') return;
      console.error('Failed to refresh unread count:', e);
    }
  }, [user]);

  const fetchConversations = useCallback(async (signal?: AbortSignal) => {
    if (!user) return;
    try {
      const res = await fetch('/api/messages', { signal });
      if (res.status === 401) return;
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      } else {
        console.error('Failed to fetch conversations — status:', res.status);
      }
    } catch (e) {
      // Intentional abort (navigation, logout, unmount) is not a real failure.
      if (e instanceof Error && e.name === 'AbortError') return;
      console.error('Failed to fetch conversations:', e);
    }
  }, [user]);

  // Subscribe to a single conversation's messages channel
  const subscribeToConversation = useCallback((conversationId: string) => {
    if (channelRefs.current.has(conversationId)) return;

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: { new: unknown }) => {
          const newMsg = payload.new as Message;
          // Update conversation list: bump last_message + unread_count (if not own message)
          setConversations(prev =>
            prev
              .map(c => {
                if (c.id !== conversationId) return c;
                const isOwn = newMsg.sender_id === user?.id;
                return {
                  ...c,
                  last_message: newMsg,
                  updated_at: newMsg.created_at,
                  unread_count: isOwn ? c.unread_count : c.unread_count + 1,
                };
              })
              .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          );
          if (newMsg.sender_id !== user?.id) {
            setTotalUnreadCount(prev => prev + 1);
          }
        }
      )
      .subscribe();

    channelRefs.current.set(conversationId, channel);
  }, [user?.id]);

  const unsubscribeFromConversation = useCallback((conversationId: string) => {
    const ch = channelRefs.current.get(conversationId);
    if (ch) {
      ch.unsubscribe();
      channelRefs.current.delete(conversationId);
    }
  }, []);

  // When conversations list changes, subscribe to any new conversation channels
  useEffect(() => {
    const currentIds = new Set(conversations.map(c => c.id));
    // Subscribe to new ones
    for (const id of currentIds) {
      if (!channelRefs.current.has(id)) {
        subscribeToConversation(id);
      }
    }
    // Unsubscribe from ones no longer in the list
    for (const [id] of channelRefs.current) {
      if (!currentIds.has(id)) {
        unsubscribeFromConversation(id);
      }
    }
  }, [conversations, subscribeToConversation, unsubscribeFromConversation]);

  // Initial load + setup
  useEffect(() => {
    if (user) {
      // Cancel any in-flight fetches from a prior render so they don't race with this one.
      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;

      setLoading(true);
      Promise.all([
        fetchConversations(controller.signal),
        refreshUnreadCount(controller.signal),
      ]).finally(() => {
        // If a newer effect run aborted us, don't stomp its loading state.
        if (!controller.signal.aborted) setLoading(false);
      });

      // 30-second poll fallback for realtime gaps.
      // Each poll cycle gets its own controller so a stale abort never kills future polls.
      pollTimerRef.current = setInterval(() => {
        const pollController = new AbortController();
        fetchConversations(pollController.signal);
        refreshUnreadCount(pollController.signal);
      }, 30_000);
    } else {
      // Clear state on logout
      fetchAbortRef.current?.abort();
      fetchAbortRef.current = null;
      setConversations([]);
      setTotalUnreadCount(0);
      setLoading(false);
      // Unsubscribe all channels
      for (const [, ch] of channelRefs.current) {
        ch.unsubscribe();
      }
      channelRefs.current.clear();
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    return () => {
      fetchAbortRef.current?.abort();
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const markConversationRead = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/messages/${conversationId}/read`, { method: 'PATCH' });
      if (!res.ok) {
        console.error('Failed to mark conversation read — status:', res.status);
        return;
      }
      setConversations(prev =>
        prev.map(c =>
          c.id === conversationId
            ? { ...c, unread_count: 0 }
            : c
        )
      );
      setTotalUnreadCount(prev => {
        const conv = conversations.find(c => c.id === conversationId);
        return Math.max(0, prev - (conv?.unread_count || 0));
      });
    } catch (e) {
      console.error('Failed to mark conversation read:', e);
    }
  }, [conversations]);

  const addOptimisticMessage = useCallback((conversationId: string, message: Message) => {
    setConversations(prev =>
      prev
        .map(c => {
          if (c.id !== conversationId) return c;
          return { ...c, last_message: message, updated_at: message.created_at };
        })
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    );
  }, []);

  const removeConversation = useCallback((conversationId: string) => {
    setConversations(prev => prev.filter(c => c.id !== conversationId));
    unsubscribeFromConversation(conversationId);
  }, [unsubscribeFromConversation]);

  return (
    <MessagesContext.Provider
      value={{
        conversations,
        totalUnreadCount,
        loading,
        fetchConversations,
        refreshUnreadCount,
        markConversationRead,
        addOptimisticMessage,
        removeConversation,
      }}
    >
      {children}
    </MessagesContext.Provider>
  );
}

export function useMessages(): MessagesContextType {
  const context = useContext(MessagesContext);
  if (!context) {
    throw new Error('useMessages must be used within a MessagesProvider');
  }
  return context;
}
