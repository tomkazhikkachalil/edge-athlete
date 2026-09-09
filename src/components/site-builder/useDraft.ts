'use client';

import { useEffect, useRef, useState } from 'react';
import type { SiteLayout } from '@/lib/site-builder/layout';

export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'offline';

/**
 * Autosave — Site Builder P3-B. Watches the layout the editor holds and,
 * 1.5s after it last changed, PUTs it to the draft with the rev the editor
 * last saw. The state in memory is the truth; the chip reflects the wire.
 * A 409 (someone else saved) reports `conflict` and hands the caller the
 * job of reloading. Nothing is saved until the FIRST edit — the layout the
 * canvas loaded is already the draft's (or the projection).
 */
export function useDraft(
  layout: SiteLayout,
  save: (layout: SiteLayout, baseRev: number | null) => Promise<{ rev: number } | 'conflict' | 'error'>,
  initialRev: number | null,
  enabled: boolean
) {
  const [status, setStatus] = useState<DraftSaveStatus>('idle');
  const [rev, setRev] = useState<number | null>(initialRev);
  const revRef = useRef<number | null>(initialRev);
  // The last layout the server accepted — state, not a ref, because
  // `dirty` derives from it during render.
  const [saved, setSaved] = useState<SiteLayout>(layout);
  const initial = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    if (initial.current) {
      initial.current = false;
      return;
    }
    if (layout === saved) return;
    const timer = window.setTimeout(async () => {
      setStatus('saving');
      const result = await save(layout, revRef.current);
      if (result === 'conflict') {
        setStatus('conflict');
        return;
      }
      if (result === 'error') {
        setStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
        return;
      }
      revRef.current = result.rev;
      setRev(result.rev);
      setSaved(layout);
      setStatus('saved');
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [layout, saved, enabled, save]);

  const dirty = enabled && layout !== saved;

  // The native leave prompt while an edit is unsaved (the SiteBlockEditor
  // beforeunload recipe; in-app navigation is not guarded).
  useEffect(() => {
    if (!dirty && status !== 'saving') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, status]);

  /** After a reload that replaced the layout: adopt the server's rev and
   *  treat the new layout as saved. */
  const adopt = (next: SiteLayout, nextRev: number | null) => {
    setSaved(next);
    revRef.current = nextRev;
    setRev(nextRev);
    setStatus('idle');
  };

  return { status, rev, dirty, adopt };
}
