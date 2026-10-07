'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { useAuth } from '@/lib/auth';
import { backOr } from '@/lib/nav-back';
import { useDrafts, refreshDrafts } from '@/hooks/useDrafts';
import { ACTIVITY_TYPE_DEFS } from '@/lib/activities/catalog';
import { openRecordingStore } from '@/lib/activities/record/storage';
import { buildDraftsList, type DraftItem, type DraftRecordingLike } from '@/lib/drafts/list';
import DraftRow from '@/components/drafts/DraftRow';

// ── Drafts (Drafts round, Oct 2026) ──────────────────────────────────────────
// The private list of what you started or finished but have not posted:
// rounds in progress (Resume / Finish / Discard), drafts (Review / Post /
// Delete), workouts in progress, and a live activity recording waiting on
// this phone. Finish and Post are two actions; nothing here is on the feed.

export default function DraftsPage() {
  const router = useRouter();
  const { user, initialAuthCheckComplete } = useAuth();
  const snapshot = useDrafts(!!user);
  const [recording, setRecording] = useState<DraftRecordingLike | null>(null);

  useEffect(() => {
    if (!user) return;
    void refreshDrafts();
    const store = openRecordingStore();
    if (!store) return;
    let cancelled = false;
    store
      .findUnfinished(user.id, Date.now())
      .then(meta => {
        if (cancelled || !meta) return;
        setRecording({ id: meta.id, label: ACTIVITY_TYPE_DEFS[meta.type]?.label ?? 'Activity', savedAt: meta.savedAt });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!initialAuthCheckComplete) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
        </div>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold text-primary mb-2">Sign in to see your drafts</h1>
          <Link href="/" className="inline-block mt-4 px-6 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover">Sign In</Link>
        </div>
      </div>
    );
  }

  // The phone's own recording joins the server's list here (the server never sees it).
  const list = recording
    ? buildDraftsList({ rounds: [], workouts: [], recording })
    : { inProgress: [], drafts: [] };
  const inProgress: DraftItem[] = [...list.inProgress, ...snapshot.inProgress];
  const drafts = snapshot.drafts;
  const total = inProgress.length + drafts.length;

  return (
    <div className="min-h-screen bg-canvas" data-drafts-page="">
      <AppHeader showSearch={false} />
      <div className="bg-surface border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center gap-4 mb-2">
            <button onClick={() => backOr(router, '/athlete')} className="text-tertiary hover:text-primary ea-icon-btn" aria-label="Back">
              <i className="fas fa-arrow-left text-xl"></i>
            </button>
            <h1 className="text-2xl font-bold text-primary">Drafts</h1>
          </div>
          <p className="text-sm text-tertiary ml-12">
            {total === 0 ? 'Nothing waiting' : `${total} ${total === 1 ? 'thing' : 'things'} not posted yet`} · only you can see this
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-8">
          {total === 0 && (
            <div className="text-center py-12" data-drafts-empty="">
              <i className="far fa-pen-to-square text-6xl text-gray-300 mb-4"></i>
              <h2 className="text-xl font-semibold text-secondary mb-2">No drafts</h2>
              <p className="text-muted">
                A round you are playing, or one you finished but have not posted, waits here. Nothing is posted until you tap Post.
              </p>
            </div>
          )}
          {inProgress.length > 0 && (
            <section aria-labelledby="drafts-in-progress" data-drafts-in-progress="">
              <h2 id="drafts-in-progress" className="text-lg font-semibold text-primary mb-3">In progress</h2>
              <ul className="ea-surface rounded-lg divide-y divide-border">
                {inProgress.map(item => (
                  <DraftRow key={`${item.kind}:${item.id}`} item={item} onChanged={() => void refreshDrafts()} />
                ))}
              </ul>
            </section>
          )}
          {drafts.length > 0 && (
            <section aria-labelledby="drafts-ready" data-drafts-ready="">
              <h2 id="drafts-ready" className="text-lg font-semibold text-primary mb-3">Ready to post</h2>
              <ul className="ea-surface rounded-lg divide-y divide-border">
                {drafts.map(item => (
                  <DraftRow key={`${item.kind}:${item.id}`} item={item} onChanged={() => void refreshDrafts()} />
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
