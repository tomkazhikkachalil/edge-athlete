'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { formatDisplayName } from '@/lib/formatters';
import { decidedText } from '@/lib/notification-actions';
import { celebratePR } from '@/lib/celebrate';
import { celebrationFor } from '@/lib/play/celebration';
import { useToast } from '@/components/Toast';

export interface NotificationActor {
  id: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  full_name?: string;
  avatar_url?: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message?: string;
  action_url?: string;
  is_read: boolean;
  read_at?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
  post_id?: string;
  comment_id?: string;
  follow_id?: string;
  actor_id?: string;
  actor?: NotificationActor;
  action_status?: 'pending' | 'accepted' | 'declined';
}

/**
 * Build notification display text from the current actor profile data.
 * This avoids showing stale names from the frozen notification.title field.
 * Falls back to notification.title for unknown types or missing actor.
 */
export function getNotificationText(notification: Notification): string {
  const actorName = notification.actor
    ? formatDisplayName(notification.actor.first_name, null, notification.actor.last_name, notification.actor.full_name)
    : 'Someone';

  switch (notification.type) {
    case 'follow_request':
      if (notification.action_status === 'accepted') {
        return `You accepted ${actorName}'s fan request`;
      } else if (notification.action_status === 'declined') {
        return `You declined ${actorName}'s fan request`;
      }
      return `${actorName} wants to become your fan`;
    case 'follow_accepted':
      return `${actorName} accepted your fan request`;
    case 'new_follower':
      return `${actorName} is now your fan`;
    case 'like':
      // Comment likes are created with type 'like' + comment_id set
      return notification.comment_id
        ? `${actorName} liked your comment`
        : `${actorName} liked your post`;
    case 'comment':
      return `${actorName} commented on your post`;
    case 'mention':
      return `${actorName} mentioned you`;
    case 'system':
      return notification.message || 'System notification';
    case 'league_join':
      return `${actorName} joined your league`;
    case 'sport_event_invite':
    case 'sport_event_request':
      // Events program: a decided bell says what you did; pending keeps the stored line.
      return decidedText(notification, actorName) ?? notification.title;
    default:
      return notification.title;
  }
}

