'use client';

import { HIDDEN_NOTICE } from '@/lib/results/kinds';
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
  const { showError, showSuccess } = useToast();

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
      // Results-kept (241): a round anyone scored comes back HIDDEN, not deleted — say so.
      const body = await response.json().catch(() => ({}));
      if (body && body.hidden) showSuccess('Hidden from your profile', HIDDEN_NOTICE);
      onDone?.();
      return true;
    } catch (err) {
      console.error('Delete round failed:', err);
      showError('Could not delete the round', err instanceof Error ? err.message : 'Please try again');
      return false;
    } finally {
      setDeleting(false);
    }
  }, [groupPostId, onDone, showError, showSuccess]);

  return { deleteRound, deleting };
}
