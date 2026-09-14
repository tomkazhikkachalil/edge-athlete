'use client';

import { useState } from 'react';
import { actionRowFor } from '@/lib/notification-actions';
import { useNotifications, type Notification } from '@/lib/notifications';

/**
 * Accept / Decline on an actionable, still-pending bell (Events program,
 * PR 11): a fan request, an event invitation, a request to join your
 * event. Optimistic — the row flips to the decided line at once and rolls
 * back on a refusal. Clicks never bubble to the row's navigation.
 */
export default function NotificationActionRow({ notification, compact = false }: { notification: Notification; compact?: boolean }) {
  const { applyActionStatus } = useNotifications();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const row = actionRowFor(notification);
  if (!row.show) return null;

  const decide = async (action: 'accept' | 'decline') => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/notifications/${notification.id}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; action_status?: 'accepted' | 'declined' };
      if (!res.ok) { setError(data.error ?? 'That did not go through.'); return; }
      applyActionStatus(notification.id, data.action_status ?? (action === 'accept' ? 'accepted' : 'declined'));
    } catch {
      setError('You appear to be offline.');
    } finally {
      setBusy(null);
    }
  };

  const size = compact ? 'min-h-[40px] px-3 text-xs' : 'min-h-[44px] px-4 text-sm';
  return (
    <div className="mt-2" data-notification-action-row={notification.type} onClick={e => e.stopPropagation()}>
      <div className="flex gap-2">
        <button type="button" disabled={busy !== null} onClick={() => decide('accept')} className={`ea-cta text-white rounded-lg font-semibold inline-flex items-center justify-center disabled:opacity-60 ${size}`} data-notification-accept="">{busy === 'accept' ? '…' : row.accept}</button>
        <button type="button" disabled={busy !== null} onClick={() => decide('decline')} className={`ea-interactive border border-border-strong text-secondary rounded-lg font-semibold inline-flex items-center justify-center disabled:opacity-60 ${size}`} data-notification-decline="">{busy === 'decline' ? '…' : row.decline}</button>
      </div>
      {error && <p className="text-xs text-red-700 dark:text-red-300 mt-1">{error}</p>}
    </div>
  );
}
