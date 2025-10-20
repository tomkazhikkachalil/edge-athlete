'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import LazyImage from '@/components/LazyImage';
import { ToastContainer, useToast } from '@/components/Toast';

interface Notification {
  id: string;
  type: 'follow_request' | 'follow_accepted' | 'like' | 'comment' | 'mention' | 'system';
  message?: string;
  read: boolean;
  read_at?: string;
  created_at: string;
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

interface FollowRequest {
  id: string;
  message?: string;
  created_at: string;
  follower: {
    id: string;
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    full_name?: string;
    avatar_url?: string;
    handle?: string;
  };
}

export default function NotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [followRequests, setFollowRequests] = useState<FollowRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const { toasts, dismissToast, showSuccess, showError } = useToast();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      loadNotifications();
      loadFollowRequests();
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
    } catch (error) {
      console.error('Error loading notifications:', error);
      showError('Error', 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  };

  const loadFollowRequests = async () => {
    try {
      const response = await fetch('/api/followers?type=requests');
      if (!response.ok) throw new Error('Failed to load follow requests');

      const data = await response.json();
      setFollowRequests(data.requests || []);
    } catch (error) {
      console.error('Error loading follow requests:', error);
    }
  };

  const markAsRead = async (notificationIds: string[]) => {
    try {
      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds })
      });

      setNotifications(prev =>
        prev.map(n => notificationIds.includes(n.id) ? { ...n, read: true } : n)
      );
    } catch (error) {
      console.error('Error marking notifications as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllAsRead: true })
      });

      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      showSuccess('Success', 'All notifications marked as read');
    } catch (error) {
      console.error('Error marking all as read:', error);
      showError('Error', 'Failed to mark notifications as read');
    }
  };

  const handleAcceptRequest = async (followId: string) => {
    try {
      const response = await fetch('/api/followers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', followId })
      });

      if (!response.ok) throw new Error('Failed to accept request');

      setFollowRequests(prev => prev.filter(r => r.id !== followId));
      showSuccess('Success', 'Follow request accepted');
      loadNotifications(); // Reload notifications to update counts
    } catch (error) {
      console.error('Error accepting request:', error);
      showError('Error', 'Failed to accept request');
    }
  };

  const handleRejectRequest = async (followId: string) => {
    try {
      const response = await fetch('/api/followers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', followId })
      });

      if (!response.ok) throw new Error('Failed to reject request');

      setFollowRequests(prev => prev.filter(r => r.id !== followId));
      showSuccess('Success', 'Follow request declined');
    } catch (error) {
      console.error('Error rejecting request:', error);
      showError('Error', 'Failed to decline request');
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      markAsRead([notification.id]);
    }

    if (notification.type === 'follow_request') {
      // Don't navigate - handled in Follow Requests section above
      return;
    } else if (notification.type === 'like' || notification.type === 'comment') {
      if (notification.related_post) {
        router.push(`/feed?post=${notification.related_post.id}`);
      }
    } else if (notification.type === 'follow_accepted' && notification.actor) {
      // Navigate to own profile if clicking own profile
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
        return `${actorName} sent you a follow request`;
      case 'follow_accepted':
        return `${actorName} accepted your follow request`;
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
            {notifications.some(n => !n.read) && (
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
              onClick={() => setFilter('all')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                filter === 'all'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                filter === 'unread'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Unread
            </button>
          </div>
        </div>
      </div>

      {/* Follow Requests Section */}
      {followRequests.length > 0 && (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Follow Requests</h2>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-200">
            {followRequests.map((request) => (
              <div key={request.id} className="p-4 flex items-center justify-between gap-4">
                {/* User Avatar & Name */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <LazyImage
                    src={request.follower.avatar_url || ''}
                    alt={formatDisplayName(
                      request.follower.first_name,
                      null,
                      request.follower.last_name,
                      request.follower.full_name
                    )}
                    width={48}
                    height={48}
                    className="rounded-full"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">
                      {formatDisplayName(
                        request.follower.first_name,
                        null,
                        request.follower.last_name,
                        request.follower.full_name
                      )}
                    </p>
                    {request.follower.handle && (
                      <p className="text-sm text-gray-500">@{request.follower.handle}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
                      {formatDistanceToNow(new Date(request.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>

                {/* Accept/Decline Buttons */}
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleAcceptRequest(request.id)}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleRejectRequest(request.id)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-300 transition-colors"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notifications List */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading && page === 0 ? (
          <div className="text-center py-12">
            <i className="fas fa-spinner fa-spin text-3xl text-gray-400 mb-3"></i>
            <p className="text-gray-600">Loading notifications...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <i className="fas fa-bell-slash text-6xl text-gray-300 mb-4"></i>
            <h3 className="text-xl font-bold text-gray-900 mb-2">No notifications</h3>
            <p className="text-gray-600">
              {filter === 'unread'
                ? "You're all caught up! No unread notifications."
                : "You don't have any notifications yet."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map(notification => (
              <button
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={`w-full bg-white rounded-lg border hover:shadow-md transition-all text-left ${
                  !notification.read ? 'border-blue-200 bg-blue-50' : 'border-gray-200'
                }`}
              >
                <div className="p-4 flex gap-4">
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
                    <p className="text-sm text-gray-900 font-medium">
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
                      {!notification.read && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          New
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Chevron */}
                  <div className="flex items-center">
                    <i className="fas fa-chevron-right text-gray-400"></i>
                  </div>
                </div>
              </button>
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
