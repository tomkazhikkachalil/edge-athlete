'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/lib/auth';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import LazyImage from './LazyImage';

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

export default function NotificationsDropdown() {
  const router = useRouter();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadNotifications();

    // Poll for new notifications every 30 seconds
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const loadNotifications = async () => {
    try {
      const response = await fetch('/api/notifications?limit=10');
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {
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
      setUnreadCount(prev => Math.max(0, prev - notificationIds.length));
    } catch {
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
      setUnreadCount(0);
    } catch {
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    // Mark as read
    if (!notification.read) {
      markAsRead([notification.id]);
    }

    // Navigate based on notification type
    if (notification.type === 'follow_request') {
      router.push('/app/followers?tab=requests');
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

    setIsOpen(false);
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

  const getNotificationText = (notification: Notification) => {
    const actorName = notification.actor
      ? formatDisplayName(notification.actor.first_name, null, notification.actor.last_name, notification.actor.full_name)
      : 'Someone';

    switch (notification.type) {
      case 'follow_request':
        return `${actorName} wants to become your fan`;
      case 'follow_accepted':
        return `${actorName} accepted your fan request`;
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

  return (
    <div ref={dropdownRef} className="relative">
      {/* Notification Bell */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <i className="fas fa-bell text-xl"></i>
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-[500px] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-8 text-center text-gray-500">
                <i className="fas fa-spinner fa-spin text-2xl mb-2"></i>
                <p>Loading notifications...</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <i className="fas fa-bell-slash text-4xl mb-3 text-gray-300"></i>
                <p className="font-medium">No notifications</p>
                <p className="text-sm mt-1">You&apos;re all caught up!</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {notifications.map(notification => (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full p-4 hover:bg-gray-50 transition-colors text-left ${
                      !notification.read ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex gap-3">
                      {/* Actor Avatar or Icon */}
                      {notification.actor?.avatar_url ? (
                        <LazyImage
                          src={notification.actor.avatar_url}
                          alt={formatDisplayName(notification.actor.first_name, null, notification.actor.last_name, notification.actor.full_name)}
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                          width={40}
                          height={40}
                        />
                      ) : notification.actor ? (
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-sm font-semibold">
                            {getInitials(formatDisplayName(notification.actor.first_name, null, notification.actor.last_name, notification.actor.full_name))}
                          </span>
                        </div>
                      ) : (
                        <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
                          <i className={`fas ${getNotificationIcon(notification.type)} text-gray-600`}></i>
                        </div>
                      )}

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900">
                          {getNotificationText(notification)}
                        </p>
                        {notification.related_follow?.message && (
                          <p className="text-sm text-gray-600 mt-1 italic">
                            &quot;{notification.related_follow.message}&quot;
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-1">
                          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                        </p>
                      </div>

                      {/* Unread Indicator */}
                      {!notification.read && (
                        <div className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0 mt-2"></div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="p-3 border-t border-gray-200 text-center">
              <button
                onClick={() => {
                  router.push('/app/notifications');
                  setIsOpen(false);
                }}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                View all notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
