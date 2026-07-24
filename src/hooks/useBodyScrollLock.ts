'use client';

import { useEffect } from 'react';

// Module-level refcount: modals can stack (e.g. ConfirmModal over
// SharedRoundFullCard, TagPeopleModal over CreatePostModal). A naive
// per-modal `overflow = 'unset'` on cleanup would unlock the body while the
// PARENT modal is still open. The count restores scrolling only when the
// last locker unmounts.
let lockCount = 0;

/**
 * Locks background page scroll while a full-screen modal is open (iOS scroll
 * chaining / rubber-banding behind overlays). Pass the modal's open state;
 * pass `true` for components that only mount while open.
 */
export function useBodyScrollLock(locked: boolean = true) {
  useEffect(() => {
    if (!locked) return;

    lockCount++;
    document.body.style.overflow = 'hidden';

    return () => {
      lockCount--;
      if (lockCount <= 0) {
        lockCount = 0;
        document.body.style.overflow = '';
      }
    };
  }, [locked]);
}
