'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useNotifications, getNotificationText } from '@/lib/notifications';
import NotificationActionRow from '@/components/NotificationActionRow';
import { getNotificationIcon } from '@/lib/notification-registry';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { AvatarImage } from '@/components/OptimizedImage';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';

/**
 * The bell. Opening it IS seeing it (Tom, Oct 4 2026 — Instagram's rule):
 * everything unread is marked read on open, so the red dot and the app icon's
 * number go to zero together. The rows that were new at that moment keep the
 * "new" styling for the rest of that open (`freshIds`), then read as read the
 * next time. Items arriving by realtime while the panel is open are new and
 * stay unread until the next open. Accept / Decline stay on pending rows
 * (the action row reads action_status, never is_read).
 */
export default function NotificationBell() {
  const router = useRouter();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // The rows that were unread when the panel opened — new for this open.
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());

  // Outside press or Escape closes — the shared popover pattern (this
  // component's document-listener approach is where the hook came from;
  // adopting it scopes the listener to the open state and adds Escape).
  const closeDropdown = useCallback(() => setShowDropdown(false), []);
  usePopoverDismiss(dropdownRef, showDropdown, closeDropdown);

  const toggle = () => {
    if (showDropdown) {
      setShowDropdown(false);
      return;
    }
    setFreshIds(new Set(notifications.filter(n => !n.is_read).map(n => n.id)));
    setShowDropdown(true);
    if (unreadCount > 0) void markAllAsRead();
  };

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


  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      {/* Bell Icon Button */}
      <button
        onClick={toggle}
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
            {freshIds.size > 0 && (
              <span className="text-xs text-brand-fg font-medium" data-notifications-new={freshIds.size}>
                {freshIds.size} new
              </span>
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
                {recentNotifications.map((notification) => {
                  const fresh = freshIds.has(notification.id) || !notification.is_read;
                  return (
                  <div
                    key={notification.id}
                    data-notification-id={notification.id}
                    data-notification-fresh={fresh ? '' : undefined}
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
                            fresh ? 'text-primary' : 'text-tertiary'
                          }`}>
                            {getNotificationText(notification)}
                          </p>
                          {/* Blue dot: new for this open */}
                          {fresh && (
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
                        <NotificationActionRow notification={notification} compact />
                      </div>
                    </div>
                  </div>
                  );
                })}
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
