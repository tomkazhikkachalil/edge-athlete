'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { MAX_PINS, togglePin, type ResolvedPin, type TrainingPin } from '@/lib/training/pins';

/**
 * A profile's pinned bests (Training redesign PR 7): what THIS viewer may see
 * of them, and — for the athlete — the toggle. The tap is optimistic and
 * synced: the raw list moves at once, the server's answer replaces both
 * lists; a failed save puts the list back and says so. Saves go one at a
 * time, the latest list last (two fast taps never cross on the wire).
 */
export function useTrainingPins(profileId: string, canEdit: boolean) {
  const [resolved, setResolved] = useState<ResolvedPin[]>([]);
  const [mine, setMine] = useState<TrainingPin[]>([]);
  const { showError, showNotice } = useToast();
  const mineRef = useRef<TrainingPin[]>([]);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/profile/${profileId}/training/pins`, { credentials: 'include', cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { pins?: ResolvedPin[]; mine?: TrainingPin[] };
      setResolved(Array.isArray(body.pins) ? body.pins : []);
      const raw = Array.isArray(body.mine) ? body.mine : [];
      mineRef.current = raw;
      setMine(raw);
    } catch {
      /* the showcase is an extra: a failed read shows none */
    }
  }, [profileId]);

  useEffect(() => {
    let live = true;
    void (async () => {
      if (live) await load();
    })();
    return () => {
      live = false;
    };
  }, [load]);

  const toggle = useCallback(
    (pin: TrainingPin) => {
      if (!canEdit) return;
      const next = togglePin(mineRef.current, pin);
      if ('full' in next) {
        showNotice(`${MAX_PINS} bests are pinned`, 'Unpin one to make room.');
        return;
      }
      const before = mineRef.current;
      mineRef.current = next.pins;
      setMine(next.pins);
      const list = next.pins;
      queueRef.current = queueRef.current.then(async () => {
        try {
          const res = await fetch('/api/training/pins', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ pins: list }) });
          if (!res.ok) throw new Error('save failed');
          const body = (await res.json()) as { pins?: ResolvedPin[] };
          // Only the LATEST list's answer is shown; an earlier tap's answer is already stale.
          if (mineRef.current === list) setResolved(Array.isArray(body.pins) ? body.pins : []);
        } catch {
          if (mineRef.current === list) {
            mineRef.current = before;
            setMine(before);
            showError('Pin not saved', 'Check your connection and tap it again.');
          }
        }
      });
    },
    [canEdit, showError, showNotice]
  );

  return { resolved, mine, toggle, reload: load };
}
