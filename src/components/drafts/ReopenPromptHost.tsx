'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useDrafts, refreshDrafts } from '@/hooks/useDrafts';
import { ACTIVITY_TYPE_DEFS } from '@/lib/activities/catalog';
import { openRecordingStore } from '@/lib/activities/record/storage';
import { buildDraftsList, draftReviewHref, pickReopenCandidate, type DraftItem, type DraftRecordingLike } from '@/lib/drafts/list';
import { reopenActions, reopenSeenKey, reopenSkipsPath } from '@/lib/drafts/reopen';
import { COPY } from '@/lib/copy';

// ── The reopen prompt (Drafts round PR 4, Oct 2026) ──────────────────────────
// Root-mounted beside the install host: once per app open, if something is
// in progress — a round being scored, a workout, a recording on this phone —
// ask: Resume, Finish or Discard. Closing the app never ends anything; this
// is the way back. Skipped on the screens that ARE the thing. It replaces the
// feed's "Live round at …" banner and the Vitals workout banner (one door, at
// the top of every page; the Drafts area is the second).

export default function ReopenPromptHost() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, initialAuthCheckComplete } = useAuth();
  const { showSuccess, showError } = useToast();
  const drafts = useDrafts(!!user);
  const [recording, setRecording] = useState<DraftRecordingLike | null>(null);
  const [checkedPhone, setCheckedPhone] = useState(false);
  const [item, setItem] = useState<DraftItem | null>(null);
  const [busy, setBusy] = useState<'finish' | 'discard' | null>(null);
  const decidedRef = useRef(false);

  // The phone's own recording (IndexedDB) — the server never sees it.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const store = openRecordingStore();
      const meta = store ? await store.findUnfinished(user.id, Date.now()).catch(() => null) : null;
      if (cancelled) return;
      if (meta) setRecording({ id: meta.id, label: ACTIVITY_TYPE_DEFS[meta.type]?.label ?? 'Activity', savedAt: meta.savedAt });
      setCheckedPhone(true);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Decide ONCE per app open, after both sources answered.
  useEffect(() => {
    // Both sources must have answered: the server list (loaded) and the phone.
    if (decidedRef.current || !initialAuthCheckComplete || !user || !checkedPhone || !drafts.loaded) return;
    if (reopenSkipsPath(pathname)) return;
    let cancelled = false;
    (async () => {
      // The session's memory is the external system here (sessionStorage).
      let seen = false;
      try { seen = sessionStorage.getItem(reopenSeenKey(user.id)) === '1'; } catch { /* storage unavailable — ask this once */ }
      await Promise.resolve();
      if (cancelled || decidedRef.current) return;
      decidedRef.current = true;
      if (seen) return;
      const phone = recording ? buildDraftsList({ rounds: [], workouts: [], recording }).inProgress : [];
      const candidate = pickReopenCandidate({ inProgress: [...phone, ...drafts.inProgress].sort((a, b) => Date.parse(b.lastActivityAt ?? b.startedAt ?? '') - Date.parse(a.lastActivityAt ?? a.startedAt ?? '')), drafts: [] });
      if (!candidate) return;
      try { sessionStorage.setItem(reopenSeenKey(user.id), '1'); } catch { /* best-effort */ }
      setItem(candidate);
    })();
    return () => { cancelled = true; };
  }, [initialAuthCheckComplete, user, checkedPhone, drafts, recording, pathname]);

  useBodyScrollLock(!!item);

  if (!item) return null;
  const actions = reopenActions(item);
  const close = () => setItem(null);

  const resume = () => { close(); router.push(item.href); };

  const finish = async () => {
    if (busy) return;
    setBusy('finish');
    try {
      if (item.kind === 'round') {
        const res = await fetch(`/api/group-posts/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { showError('Could not finish the round', typeof body.error === 'string' ? body.error : 'Please try again.'); return; }
        void refreshDrafts();
        close();
        router.push(item.postId ? draftReviewHref(item.postId) : '/athlete/drafts');
      } else if (item.kind === 'workout') {
        const res = await fetch(`/api/workouts/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ finish: { endedAt: item.lastActivityAt ?? new Date().toISOString() } }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 409) { showError('Could not finish the workout', typeof body.error === 'string' ? body.error : 'Please try again.'); return; }
        void refreshDrafts();
        close();
        router.push(`/app/workout/${item.id}?share=1`);
      } else {
        close();
        router.push('/activities/record?finish=1');
      }
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (busy) return;
    setBusy('discard');
    try {
      if (item.kind === 'round') {
        const res = await fetch(`/api/group-posts/${item.id}?mode=delete`, { method: 'DELETE' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { showError('Could not discard the round', typeof body.error === 'string' ? body.error : 'Please try again.'); return; }
      } else if (item.kind === 'workout') {
        const res = await fetch(`/api/workouts/${item.id}`, { method: 'DELETE' });
        if (!res.ok) { showError('Could not discard the workout', 'Please try again.'); return; }
      } else {
        await openRecordingStore()?.clear(item.id).catch(() => undefined);
      }
      showSuccess('Discarded', 'Nothing was posted.');
      void refreshDrafts();
      close();
    } finally {
      setBusy(null);
    }
  };

  const btn = 'px-4 py-2 min-h-[44px] rounded-lg border border-border-strong text-secondary hover:bg-surface-muted transition-colors font-medium disabled:opacity-50';
  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" data-reopen-prompt={`${item.kind}:${item.id}`}>
      <div className="bg-surface-raised rounded-lg shadow-xl max-w-md w-full" role="dialog" aria-modal="true" aria-labelledby="reopen-prompt-title">
        <div className="p-4 sm:p-6 border-b border-border">
          <h2 id="reopen-prompt-title" className="text-xl font-bold text-primary">{COPY.FORMS.REOPEN_TITLE}</h2>
        </div>
        <div className="p-4 sm:p-6">
          <p className="text-secondary">{actions.line}</p>
          <p className="mt-1 font-semibold text-primary" data-reopen-prompt-item="">{item.title}</p>
          <p className="mt-2 text-sm text-tertiary">{COPY.FORMS.REOPEN_BODY}</p>
        </div>
        <div className="p-4 sm:p-6 border-t border-border flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          {actions.discard && (
            <button type="button" onClick={() => void discard()} disabled={busy !== null} className={`${btn} sm:mr-auto text-red-600 dark:text-red-400`} data-reopen-discard="">
              {busy === 'discard' ? 'Discarding…' : 'Discard'}
            </button>
          )}
          <button type="button" onClick={close} className={btn} data-reopen-later="">Not now</button>
          {actions.finish && (
            <button type="button" onClick={() => void finish()} disabled={busy !== null} className={btn} data-reopen-finish="">
              {busy === 'finish' ? 'Finishing…' : 'Finish'}
            </button>
          )}
          <button type="button" onClick={resume} className="px-4 py-2 min-h-[44px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover" data-reopen-resume="">
            Resume
          </button>
        </div>
      </div>
    </div>
  );
}
