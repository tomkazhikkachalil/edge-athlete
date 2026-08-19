'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/components/Toast';

/**
 * Creator's "Delete round" action — removes the round COMPLETELY via
 * DELETE /api/group-posts/[id] (creator-only, enforced server-side): the
 * group post and its scores, the feed post, and the stat mirrors. One
 * implementation shared by the quick-view footer and the full-card header,
 * same shape as useEndRound.
 */
export function useDeleteRound(groupPostId: string, onDone?: () => void) {
  const [deleting, setDeleting] = useState(false);
  const { showError } = useToast();

  const deleteRound = useCallback(async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/group-posts/${groupPostId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete round');
      }
      onDone?.();
      return true;
    } catch (err) {
      console.error('Delete round failed:', err);
      showError('Could not delete the round', err instanceof Error ? err.message : 'Please try again');
      return false;
    } finally {
      setDeleting(false);
    }
  }, [groupPostId, onDone, showError]);

  return { deleteRound, deleting };
}
