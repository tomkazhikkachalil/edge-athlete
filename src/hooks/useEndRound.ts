'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/components/Toast';

/**
 * Creator's "Finish round" action — marks a shared round completed via
 * PATCH /api/group-posts/[id] (creator-only, enforced server-side; the one
 * Finish writer, round-finish.ts, then writes the record). The post stays a
 * DRAFT until posted from the review screen (Drafts round, Oct 2026). One
 * implementation shared by the quick-view footer and the full-card header.
 */
export function useEndRound(groupPostId: string, onDone?: () => void) {
  const [ending, setEnding] = useState(false);
  const { showError } = useToast();

  const endRound = useCallback(async () => {
    setEnding(true);
    try {
      const response = await fetch(`/api/group-posts/${groupPostId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to finish the round');
      }
      onDone?.();
      return true;
    } catch (err) {
      console.error('Finish round failed:', err);
      showError('Could not finish the round', err instanceof Error ? err.message : 'Please try again');
      return false;
    } finally {
      setEnding(false);
    }
  }, [groupPostId, onDone, showError]);

  return { endRound, ending };
}
