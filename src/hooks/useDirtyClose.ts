'use client';

import { useState, useCallback } from 'react';

/**
 * Guards a modal's close paths behind a "Discard changes?" confirm when
 * there are unsaved changes. ALL user-initiated close paths (X, Cancel,
 * backdrop click) must call requestClose; programmatic closes after a
 * successful save call the modal's own close function directly (never
 * confirm after a save). Pair with ConfirmModal and COPY.FORMS.DISCARD_*.
 */
export function useDirtyClose(isDirty: () => boolean, onClose: () => void) {
  const [confirmOpen, setConfirmOpen] = useState(false);

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
