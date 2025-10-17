/**
 * Real-time Notifications Hook
 *
 * Subscribes to notification events in real-time using Supabase Realtime.
 * Automatically updates the notification count and displays toast notifications.
 */

import { useEffect, useState } from 'react';
import { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase';

export interface Notification {
  id: string;
  profile_id: string;
  type: 'like' | 'comment' | 'follow' | 'mention';
  actor_id: string;
  target_id: string;
  message: string;
  read: boolean;
  created_at: string;
  actor?: {
    id: string;
    full_name: string | null;
    first_name: string | null;
    middle_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  };
}

export function useRealtimeNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Load initial notifications
  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    loadNotifications();

    async function loadNotifications() {
      const supabase = getSupabaseBrowserClient();

      const { data, error } = await supabase
        .from('notifications')
        .select(`
          id,
          profile_id,
          type,
          actor_id,
          target_id,
          message,
          read,
          created_at,
          actor:actor_id (
            id,
            full_name,
            first_name,
            middle_name,
            last_name,
            avatar_url
          )
        `)
        .eq('profile_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        setNotifications(data as Notification[]);
        setUnreadCount(data.filter((n) => !n.read).length);
      }

      setLoading(false);
    }
  }, [userId]);

  // Real-time subscription for new notifications
  useEffect(() => {
    if (!userId) return;

    const supabase = getSupabaseBrowserClient();

    console.log('[REALTIME] Setting up notifications subscription for user:', userId);

    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `profile_id=eq.${userId}`
        },
        async (payload: RealtimePostgresChangesPayload<Notification>) => {
          console.log('[REALTIME] New notification:', payload.new);

          // Fetch complete notification with actor details
          const { data: newNotification } = await supabase
            .from('notifications')
            .select(`
              id,
              profile_id,
              type,
              actor_id,
              target_id,
              message,
              read,
              created_at,
              actor:actor_id (
                id,
                full_name,
                first_name,
                middle_name,
                last_name,
                avatar_url
              )
            `)
            .eq('id', payload.new.id)
            .single();

          if (newNotification) {
            setNotifications((prev) => [newNotification as Notification, ...prev]);
            setUnreadCount((prev) => prev + 1);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `profile_id=eq.${userId}`
        },
        (payload: RealtimePostgresChangesPayload<Notification>) => {
          console.log('[REALTIME] Notification updated:', payload.new);

          setNotifications((prev) =>
            prev.map((n) =>
              n.id === payload.new.id ? { ...n, read: payload.new.read } : n
            )
          );

          if (payload.new.read) {
            setUnreadCount((prev) => Math.max(0, prev - 1));
          }
        }
      )
      .subscribe();

    return () => {
      console.log('[REALTIME] Cleaning up notifications subscription');
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const markAsRead = async (notificationId: string) => {
    const supabase = getSupabaseBrowserClient();

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId);

    if (!error) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
  };

  const markAllAsRead = async () => {
    if (!userId) return;

    const supabase = getSupabaseBrowserClient();

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('profile_id', userId)
      .eq('read', false);

    if (!error) {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    }
  };

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead
  };
}
