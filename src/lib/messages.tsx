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
  // Live mirror of `conversations` for callbacks that consumers capture once
  // at mount (e.g. ChatWindow's realtime handler) — reading the state directly
  // there would see a stale snapshot and corrupt the unread total.
  const conversationsRef = useRef<Conversation[]>([]);
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // Track subscribed channel refs so we can clean them up
  const channelRefs = useRef<Map<string, ReturnType<typeof supabase.channel>>>(new Map());

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visibilityCleanupRef = useRef<(() => void) | null>(null);
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
      // Network-level failure (offline, dev-server restart, flaky radio)
      // surfaces as a TypeError. This is a background poll: existing data
      // stands and the next cycle retries — console.error here painted red
      // dev-overlay errors for a self-healing blip.
      if (e instanceof TypeError) return;
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
      // Same rule as refreshUnreadCount: a network blip on a background
      // poll is not an error — data stands, the 30s cycle retries.
      if (e instanceof TypeError) return;
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

      // OUT OF SCOPE by decision: this provider coordinates an AbortController,
      // a 30s poll and channel teardown. A subtle mistake here is an outage,
      // not a glitch, so the loader stays a useCallback shared with them.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(true);
      Promise.all([
        fetchConversations(controller.signal),
        refreshUnreadCount(controller.signal),
      ]).finally(() => {
        // If a newer effect run aborted us, don't stomp its loading state.
        if (!controller.signal.aborted) setLoading(false);
      });

      // 30-second poll fallback for realtime gaps. This provider mounts in the
      // ROOT layout, so it runs for every logged-in user on every page — a
      // backgrounded tab must NOT keep polling all day (the single largest
      // sustained cost in the app). Skip a cycle when the tab is hidden;
      // realtime covers a focused tab, and a visibilitychange catch-up fires
      // one refresh the moment the tab returns to the foreground.
      // Each poll cycle gets its own controller so a stale abort never kills future polls.
      pollTimerRef.current = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        const pollController = new AbortController();
        fetchConversations(pollController.signal);
        refreshUnreadCount(pollController.signal);
      }, 30_000);

      const onVisible = () => {
        if (document.hidden) return;
        const c = new AbortController();
        fetchConversations(c.signal);
        refreshUnreadCount(c.signal);
      };
      document.addEventListener('visibilitychange', onVisible);
      visibilityCleanupRef.current = () => document.removeEventListener('visibilitychange', onVisible);
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
      visibilityCleanupRef.current?.();
      visibilityCleanupRef.current = null;
    }

    return () => {
      fetchAbortRef.current?.abort();
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      visibilityCleanupRef.current?.();
      visibilityCleanupRef.current = null;
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const markConversationRead = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/messages/${conversationId}/read`, { method: 'PATCH' });
      if (!res.ok) {
        console.error('Failed to mark conversation read — status:', res.status);
        return;
      }
      // Read the CURRENT unread count from the ref, not the `conversations`
      // closure — consumers capture this callback once at mount, so a state
      // read here could be arbitrarily stale and over-decrement the total.
      const conv = conversationsRef.current.find(c => c.id === conversationId);
      const unread = conv?.unread_count || 0;
      setConversations(prev =>
        prev.map(c =>
          c.id === conversationId
            ? { ...c, unread_count: 0 }
            : c
        )
      );
      if (unread > 0) {
        setTotalUnreadCount(prev => Math.max(0, prev - unread));
      }
    } catch (e) {
      console.error('Failed to mark conversation read:', e);
    }
  }, []);

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
