'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Guards a modal's close paths behind a "Discard changes?" confirm when
 * there are unsaved changes. ALL user-initiated close paths (X, Cancel,
 * backdrop click) must call requestClose; programmatic closes after a
 * successful save call the modal's own close function directly (never
 * confirm after a save). Pair with ConfirmModal and COPY.FORMS.DISCARD_*.
 *
 * Dummy-proofing round: while dirty, the hook ALSO arms a beforeunload
 * prompt — refresh/tab-close gets the browser's native "leave site?"
 * dialog instead of silently destroying the work. (In-app route changes
 * still go through requestClose; the browser guard covers the half no
 * in-app code can intercept.) One registration per mounted hook, reading
 * dirtiness through a ref so the listener never re-subscribes.
 */
export function useDirtyClose(isDirty: () => boolean, onClose: () => void) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  });

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current()) return;
      event.preventDefault();
      // Legacy engines require returnValue to show the prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const requestClose = useCallback(() => {
    if (isDirty()) setConfirmOpen(true);
    else onClose();
  }, [isDirty, onClose]);

  const confirmDiscard = useCallback(() => {
    setConfirmOpen(false);
    onClose();
  }, [onClose]);

  const cancelDiscard = useCallback(() => setConfirmOpen(false), []);

  return { requestClose, confirmOpen, confirmDiscard, cancelDiscard };
}
