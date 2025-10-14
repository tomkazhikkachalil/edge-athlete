'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

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
  actor?: NotificationActor;
}

interface NotificationsContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  fetchNotifications: (options?: { unreadOnly?: boolean; type?: string; reset?: boolean }) => Promise<void>;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  clearAll: () => Promise<void>;
  refreshUnreadCount: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

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
      }
    } catch (err) {
      console.error('[NOTIFICATIONS] Error fetching unread count:', err);
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
        // Don't throw for other errors, just log and return
        console.warn('[NOTIFICATIONS] Failed to fetch notifications:', response.status);
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

    } catch (err) {
      // Only log unexpected errors (network failures, etc.)
      console.warn('[NOTIFICATIONS] Unexpected error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [user, nextCursor]);

  // Mark notification as read
  const markAsRead = useCallback(async (notificationId: string) => {
    if (!user) return;

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
        console.warn('[NOTIFICATIONS] Failed to mark as read:', response.status);
        return;
      }

      // Update local state
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)
      );

      // Decrease unread count
      setUnreadCount(prev => Math.max(0, prev - 1));

    } catch (err) {
      console.warn('[NOTIFICATIONS] Unexpected error marking as read:', err);
    }
  }, [user]);

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    if (!user) return;

    try {
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'PATCH'
      });

      // Silently handle auth errors
      if (response.status === 401 || response.status === 403) {
        return;
      }

      if (!response.ok) {
        console.warn('[NOTIFICATIONS] Failed to mark all as read:', response.status);
        return;
      }

      // Update local state
      setNotifications(prev =>
        prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
      );

      setUnreadCount(0);

    } catch (err) {
      console.warn('[NOTIFICATIONS] Unexpected error marking all as read:', err);
    }
  }, [user]);

  // Delete notification
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
        console.warn('[NOTIFICATIONS] Failed to delete notification:', response.status);
        return;
      }

      // Update local state
      const notification = notifications.find(n => n.id === notificationId);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));

      // Decrease unread count if notification was unread
      if (notification && !notification.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }

    } catch (err) {
      console.warn('[NOTIFICATIONS] Unexpected error deleting notification:', err);
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
        console.warn('[NOTIFICATIONS] Failed to clear all:', response.status);
        return;
      }

      setNotifications([]);
      setUnreadCount(0);
      setHasMore(false);
      setNextCursor(null);

    } catch (err) {
      console.warn('[NOTIFICATIONS] Unexpected error clearing all:', err);
    }
  }, [user]);

  // Initial fetch on mount and cleanup on logout
  useEffect(() => {
    if (user) {
      fetchNotifications({ reset: true });
      refreshUnreadCount();
    } else {
      // Clear notifications when user logs out
      setNotifications([]);
      setUnreadCount(0);
      setHasMore(false);
      setNextCursor(null);
      setError(null);
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set up real-time subscription for new notifications
  useEffect(() => {
    if (!user) return;


    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`
      }, (payload: any) => {

        // Add new notification to the beginning of the list
        setNotifications(prev => [payload.new as Notification, ...prev]);

        // Increase unread count
        setUnreadCount(prev => prev + 1);

        // Optional: Play notification sound
        // playNotificationSound();

        // Optional: Show browser notification
        if (Notification.permission === 'granted') {
          const notification = payload.new as Notification;
          new Notification(notification.title, {
            body: notification.message || '',
            icon: '/icon-192x192.png'
          });
        }
      })
      .subscribe();

    // Request notification permission
    if (typeof window !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => {
      channel.unsubscribe();
    };
  }, [user]);

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        error,
        hasMore,
        fetchNotifications,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        clearAll,
        refreshUnreadCount
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
