'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/Toast';

// In-app notification type preferences. Enforced at creation time inside
// create_notification's preference gate — turning one off means the row is
// never created. (push_enabled/email_enabled exist in the table but those
// delivery channels aren't built yet — no dishonest toggles for them.)
interface Preferences {
  follow_requests_enabled: boolean;
  follow_accepted_enabled: boolean;
  new_followers_enabled: boolean;
  likes_enabled: boolean;
  comments_enabled: boolean;
  mentions_enabled: boolean;
  tags_enabled: boolean;
  achievements_enabled: boolean;
  system_announcements_enabled: boolean;
  club_updates_enabled: boolean;
  email_enabled: boolean;
}

type PrefKey = keyof Preferences;

const GROUPS: Array<{ title: string; items: Array<{ key: PrefKey; label: string; description: string }> }> = [
  {
    title: 'Fans & follows',
    items: [
      { key: 'follow_requests_enabled', label: 'Fan requests', description: 'Someone wants to become your fan' },
      { key: 'follow_accepted_enabled', label: 'Request accepted', description: 'A private athlete accepted your fan request' },
      { key: 'new_followers_enabled', label: 'New fans', description: 'Someone became your fan' },
    ],
  },
  {
    title: 'Activity on your posts',
    items: [
      { key: 'likes_enabled', label: 'Likes', description: 'Someone liked your post or comment' },
      { key: 'comments_enabled', label: 'Comments', description: 'Someone commented on your post' },
      { key: 'mentions_enabled', label: 'Mentions', description: 'Someone mentioned you' },
      { key: 'tags_enabled', label: 'Tags', description: 'Someone tagged you in a post' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { key: 'achievements_enabled', label: 'Achievements', description: 'Milestones and badges you earn' },
      { key: 'system_announcements_enabled', label: 'Announcements', description: 'Updates from Edge Athlete' },
      { key: 'club_updates_enabled', label: 'Club updates', description: 'News from clubs you belong to' },
    ],
  },
];

function Toggle({ on, disabled, onChange, label }: { on: boolean; disabled: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-1 disabled:opacity-50 ${
        on ? 'bg-violet-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export default function NotificationSettings() {
  const { showError } = useToast();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<PrefKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/notifications/preferences');
        if (cancelled) return;
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) setPrefs(data.preferences);
        } else {
          showError('Error', 'Could not load notification preferences.');
        }
      } catch (e) {
        console.error('Failed to load notification preferences:', e);
        if (!cancelled) showError('Error', 'Could not load notification preferences.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (key: PrefKey) => {
    if (!prefs || savingKey) return;
    const nextValue = !prefs[key];

    // Optimistic
    setPrefs({ ...prefs, [key]: nextValue });
    setSavingKey(key);
    try {
      const response = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: nextValue }),
      });
      if (!response.ok) {
        setPrefs({ ...prefs, [key]: !nextValue });
        showError('Save failed', 'Your preference was not saved. Please try again.');
      }
    } catch (e) {
      console.error('Failed to save preference:', e);
      setPrefs({ ...prefs, [key]: !nextValue });
      showError('Save failed', 'Your preference was not saved. Please try again.');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600 mx-auto"></div>
        <p className="mt-3 text-sm text-gray-600">Loading preferences…</p>
      </div>
    );
  }

  if (!prefs) {
    return (
      <div className="text-center py-12 text-sm text-gray-600">
        Could not load your preferences. Refresh the page to try again.
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Notification preferences</h2>
      <p className="text-sm text-gray-500 mb-6">
        Turn off any notification type you don&apos;t want. Changes apply to new notifications
        immediately.
      </p>

      {/* Email delivery — a separate channel from the in-app toggles below */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
          Email
        </h3>
        <div className="border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Daily email digest</p>
              <p className="text-xs text-gray-500">
                Once a day, get an email summary of your new notifications. Off by default.
              </p>
            </div>
            <Toggle
              on={prefs.email_enabled}
              disabled={savingKey === 'email_enabled'}
              onChange={() => toggle('email_enabled')}
              label="Daily email digest"
            />
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {GROUPS.map(group => (
          <div key={group.title}>
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
              {group.title}
            </h3>
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
              {group.items.map(item => (
                <div key={item.key} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{item.label}</p>
                    <p className="text-xs text-gray-500">{item.description}</p>
                  </div>
                  <Toggle
                    on={prefs[item.key]}
                    disabled={savingKey === item.key}
                    onChange={() => toggle(item.key)}
                    label={`${item.label} notifications`}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