interface NotificationsContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  fetchNotifications: (options?: { unreadOnly?: boolean; type?: string; reset?: boolean }) => Promise<void>;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  clearAll: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
  /** Events program: the action row decided a bell — reflect it locally. */
  applyActionStatus: (notificationId: string, status: 'accepted' | 'declined') => void;
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { showSuccess } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // Live mirror of `notifications` — realtime handlers need the current list
  // (e.g. to detect an unread→read transition) without stale closures.
  const notificationsRef = useRef<Notification[]>([]);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  // Realtime channel reconnect timer — cleared on unmount so an orphaned
  // timeout can't resubscribe a removed channel.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest fetchNotifications for the realtime effect — its identity changes
  // with the pagination cursor, and depending on it directly would tear down
  // and resubscribe the channel on every page load.
  const fetchNotificationsRef = useRef<((options?: { unreadOnly?: boolean; type?: string; reset?: boolean }) => Promise<void>) | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');

  // Fetch unread count
  const refreshUnreadCount = useCallback(async () => {
    if (!user) return;

    try {
      const response = await fetch('/api/notifications/unread-count');

      // Silently handle auth errors
      if (response.status === 401) {
        return;
      }

      if (response.ok) {
        const data = await response.json();
        setUnreadCount(data.count);
      } else {
        console.error('Failed to refresh notifications unread count — status:', response.status);
      }
    } catch (e) {
      // Background poll: an abort or network blip (TypeError — offline,
      // dev-server restart) is self-healing; only real failures stay loud.
      if (e instanceof Error && e.name === 'AbortError') return;
      if (e instanceof TypeError) return;
      console.error('Failed to refresh notifications unread count:', e);
    }
  }, [user]);

  // Fetch notifications
  const fetchNotifications = useCallback(async (options?: {
    unreadOnly?: boolean;
    type?: string;
    reset?: boolean;
  }) => {
    if (!user) return;

    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (options?.unreadOnly) params.append('unread_only', 'true');
      if (options?.type) params.append('type', options.type);
      if (!options?.reset && nextCursor) params.append('cursor', nextCursor);

      const response = await fetch(`/api/notifications?${params}`);

      // Silently handle all auth and permission errors (expected when not logged in or account deleted)
      if (response.status === 401 || response.status === 403) {
        setLoading(false);
        return;
      }

      if (!response.ok) {
        console.error('Failed to fetch notifications — status:', response.status);
        setLoading(false);
        return;
      }

      const data = await response.json();

      if (options?.reset) {
        setNotifications(data.notifications);
      } else {
        setNotifications(prev => [...prev, ...data.notifications]);
      }

      setUnreadCount(data.unread_count);
      setHasMore(data.has_more);
      setNextCursor(data.next_cursor);

    } catch (e) {
      // Same background-refresh rule: quiet on abort/network blips.
      if (!(e instanceof TypeError) && !(e instanceof Error && e.name === 'AbortError')) {
        console.error('Failed to fetch notifications:', e);
      }
    } finally {
      setLoading(false);
    }
  }, [user, nextCursor]);

  useEffect(() => {
    fetchNotificationsRef.current = fetchNotifications;
  }, [fetchNotifications]);

  // Mark notification as read (with optimistic update)
  const markAsRead = useCallback(async (notificationId: string) => {
    if (!user) return;

    // Check if already read
    const notification = notifications.find(n => n.id === notificationId);
    if (!notification || notification.is_read) return;

    // OPTIMISTIC UPDATE: Update UI immediately
    setNotifications(prev =>
      prev.map(n => n.id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)
    );
    setUnreadCount(prev => Math.max(0, prev - 1));

    // Then sync with server in background
    try {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_read: true })
      });

      // Silently handle auth errors
      if (response.status === 401 || response.status === 403) {
        return;
      }

      if (!response.ok) {
        console.error('Failed to mark notification read — status:', response.status);
        // Rollback optimistic update on error
        setNotifications(prev =>
          prev.map(n => n.id === notificationId ? { ...n, is_read: false, read_at: undefined } : n)
        );
        setUnreadCount(prev => prev + 1);
      }

    } catch (e) {
      console.error('Failed to mark notification read:', e);
      // Rollback optimistic update on error
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: false, read_at: undefined } : n)
      );
      setUnreadCount(prev => prev + 1);
    }
  }, [user, notifications]);

  // Mark all notifications as read (with optimistic update)
  const markAllAsRead = useCallback(async () => {
    if (!user) return;

    // Save previous state for rollback
    const previousNotifications = [...notifications];

    // OPTIMISTIC UPDATE: Update UI immediately
    setNotifications(prev =>
      prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
    );
    setUnreadCount(0);

    // Then sync with server in background
    try {
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'PATCH'
      });

      // Silently handle auth errors
      if (response.status === 401 || response.status === 403) {
        return;
      }

      if (!response.ok) {
        console.error('Failed to mark all notifications read — status:', response.status);
        // Rollback optimistic update on error. Restore the list, but resync
        // the badge from the server — the snapshot count could clobber a
        // realtime increment that arrived mid-flight.
        setNotifications(previousNotifications);
        fetchNotifications({ reset: true });
      }

    } catch (e) {
      console.error('Failed to mark all notifications read:', e);
      // Rollback optimistic update on error (badge resynced from the server —
      // the snapshot count could clobber a realtime increment that arrived
      // mid-flight)
      setNotifications(previousNotifications);
      fetchNotifications({ reset: true });
    }
  }, [user, notifications, fetchNotifications]);

  // Delete notification
  const applyActionStatus = useCallback((notificationId: string, status: 'accepted' | 'declined') => {
    setNotifications(prev => prev.map(n => (n.id === notificationId ? { ...n, action_status: status, is_read: true } : n)));
  }, []);

  const deleteNotification = useCallback(async (notificationId: string) => {
    if (!user) return;

    try {
      const response = await fetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE'
      });

      // Silently handle auth errors
      if (response.status === 401 || response.status === 403) {
        return;
      }

      if (!response.ok) {
        console.error('Failed to delete notification — status:', response.status);
        return;
      }

      // Update local state
      const notification = notifications.find(n => n.id === notificationId);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));

      // Decrease unread count if notification was unread
      if (notification && !notification.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }

    } catch (e) {
      console.error('Failed to delete notification:', e);
    }
  }, [user, notifications]);

  // Clear all notifications
  const clearAll = useCallback(async () => {
    if (!user) return;

    try {
      const response = await fetch('/api/notifications?action=clear-all', {
        method: 'DELETE'
      });

      // Silently handle auth errors
      if (response.status === 401 || response.status === 403) {
        return;
      }

      if (!response.ok) {
        console.error('Failed to clear notifications — status:', response.status);
        return;
      }

      setNotifications([]);
      setUnreadCount(0);
      setHasMore(false);
      setNextCursor(null);

    } catch (e) {
      console.error('Failed to clear notifications:', e);
    }
  }, [user]);

  // Whether the list has been fetched since this user's channel was set up —
  // the ONE initial read (speed round, Oct 2026: it used to be two, one on
  // mount and one when the realtime channel went live).
  const initialFetchedRef = useRef(false);

  // Initial fetch on mount and cleanup on logout
  useEffect(() => {
    if (user) {
      // ONE request: the read waits for the realtime channel to go live
      // (the SUBSCRIBED handler below), so no row can fall into the gap
      // between the read and the subscription — the reason a second read
      // used to follow. If the channel is slow or fails, this fallback reads
      // anyway after 2.5 s (and SUBSCRIBED, if it comes later, reads again to
      // close that gap). fetchNotifications' response carries unread_count.
      initialFetchedRef.current = false;
      const fallback = setTimeout(() => {
        if (initialFetchedRef.current) return;
        initialFetchedRef.current = true;
        void fetchNotifications({ reset: true });
      }, 2500);
      return () => clearTimeout(fallback);
    } else {
      // Clear notifications when user logs out
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the sign-out reset is the effect's job (the per-user state is owned here)
      setNotifications([]);
      setUnreadCount(0);
      setHasMore(false);
      setNextCursor(null);
      setError(null);
      setConnectionStatus('connecting');
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set up real-time subscription for new and updated notifications.
  // Connection state is effect-owned by definition — this effect owns the
  // channel's whole lifecycle.
  useEffect(() => {
    if (!user) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConnectionStatus('connecting');

    const channel = supabase
      .channel('notifications')
      // Listen for new notifications
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`
      }, async (payload: RealtimePostgresChangesPayload<Notification>) => {

        // Raw realtime rows carry actor_id but not the joined actor profile —
        // without it every live notification renders as "Someone ...".
        // Fetch the actor before inserting (best effort).
        let incoming = payload.new as Notification;
        if (incoming.actor_id && !incoming.actor) {
          const { data: actor } = await supabase
            .from('profiles')
            .select('id, first_name, last_name, full_name, avatar_url')
            .eq('id', incoming.actor_id)
            .maybeSingle();
          if (actor) incoming = { ...incoming, actor: actor as NotificationActor };
        }

        // Add new notification to the beginning of the list (skip if already
        // present, e.g. delivered while a refetch was in flight)
        setNotifications(prev =>
          prev.some(n => n.id === incoming.id) ? prev : [incoming, ...prev]
        );

        // Increase unread count
        setUnreadCount(prev => prev + 1);

        // Play (244): a badge earned while in the app — confetti + a toast.
        const party = celebrationFor(incoming);
        if (party) {
          if (party.confetti) void celebratePR();
          showSuccess(party.title, party.message ?? undefined);
        }

        // Optional: Play notification sound
        // playNotificationSound();

        // No in-tab `new Notification(...)` here any more (Oct 2026, mig
        // 248): the phone-notification service worker is the ONE place a
        // system notification comes from (src/lib/push/), turned on by the
        // person from a tap. Showing one here as well would double every
        // alert on a device that has it on.
      })
      // Listen for notification updates (e.g., action_status changes)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`
      }, (payload: RealtimePostgresChangesPayload<Notification>) => {

        // Update the notification in the list. MERGE rather than replace —
        // the raw realtime row has no joined `actor`, and replacing wholesale
        // would wipe the name/avatar fetched earlier. Also keep the unread
        // badge in sync when a notification transitions unread → read
        // (e.g. marked read on the notifications page or in another tab).
        const updatedNotification = payload.new as Notification;
        if (updatedNotification?.id) {
          const existing = notificationsRef.current.find(n => n.id === updatedNotification.id);
          if (existing && !existing.is_read && updatedNotification.is_read) {
            setUnreadCount(prev => Math.max(0, prev - 1));
          }
          setNotifications(prev =>
            prev.map(n =>
              n.id === updatedNotification.id
                ? { ...n, ...updatedNotification, actor: n.actor ?? updatedNotification.actor }
                : n
            )
          );
        }
      })
      .subscribe((status: string) => {
        // Track connection status
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          // The initial read happens HERE, once the channel is live — no row
          // can be missed between the read and the subscription. (After a
          // reconnect, the same read closes the reconnect's gap.)
          initialFetchedRef.current = true;
          fetchNotificationsRef.current?.({ reset: true });
        } else if (status === 'CHANNEL_ERROR') {
          setConnectionStatus('disconnected');
          // Auto-reconnect after 3 seconds (tracked so unmount cancels it —
          // an orphaned timer could resubscribe a removed channel)
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            channel.subscribe();
          }, 3000);
        } else if (status === 'TIMED_OUT') {
          setConnectionStatus('disconnected');
        }
      });

    // The system permission is asked for ONLY from a tap now (Settings →
    // Notifications → Phone notifications, or the feed's card) — iOS ignores
    // a prompt no tap started, and Chrome quiets sites that prompt on load.

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      channel.unsubscribe();
      setConnectionStatus('connecting');
    };
  }, [user, showSuccess]); // showSuccess is stable (useCallback [])

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        error,
        hasMore,
        connectionStatus,
        fetchNotifications,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        clearAll,
        refreshUnreadCount,
        applyActionStatus
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationsProvider');
  }
  return context;
}
