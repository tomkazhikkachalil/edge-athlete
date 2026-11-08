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
import { useNotifications } from '@/lib/notifications';
import type { Conversation, Message } from '@/types/messages';
import { shouldPoll } from '@/lib/net/online';
import { adjustPulseUnread, fetchPulse, getPulse, resetPulse, subscribePulse } from '@/lib/pulse/pulse-store';
import { PULSE_STALE_MS } from '@/lib/pulse/pulse-rules';

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
  // Mounted inside NotificationsProvider (src/app/(app)/layout.tsx): a read
  // conversation clears its bells there too.
  const { absorbConversationRead, notifications } = useNotifications();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Live mirror of `conversations` for callbacks that consumers capture once
  // at mount (e.g. ChatWindow's realtime handler) — reading the state directly
  // there would see a stale snapshot and corrupt the unread total.
  const conversationsRef = useRef<Conversation[]>([]);
  // The unread total is the pulse's number (src/lib/pulse/, the cost
  // program PR B, Oct 29 2026): ONE fetch of /api/me/pulse carries it with
  // the Live dot's count, shared with the header through the store below.
  const [totalUnreadCount, setTotalUnreadCount] = useState(() => getPulse().unreadMessages);
  const [loading, setLoading] = useState(false);
  // Conversation-list pagination (migration 127): the server frontier is
  // updated ONLY by the initial load and loadMore — never by a page-one
  // refresh (a bell, a pulse signal, a return), which merges by id (see
  // fetchConversations).
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const nextConvCursorRef = useRef<string | null>(null);
  const loadMoreInFlightRef = useRef(false);
  // True once the user has actually paginated. Until then a page-1 refresh
  // REPLACES the list wholesale (the exact pre-pagination semantics — cross-
  // device deletions disappear on the next poll); after, it merges by id so
  // deep-loaded items survive.
  const deepLoadedRef = useRef(false);

  // One live signal for the list (scale fix 3, Oct 25 2026 — docs/SCALE_AUDIT.md
  // hole 3): the newest `new_message` bell seen, and the debounce timer that
  // turns a burst of bells into one refresh. See the effect below.
  const newestBellRef = useRef<{ at: number; ids: Set<string> } | null>(null);
  const signalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  const visibilityCleanupRef = useRef<(() => void) | null>(null);
  // Controller for the auto-fetches kicked off by the user-change effect.
  // Aborted on logout / effect cleanup so navigation races don't surface as scary console errors.
  const fetchAbortRef = useRef<AbortController | null>(null);

  // The count rides the pulse: one coalesced fetch of /api/me/pulse (the
  // store notifies the subscription below). A failure keeps the last number.
  // A pulse the header read in the last thirty seconds is reused (the
  // performance program's Phase 2d, Nov 2026): this provider and the header's
  // Live dot both asked on mount, and the second read went through because the
  // first had already landed — two pulse reads on every open, one too many.
  const refreshUnreadCount = useCallback(async () => {
    if (!user) return;
    if (Date.now() - getPulse().fetchedAt <= PULSE_STALE_MS) return;
    await fetchPulse();
  }, [user]);

  // The pulse's unread number is this provider's total.
  useEffect(() => {
    if (!user) return;
    return subscribePulse(s => setTotalUnreadCount(s.unreadMessages));
  }, [user]);

  // When page one was last refreshed — the count-moved path below skips a
  // refresh the bell just made (a message from someone else is one bell AND
  // one pulse signal; the list goes once).
  const lastListFetchRef = useRef(0);
  const fetchConversations = useCallback(async (signal?: AbortSignal) => {
    if (!user) return;
    lastListFetchRef.current = Date.now();
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
      // poll is not an error — data stands, the 2-minute cycle retries.
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

  // The pulse's private signal reaches the list through the COUNT (the cost
  // program PR C, Nov 6 2026): when a fetched answer's unread number differs
  // from the last fetched one, page one is refreshed (debounced with the
  // bell's timer). A local read corrects the count through adjustPulseUnread
  // without a fetch — fetchedAt does not move, so this never refires for it.
  const lastFetchedUnreadRef = useRef<{ at: number; unread: number } | null>(null);
  useEffect(() => {
    if (!user) {
      lastFetchedUnreadRef.current = null;
      return;
    }
    return subscribePulse(s => {
      const last = lastFetchedUnreadRef.current;
      if (s.fetchedAt === 0) return;
      if (!last) {
        lastFetchedUnreadRef.current = { at: s.fetchedAt, unread: s.unreadMessages };
        return;
      }
      if (s.fetchedAt === last.at) return; // a local correction, not an answer
      const moved = s.unreadMessages !== last.unread;
      lastFetchedUnreadRef.current = { at: s.fetchedAt, unread: s.unreadMessages };
      if (!moved) return;
      if (Date.now() - lastListFetchRef.current < 6_000) return; // the bell already refreshed the list
      if (signalTimerRef.current) clearTimeout(signalTimerRef.current);
      signalTimerRef.current = setTimeout(() => {
        signalTimerRef.current = null;
        if (!shouldPoll()) return;
        const c = new AbortController();
        fetchConversations(c.signal);
      }, 1_500);
    });
  }, [user, fetchConversations]);

  // ONE live signal for the list instead of one Realtime channel per listed
  // conversation (scale fix 3, Oct 25 2026): the send route writes a
  // `new_message` notification per recipient on every message, and that row
  // already reaches this tab on the per-user `notifications` channel
  // (src/lib/notifications.tsx — ONE channel, filtered to the user). A new
  // bell → page one + the count again, debounced so a burst is one
  // `get_conversation_list` RPC + one count. The OPEN thread keeps its own
  // `chat:` / `dockchat:` channel for the messages themselves. Before this an
  // active account held ~30 channels per page view (every listed
  // conversation), against Realtime caps that are per connection and per
  // project. Not live here, carried by the 2-minute poll + the resume
  // catch-up: a MUTED conversation (no bell is written) and your own sends
  // from another device (the sender gets no bell).
  useEffect(() => {
    if (!user) {
      newestBellRef.current = null;
      return;
    }
    const bells = notifications.filter(n => n.type === 'new_message');
    if (!newestBellRef.current) {
      // First observation: everything already loaded is history.
      newestBellRef.current = {
        at: Math.max(0, ...bells.map(b => Date.parse(b.created_at) || 0)),
        ids: new Set(bells.map(b => b.id)),
      };
      return;
    }
    const seen = newestBellRef.current;
    let fresh = false;
    for (const b of bells) {
      if (seen.ids.has(b.id)) continue;
      seen.ids.add(b.id);
      // Newer than anything seen = a live arrival; an OLDER page of the
      // notifications list loading is not a signal.
      const at = Date.parse(b.created_at) || 0;
      if (at > seen.at) {
        seen.at = at;
        fresh = true;
      }
    }
    if (!fresh) return;
    if (signalTimerRef.current) clearTimeout(signalTimerRef.current);
    signalTimerRef.current = setTimeout(() => {
      signalTimerRef.current = null;
      // A hidden tab waits: the visibilitychange catch-up refreshes on return.
      if (!shouldPoll()) return;
      const c = new AbortController();
      fetchConversations(c.signal);
      // The COUNT is not fetched here any more (Nov 6 2026, PR C's follow-up):
      // the same message reaches the tab as a pulse signal on the private
      // topic, and that one fetch carries the number. Fetching it here too
      // made every message from someone else two pulse calls on production
      // (the prod probe caught it: the two no longer coincided).
    }, 1_500);
  }, [notifications, user, fetchConversations]);

  // The debounce never outlives the provider.
  useEffect(() => () => {
    if (signalTimerRef.current) clearTimeout(signalTimerRef.current);
  }, []);

  // Initial load + setup
  useEffect(() => {
    if (user) {
      // Cancel any in-flight fetches from a prior render so they don't race with this one.
      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;

      // OUT OF SCOPE by decision: this provider coordinates an AbortController,
      // a 2-minute poll and the resume catch-up. A subtle mistake here is an outage,
      // not a glitch, so the loader stays a useCallback shared with them.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(true);
      Promise.all([
        fetchConversations(controller.signal),
        refreshUnreadCount(),
      ]).finally(() => {
        // If a newer effect run aborted us, don't stomp its loading state.
        if (!controller.signal.aborted) setLoading(false);
      });

      // No list poll any more (the cost program PR C, Nov 6 2026; migration
      // 301): the `new_message` bell carries a message from someone else to a
      // focused tab, the pulse's private signal carries the two cases the
      // bell never did (a muted conversation, a read on another device) —
      // the subscription below refreshes page one when a FETCHED count
      // moves — and the visibilitychange catch-up covers a return. The
      // pulse's own 10-minute net sits under a dropped socket. Before: a
      // 2-minute poll, one `get_conversation_list` RPC per tab per two
      // minutes on every page, all day.
      const onVisible = () => {
        if (!shouldPoll()) return;
        const c = new AbortController();
        fetchConversations(c.signal);
      };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', onVisible);
      visibilityCleanupRef.current = () => {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', onVisible);
      };
    } else {
      // Clear state on logout
      resetPulse();
      fetchAbortRef.current?.abort();
      fetchAbortRef.current = null;
      setConversations([]);
      setTotalUnreadCount(0);
      setLoading(false);
      setHasMoreConversations(false);
      nextConvCursorRef.current = null;
      deepLoadedRef.current = false;
      newestBellRef.current = null;
      if (signalTimerRef.current) {
        clearTimeout(signalTimerRef.current);
        signalTimerRef.current = null;
      }
      visibilityCleanupRef.current?.();
      visibilityCleanupRef.current = null;
    }

    return () => {
      fetchAbortRef.current?.abort();
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
      // The conversation's bells went read with it (the route); the bell's
      // count, the loaded rows and the phone's notification follow.
      const body = (await res.json().catch(() => ({}))) as { notifications_read?: unknown };
      absorbConversationRead(conversationId, typeof body.notifications_read === 'number' ? body.notifications_read : 0);
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
        adjustPulseUnread(-unread); // the store agrees, without a fetch
      }
    } catch (e) {
      console.error('Failed to mark conversation read:', e);
    }
  }, [absorbConversationRead]);

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
  }, []);

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
