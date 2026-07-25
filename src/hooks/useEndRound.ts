'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/components/Toast';

/**
 * Creator's "End Round" action — marks a shared round completed via
 * PATCH /api/group-posts/[id] (creator-only, enforced server-side). One
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
        throw new Error(data.error || 'Failed to end round');
      }
      onDone?.();
      return true;
    } catch (err) {
      console.error('End round failed:', err);
      showError('Could not end the round', err instanceof Error ? err.message : 'Please try again');
      return false;
    } finally {
      setEnding(false);
    }
  }, [groupPostId, onDone, showError]);

  return { endRound, ending };
}
