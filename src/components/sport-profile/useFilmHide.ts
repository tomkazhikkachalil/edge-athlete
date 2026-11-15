'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/components/Toast';

/**
 * The athlete's hide control (migration 311): a game or one clip leaves
 * their page for visitors; the stat still counts. Optimistic is not worth
 * it here — the page's numbers do not change — so it saves, then asks the
 * page to read again; a failure says so and changes nothing.
 */
export function useFilmHide(profileId: string, onChanged: () => void): { busy: boolean; setHidden: (target: { videoId: string; highlightId?: string | null; hidden: boolean }) => Promise<void> } {
  const { showError } = useToast();
  const [busy, setBusy] = useState(false);
  const setHidden = useCallback(async (target: { videoId: string; highlightId?: string | null; hidden: boolean }) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/profile/${profileId}/film-hidden`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: target.videoId, highlight_id: target.highlightId ?? null, hidden: target.hidden }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        showError(body?.error ?? 'Could not save that. Check your connection and try again.');
        return;
      }
      // The result is on the screen (the row says it is hidden): no toast for it.
      onChanged();
    } catch {
      showError('Could not save that. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [profileId, onChanged, showError]);
  return { busy, setHidden };
}
