'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications, getNotificationText } from '@/lib/notifications';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { AvatarImage } from '@/components/OptimizedImage';

export default function NotificationBell() {
  const router = useRouter();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [viewedNotifications, setViewedNotifications] = useState<Set<string>>(new Set());
  const notificationRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const visibilityTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Callback ref to track notification elements
  const setNotificationRef = useCallback((notificationId: string, element: HTMLDivElement | null) => {
    if (element) {
      notificationRefs.current.set(notificationId, element);
    } else {
      notificationRefs.current.delete(notificationId);
    }
  }, []);

  // Set up Intersection Observer to auto-mark notifications as "viewed" (local state only)
  useEffect(() => {
    if (!showDropdown || typeof window === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const notificationId = entry.target.getAttribute('data-notification-id');
          const isRead = entry.target.getAttribute('data-is-read') === 'true';

          if (!notificationId) return;

          if (entry.isIntersecting && !isRead) {
            // Start a 3-second timer to mark as "viewed" (local state only)
            if (!visibilityTimers.current.has(notificationId)) {
              const timer = setTimeout(() => {
                setViewedNotifications(prev => new Set(prev).add(notificationId));
                visibilityTimers.current.delete(notificationId);
              }, 3000); // 3 seconds
              visibilityTimers.current.set(notificationId, timer);
            }
          } else {
            // Clear timer if notification leaves viewport before 3 seconds
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

    // Capture current ref value for cleanup
    const timersToCleanup = visibilityTimers.current;

    return () => {
      observer.disconnect();
      // Clear all timers when dropdown closes
      timersToCleanup.forEach((timer) => clearTimeout(timer));
      timersToCleanup.clear();
    };
  }, [showDropdown, notifications]); // Re-run when dropdown opens/closes or notifications change

  // Get recent notifications (max 5) - show all, not just unread
  const recentNotifications = notifications.slice(0, 5);

  const handleNotificationClick = async (notification: typeof notifications[0]) => {
    // Mark as read
    if (!notification.is_read) {
      await markAsRead(notification.id);
    }

    // Navigate to action URL
    if (notification.action_url) {
      router.push(notification.action_url);
      setShowDropdown(false);
    }
  };

  const getRelativeTime = (timestamp: string) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInSeconds = Math.floor((now.getTime() - time.getTime()) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return time.toLocaleDateString();
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'group_invite':
        return 'fa-golf-ball';
      case 'group_update':
        return 'fa-trophy';
      case 'follow_request':
      case 'follow_accepted':
      case 'new_follower':
        return 'fa-user-plus';
      case 'like':
        return 'fa-heart';
      case 'comment':
      case 'comment_reply':
        return 'fa-comment';
      case 'mention':
      case 'tag':
        return 'fa-at';
      case 'achievement':
        return 'fa-trophy';
      case 'system_announcement':
        return 'fa-bullhorn';
      case 'club_update':
      case 'team_update':
        return 'fa-users';
      default:
        return 'fa-bell';
    }
  };

  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      {/* Bell Icon Button */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="ea-icon-btn inline-flex items-center justify-center"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={showDropdown}
      >
        <i className="fas fa-bell text-xl" aria-hidden="true"></i>

        {/* A DOT, not a number — matching MessagesBell. The count is announced
            to screen readers via aria-label instead, which is where it is
            actually useful. The ring separates it from the blurred header. */}
        {unreadCount > 0 && (
          <span
            className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-600 ring-2 ring-white"
            aria-hidden="true"
          />
        )}
      </button>

      {/* Dropdown Menu. Mobile: fixed full-width panel under the header (the
          bell is NOT the header's rightmost element, so an absolute right-0
          panel this wide would hang off the LEFT screen edge and horizontally
          scroll the page). sm+: classic anchored dropdown. */}
      {showDropdown && (
        <div className="fixed inset-x-2 top-[calc(4rem+env(safe-area-inset-top)+0.5rem)] mx-auto sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mx-0 sm:mt-2 sm:w-96 max-w-[24rem] bg-surface-raised rounded-lg shadow-lg border border-border z-50 max-h-[80vh] sm:max-h-[600px] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-surface-muted">
            <h3 className="font-semibold text-primary">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsRead()}
                className="text-xs text-brand-fg hover:text-brand-fg-strong font-medium"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto flex-1">
            {recentNotifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <i className="fas fa-bell-slash text-4xl text-gray-300 mb-2"></i>
                <p className="text-muted text-sm">No new notifications</p>
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {recentNotifications.map((notification) => (
                  <div
                    key={`${notification.id}-${notification.is_read}`}
                    ref={(el) => setNotificationRef(notification.id, el)}
                    data-notification-id={notification.id}
                    data-is-read={notification.is_read}
                    onClick={() => handleNotificationClick(notification)}
                    className="px-4 py-3 hover:bg-surface-muted cursor-pointer transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Actor Avatar or Icon */}
                      {notification.actor ? (
                        <AvatarImage
                          src={notification.actor.avatar_url}
                          alt={formatDisplayName(
                            notification.actor.first_name,
                            notification.actor.middle_name,
                            notification.actor.last_name,
                            notification.actor.full_name
                          )}
                          size={40}
                          fallbackInitials={getInitials(
                            formatDisplayName(
                              notification.actor.first_name,
                              notification.actor.middle_name,
                              notification.actor.last_name,
                              notification.actor.full_name
                            )
                          )}
                        />
                      ) : (
                        <div className="w-10 h-10 bg-violet-100 rounded-full flex items-center justify-center">
                          <i className={`fas ${getNotificationIcon(notification.type)} text-brand-fg`}></i>
                        </div>
                      )}

                      {/* Notification Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2">
                          <p className={`text-sm font-medium flex-1 line-clamp-2 ${
                            !notification.is_read ? 'text-primary' : 'text-tertiary'
                          }`}>
                            {getNotificationText(notification)}
                          </p>
                          {/* Blue dot indicator for unread AND not viewed */}
                          {!notification.is_read && !viewedNotifications.has(notification.id) && (
                            <div className="w-2 h-2 bg-brand rounded-full mt-1 flex-shrink-0"></div>
                          )}
                        </div>
                        {notification.message && (
                          <p className="text-xs text-tertiary mt-1 line-clamp-2">
                            {notification.message}
                          </p>
                        )}
                        <p className="text-xs text-muted mt-1">
                          {getRelativeTime(notification.created_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-border bg-surface-muted">
            <button
              onClick={() => {
                router.push('/app/notifications');
                setShowDropdown(false);
              }}
              className="w-full text-center text-sm text-brand-fg hover:text-brand-fg-strong font-medium"
            >
              View all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
