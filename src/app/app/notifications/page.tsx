'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import LazyImage from '@/components/LazyImage';
import { ToastContainer, useToast } from '@/components/Toast';

interface Notification {
  id: string;
  type: 'follow_request' | 'follow_accepted' | 'like' | 'comment' | 'mention' | 'system' | 'new_follower';
  message?: string;
  is_read: boolean;
  read_at?: string;
  created_at: string;
  action_status?: 'pending' | 'accepted' | 'declined';
  action_taken_at?: string;
  follow_id?: string;
  actor?: {
    id: string;
    full_name?: string;
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    avatar_url?: string;
  };
  related_post?: {
    id: string;
    caption?: string;
  };
  related_comment?: {
    id: string;
    content?: string;
  };
  related_follow?: {
    id: string;
    status: string;
    message?: string;
  };
}

export default function NotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('unread'); // Default to unread
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [actioningNotificationId, setActioningNotificationId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const { toasts, dismissToast, showSuccess, showError } = useToast();
  const notificationRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const visibilityTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Callback ref to track notification elements
  const setNotificationRef = useCallback((notificationId: string, element: HTMLDivElement | null) => {
    if (element) {
      notificationRefs.current.set(notificationId, element);
    } else {
      notificationRefs.current.delete(notificationId);
    }
  }, []);

  // Set up Intersection Observer to auto-mark notifications as read
  useEffect(() => {
    if (typeof window === 'undefined' || !user) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const notificationId = entry.target.getAttribute('data-notification-id');
          const isRead = entry.target.getAttribute('data-is-read') === 'true';

          if (!notificationId) return;

          if (entry.isIntersecting && !isRead) {
            // Start a timer to mark as read after 2 seconds of visibility
            if (!visibilityTimers.current.has(notificationId)) {
              const timer = setTimeout(() => {
                markAsRead([notificationId]);
                visibilityTimers.current.delete(notificationId);
              }, 2000);
              visibilityTimers.current.set(notificationId, timer);
            }
          } else {
            // Clear timer if notification leaves viewport before 2 seconds
            const timer = visibilityTimers.current.get(notificationId);
            if (timer) {
              clearTimeout(timer);
              visibilityTimers.current.delete(notificationId);
            }
          }
        });
      },
      {
        threshold: 0.5, // At least 50% visible
        rootMargin: '0px'
      }
    );

    // Observe all notification elements
    notificationRefs.current.forEach((element) => {
      observer.observe(element);
    });

    return () => {
      observer.disconnect();
      // Clear all timers
      visibilityTimers.current.forEach((timer) => clearTimeout(timer));
      visibilityTimers.current.clear();
    };
  }, [notifications, user]); // Re-run when notifications change

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      loadNotifications();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, filter]);

  const loadNotifications = async (loadMore = false) => {
    try {
      setLoading(true);
      const currentPage = loadMore ? page + 1 : 0;
      const offset = currentPage * 20;

      const url = `/api/notifications?limit=20&offset=${offset}${filter === 'unread' ? '&unreadOnly=true' : ''}`;
      const response = await fetch(url);

      if (!response.ok) throw new Error('Failed to load notifications');

      const data = await response.json();
      const newNotifications = data.notifications || [];

      if (loadMore) {
        setNotifications(prev => [...prev, ...newNotifications]);
        setPage(currentPage);
      } else {
        setNotifications(newNotifications);
        setPage(0);
      }

      setHasMore(newNotifications.length === 20);

      // Update counts from API response
      setUnreadCount(data.unread_count || 0);

      // Calculate total count (only when on 'all' tab, otherwise use notifications length)
      if (filter === 'all') {
        setTotalCount(newNotifications.length >= 20 ? newNotifications.length : newNotifications.length);
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
      showError('Error', 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  };


  const markAsRead = async (notificationIds: string[]) => {
    try {
      // Mark individual notifications using correct endpoint
      await Promise.all(
        notificationIds.map(id =>
          fetch(`/api/notifications/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_read: true })
          })
        )
      );

      setNotifications(prev =>
        prev.map(n => notificationIds.includes(n.id) ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)
      );

      // Decrease unread count
      setUnreadCount(prev => Math.max(0, prev - notificationIds.length));
    } catch (error) {
      console.error('Error marking notifications as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch('/api/notifications/mark-all-read', {
        method: 'PATCH'
      });

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() })));
      setUnreadCount(0); // Reset unread count to 0
      showSuccess('Success', 'All notifications marked as read');
    } catch (error) {
      console.error('Error marking all as read:', error);
      showError('Error', 'Failed to mark notifications as read');
    }
  };

  const handleNotificationAction = async (notificationId: string, action: 'accept' | 'decline') => {
    try {
      setActioningNotificationId(notificationId);

      const response = await fetch(`/api/notifications/${notificationId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to process action');
      }

      const data = await response.json();

      // Update notification in local state
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? {
          ...n,
          action_status: data.action_status,
          action_taken_at: new Date().toISOString()
        } : n)
      );

      showSuccess(
        'Success',
        action === 'accept' ? 'Follow request accepted' : 'Follow request declined'
      );
    } catch (error) {
      console.error('Error processing notification action:', error);
      showError('Error', error instanceof Error ? error.message : 'Failed to process request');
    } finally {
      setActioningNotificationId(null);
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      markAsRead([notification.id]);
    }

    // Don't navigate if it's a pending follow request (user should use action buttons)
    if (notification.type === 'follow_request' && notification.action_status === 'pending') {
      return;
    }

    // Navigate based on notification type
    if (notification.type === 'like' || notification.type === 'comment') {
      if (notification.related_post) {
        router.push(`/feed?post=${notification.related_post.id}`);
      }
    } else if ((notification.type === 'follow_accepted' || notification.type === 'new_follower') && notification.actor) {
      // Navigate to actor's profile
      if (user?.id === notification.actor.id) {
        router.push('/athlete');
      } else {
        router.push(`/athlete/${notification.actor.id}`);
      }
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'follow_request': return 'fa-user-plus';
      case 'follow_accepted': return 'fa-check-circle';
      case 'like': return 'fa-heart';
      case 'comment': return 'fa-comment';
      case 'mention': return 'fa-at';
      default: return 'fa-bell';
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'follow_request': return 'text-blue-600';
      case 'follow_accepted': return 'text-green-600';
      case 'like': return 'text-red-600';
      case 'comment': return 'text-purple-600';
      case 'mention': return 'text-orange-600';
      default: return 'text-gray-600';
    }
  };

  const getNotificationText = (notification: Notification) => {
    const actorName = notification.actor
      ? formatDisplayName(notification.actor.first_name, null, notification.actor.last_name, notification.actor.full_name)
      : 'Someone';

    switch (notification.type) {
      case 'follow_request':
        if (notification.action_status === 'accepted') {
          return `You accepted ${actorName}'s follow request`;
        } else if (notification.action_status === 'declined') {
          return `You declined ${actorName}'s follow request`;
        }
        return `${actorName} sent you a follow request`;
      case 'follow_accepted':
        return `${actorName} accepted your follow request`;
      case 'new_follower':
        return `${actorName} started following you`;
      case 'like':
        return `${actorName} liked your post`;
      case 'comment':
        return `${actorName} commented on your post`;
      case 'mention':
        return `${actorName} mentioned you`;
      case 'system':
        return notification.message || 'System notification';
      default:
        return 'New notification';
    }
  };

  if (authLoading || !user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.back()}
                className="text-gray-600 hover:text-gray-900"
              >
                <i className="fas fa-arrow-left text-xl"></i>
              </button>
              <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
            </div>
            {notifications.some(n => !n.is_read) && (
              <button
                onClick={markAllAsRead}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-4 mt-4">
            <button
              onClick={() => setFilter('unread')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                filter === 'unread'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Unread {unreadCount > 0 && <span className="ml-1 text-xs">({unreadCount})</span>}
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                filter === 'all'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              All
            </button>
          </div>
        </div>
      </div>


      {/* Notifications List */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading && page === 0 ? (
          <div className="text-center py-12">
            <i className="fas fa-spinner fa-spin text-3xl text-gray-400 mb-3"></i>
            <p className="text-gray-600">Loading notifications...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <i className={`fas ${filter === 'unread' ? 'fa-check-circle' : 'fa-bell-slash'} text-6xl mb-4 ${
              filter === 'unread' ? 'text-green-400' : 'text-gray-300'
            }`}></i>
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              {filter === 'unread' ? "You're all caught up! 🎉" : "No notifications"}
            </h3>
            <p className="text-gray-600">
              {filter === 'unread'
                ? "No unread notifications. Great job staying on top of things!"
                : "You don't have any notifications yet."}
            </p>
            {filter === 'unread' && unreadCount === 0 && (
              <button
                onClick={() => setFilter('all')}
                className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                View all notifications
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map(notification => (
              <div
                key={notification.id}
                ref={(el) => setNotificationRef(notification.id, el)}
                data-notification-id={notification.id}
                data-is-read={notification.is_read}
                className={`w-full rounded-lg transition-all ${
                  !notification.is_read
                    ? 'border-2 border-blue-500 bg-blue-50 shadow-md'
                    : 'border border-gray-200 bg-white opacity-80'
                }`}
              >
                <button
                  onClick={() => handleNotificationClick(notification)}
                  className="w-full p-4 flex gap-4 text-left hover:bg-gray-50 transition-colors"
                  disabled={notification.type === 'follow_request' && notification.action_status === 'pending'}
                >
                  {/* Actor Avatar or Icon */}
                  {notification.actor?.avatar_url ? (
                    <LazyImage
                      src={notification.actor.avatar_url}
                      alt={formatDisplayName(notification.actor.first_name, null, notification.actor.last_name, notification.actor.full_name)}
                      className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                      width={48}
                      height={48}
                    />
                  ) : notification.actor ? (
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-sm font-semibold">
                        {getInitials(formatDisplayName(notification.actor.first_name, null, notification.actor.last_name, notification.actor.full_name))}
                      </span>
                    </div>
                  ) : (
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <i className={`fas ${getNotificationIcon(notification.type)} ${getNotificationColor(notification.type)}`}></i>
                    </div>
                  )}

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${
                      !notification.is_read
                        ? 'text-gray-900 font-semibold'
                        : 'text-gray-500 font-normal'
                    }`}>
                      {getNotificationText(notification)}
                    </p>
                    {notification.related_follow?.message && (
                      <p className="text-sm text-gray-600 mt-1 italic bg-gray-50 p-2 rounded">
                        &quot;{notification.related_follow.message}&quot;
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <p className="text-xs text-gray-500">
                        {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                      </p>
                      {!notification.is_read && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          New
                        </span>
                      )}
                      {/* Status badges for completed actions */}
                      {notification.action_status === 'accepted' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                          Accepted
                        </span>
                      )}
                      {notification.action_status === 'declined' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                          Declined
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Chevron (only for clickable notifications) */}
                  {!(notification.type === 'follow_request' && notification.action_status === 'pending') && (
                    <div className="flex items-center">
                      <i className="fas fa-chevron-right text-gray-400"></i>
                    </div>
                  )}
                </button>

                {/* Inline action buttons for pending follow requests */}
                {notification.type === 'follow_request' && notification.action_status === 'pending' && (
                  <div className="px-4 pb-4 flex gap-2">
                    <button
                      onClick={() => handleNotificationAction(notification.id, 'accept')}
                      disabled={actioningNotificationId === notification.id}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {actioningNotificationId === notification.id ? (
                        <>
                          <i className="fas fa-spinner fa-spin mr-2"></i>
                          Processing...
                        </>
                      ) : (
                        'Accept'
                      )}
                    </button>
                    <button
                      onClick={() => handleNotificationAction(notification.id, 'decline')}
                      disabled={actioningNotificationId === notification.id}
                      className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Decline
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Load More */}
        {hasMore && notifications.length > 0 && (
          <div className="mt-6 text-center">
            <button
              onClick={() => loadNotifications(true)}
              disabled={loading}
              className="px-6 py-2 bg-white border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Loading...
                </>
              ) : (
                'Load more'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
