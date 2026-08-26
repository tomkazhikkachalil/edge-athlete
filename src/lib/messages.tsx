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
  hasMoreConversations: boolean;
  loadMoreConversations: () => Promise<void>;
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
  // Conversation-list pagination (migration 127): the server frontier is
  // updated ONLY by the initial load and loadMore — never by the 30s poll,
  // which refreshes PAGE ONE and merges by id (see fetchConversations).
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const nextConvCursorRef = useRef<string | null>(null);
  const loadMoreInFlightRef = useRef(false);
  // True once the user has actually paginated. Until then a page-1 refresh
  // REPLACES the list wholesale (the exact pre-pagination semantics — cross-
  // device deletions disappear on the next poll); after, it merges by id so
  // deep-loaded items survive.
  const deepLoadedRef = useRef(false);

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
      const res = await fetch('/api/messages?limit=30', { signal });
      if (res.status === 401) return;
      if (res.ok) {
        const data = await res.json();
        const page1: Conversation[] = data.conversations || [];
        // Merge-by-id: a conversation bumped to the top by a new message
        // arrives in page 1 — its stale deep copy is dropped by the id
        // filter (no duplicates); deep-loaded items that slid out of page 1
        // survive via `beyond`, re-sorted by updated_at. The pagination
        // frontier is deliberately NOT touched here: load-more continues
        // from where it was, and its own dedupe absorbs any overlap.
        if (!deepLoadedRef.current) {
          // Not paginated yet: page 1 IS the list (pre-pagination semantics).
          nextConvCursorRef.current =
            typeof data.next_cursor === 'string' ? data.next_cursor : null;
          setHasMoreConversations(Boolean(data.has_more));
          setConversations(page1);
        } else {
          setConversations(prev => {
            const pageIds = new Set(page1.map(c => c.id));
            const beyond = prev.filter(c => !pageIds.has(c.id));
            return [...page1, ...beyond].sort(
              (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
            );
          });
        }
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

  const loadMoreConversations = useCallback(async () => {
    if (!user || loadMoreInFlightRef.current) return;
    const cursor = nextConvCursorRef.current;
    if (!cursor) return;
    loadMoreInFlightRef.current = true;
    try {
      const res = await fetch(
        `/api/messages?limit=30&cursor=${encodeURIComponent(cursor)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      const older: Conversation[] = data.conversations || [];
      setConversations(prev => {
        const seen = new Set(prev.map(c => c.id));
        // Skip anything already loaded (a poll may have pulled a bumped
        // conversation forward) — dedupe absorbs the fuzzy cursor.
        return [...prev, ...older.filter(c => !seen.has(c.id))];
      });
      nextConvCursorRef.current =
        typeof data.next_cursor === 'string' ? data.next_cursor : null;
      setHasMoreConversations(Boolean(data.has_more));
      deepLoadedRef.current = true;
    } catch (e) {
      console.error('Failed to load more conversations:', e);
    } finally {
      loadMoreInFlightRef.current = false;
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
      setHasMoreConversations(false);
      nextConvCursorRef.current = null;
      deepLoadedRef.current = false;
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
        hasMoreConversations,
        loadMoreConversations,
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
