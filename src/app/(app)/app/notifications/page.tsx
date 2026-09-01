'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/auth';
import { useNotifications, getNotificationText } from '@/lib/notifications';
import { getNotificationIcon, notificationTab } from '@/lib/notification-registry';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';

// 1091-line modal — only loaded when user opens Edit Profile
const EditProfileTabs = dynamic(() => import('@/components/EditProfileTabs'), { ssr: false });

type Tab = 'all' | 'unread' | 'follow' | 'engagement' | 'system';

export default function NotificationsPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const {
    notifications,
    unreadCount,
    loading,
    hasMore,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll
  } = useNotifications();

  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  // C1 (Sep 2026): single-delete gets the same confirm treatment clear-all
  // always had — deletion is permanent and the trash icon sits next to the
  // tap target for opening the notification.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [user, authLoading, router]);

  // Filter notifications based on active tab. Tab membership lives in the
  // registry (src/lib/notification-registry.ts); a type the registry doesn't
  // know yet maps to no named tab, so it stays reachable via All/Unread.
  const filteredNotifications = notifications.filter(notification => {
    if (activeTab === 'unread') return !notification.is_read;
    if (activeTab === 'all') return true;
    return notificationTab(notification.type) === activeTab;
  });

  // Group notifications by date
  const groupNotificationsByDate = () => {
    const groups: { [key: string]: typeof notifications } = {
      'Today': [],
      'Yesterday': [],
      'This Week': [],
      'Earlier': []
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    filteredNotifications.forEach(notification => {
      const notificationDate = new Date(notification.created_at);
      const notificationDay = new Date(
        notificationDate.getFullYear(),
        notificationDate.getMonth(),
        notificationDate.getDate()
      );

      if (notificationDay.getTime() === today.getTime()) {
        groups['Today'].push(notification);
      } else if (notificationDay.getTime() === yesterday.getTime()) {
        groups['Yesterday'].push(notification);
      } else if (notificationDay.getTime() >= lastWeek.getTime()) {
        groups['This Week'].push(notification);
      } else {
        groups['Earlier'].push(notification);
      }
    });

    return groups;
  };

  const groupedNotifications = groupNotificationsByDate();

  const getRelativeTime = (timestamp: string) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInSeconds = Math.floor((now.getTime() - time.getTime()) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;

    // Format as "Yesterday at 3:45 PM" or "Dec 15 at 3:45 PM"
    const hour = time.getHours();
    const minute = time.getMinutes().toString().padStart(2, '0');
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    const timeStr = `${displayHour}:${minute} ${ampm}`;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    if (time.toDateString() === yesterday.toDateString()) {
      return `Yesterday at ${timeStr}`;
    }

    const month = time.toLocaleDateString('en-US', { month: 'short' });
    const day = time.getDate();
    return `${month} ${day} at ${timeStr}`;
  };

  const handleNotificationClick = async (notification: typeof notifications[0]) => {
    // Mark as read
    if (!notification.is_read) {
      await markAsRead(notification.id);
    }

    // Navigate to action URL
    if (notification.action_url) {
      router.push(notification.action_url);
    }
  };

  const handleLoadMore = () => {
    fetchNotifications({ unreadOnly: activeTab === 'unread' });
  };

  const handleClearAll = async () => {
    await clearAll();
    setShowClearConfirm(false);
  };

  if (authLoading || !user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Unified Header */}
      <AppHeader
        showSearch={false}
        onEditProfile={() => setIsEditProfileModalOpen(true)}
      />

      {/* Notifications Page Header */}
      <div className="bg-surface border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div>
              <h1 className="text-2xl font-bold text-primary">Notifications</h1>
              <p className="text-sm text-tertiary mt-1">
                {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'All caught up!'}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="px-4 py-2 text-sm font-medium text-brand-fg hover:text-brand-fg-strong transition-colors"
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mt-6 border-b border-border overflow-x-auto scrollbar-hide">
            {[
              { id: 'all' as Tab, label: 'All', count: notifications.length },
              { id: 'unread' as Tab, label: 'Unread', count: unreadCount },
              { id: 'follow' as Tab, label: 'Fans', icon: 'fa-user-plus' },
              { id: 'engagement' as Tab, label: 'Engagement', icon: 'fa-heart' },
              { id: 'system' as Tab, label: 'System', icon: 'fa-bullhorn' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium transition-colors relative whitespace-nowrap flex-shrink-0 ${
                  activeTab === tab.id
                    ? 'text-brand-fg border-b-2 border-brand'
                    : 'text-tertiary hover:text-primary'
                }`}
              >
                {tab.icon && <i className={`fas ${tab.icon} mr-2`}></i>}
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="ml-2 px-2 py-0.5 text-xs bg-violet-100 dark:bg-violet-950/60 text-brand-fg rounded-full">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Notifications List */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {loading && notifications.length === 0 ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="text-center py-12">
            <i className="fas fa-bell-slash text-5xl text-gray-300 mb-4"></i>
            <h3 className="text-lg font-medium text-primary mb-2">No notifications</h3>
            <p className="text-tertiary">
              {activeTab === 'unread'
                ? "You're all caught up! No unread notifications."
                : "When you receive notifications, they'll appear here."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedNotifications).map(([group, groupNotifications]) =>
              groupNotifications.length > 0 ? (
                <div key={group}>
                  <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">
                    {group}
                  </h2>
                  <div className="bg-surface rounded-lg shadow-sm border border-border divide-y divide-border-subtle">
                    {groupNotifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={`p-4 hover:bg-surface-muted transition-colors cursor-pointer ${
                          !notification.is_read ? 'bg-brand-soft' : ''
                        }`}
                        onClick={() => handleNotificationClick(notification)}
                      >
                        <div className="flex items-start gap-4">
                          {/* Actor Avatar or Icon */}
                          {notification.actor?.avatar_url ? (
                            <Image
                              src={notification.actor.avatar_url}
                              alt={formatDisplayName(
                                notification.actor.first_name,
                                notification.actor.middle_name,
                                notification.actor.last_name,
                                notification.actor.full_name
                              ) || 'User'}
                              width={48}
                              height={48}
                              className="rounded-full object-cover flex-shrink-0"
                            />
                          ) : notification.actor ? (
                            <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-white text-sm font-semibold">
                                {getInitials(
                                  formatDisplayName(
                                    notification.actor.first_name,
                                    notification.actor.middle_name,
                                    notification.actor.last_name,
                                    notification.actor.full_name
                                  )
                                )}
                              </span>
                            </div>
                          ) : (
                            <div className="w-12 h-12 bg-violet-100 dark:bg-violet-950/60 rounded-full flex items-center justify-center flex-shrink-0">
                              <i className={`fas ${getNotificationIcon(notification.type)} text-brand-fg`}></i>
                            </div>
                          )}

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-primary">
                              {getNotificationText(notification)}
                            </p>
                            {notification.message && (
                              <p className="text-sm text-tertiary mt-1">
                                {notification.message}
                              </p>
                            )}
                            <p className="text-xs text-muted mt-2">
                              {getRelativeTime(notification.created_at)}
                            </p>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2">
                            {!notification.is_read && (
                              <div className="w-2 h-2 bg-brand rounded-full"></div>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(notification.id);
                              }}
                              className="p-2 text-faint hover:text-red-600 dark:hover:text-red-400 transition-colors"
                              title="Delete notification"
                            >
                              <i className="fas fa-trash text-sm"></i>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null
            )}

            {/* Load More Button */}
            {hasMore && (
              <div className="flex justify-center py-4">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="px-6 py-2 bg-surface border border-border-strong rounded-lg text-sm font-medium text-secondary hover:bg-surface-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
        )}
      </div>

      <ConfirmModal
        isOpen={confirmDeleteId !== null}
        title="Delete this notification?"
        message="It will be removed permanently."
        confirmText="Delete"
        cancelText="Keep it"
        onConfirm={() => {
          if (confirmDeleteId) deleteNotification(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {/* Clear All Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-raised rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-primary mb-2">Clear all notifications?</h3>
            <p className="text-sm text-tertiary mb-6">
              This will permanently delete all your notifications. This action cannot be undone.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-stone-800 text-secondary font-medium rounded-lg hover:bg-gray-300 dark:hover:bg-stone-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClearAll}
                className="flex-1 px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors"
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      <EditProfileTabs
        isOpen={isEditProfileModalOpen}
        onClose={() => setIsEditProfileModalOpen(false)}
        profile={profile}
        onSave={() => {
          // Profile will be refreshed automatically by useAuth
          setIsEditProfileModalOpen(false);
        }}
      />
    </div>
  );
}
