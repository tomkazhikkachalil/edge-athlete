'use client';

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import PostCard from '@/components/PostCard';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/auth';
import { backOr } from '@/lib/nav-back';
import { COPY } from '@/lib/copy';
import { liveRoundPath } from '@/lib/golf/round-route';
import { refreshDrafts } from '@/hooks/useDrafts';
import AccountAudienceLine from '@/components/posts/AccountAudienceLine';
import { POST_VISIBILITY } from '@/lib/posts/audience';

// ── The review screen (Drafts round, Oct 2026) ───────────────────────────────
// After Finish, before Post. The draft's own card, a notes field (the post's
// caption — saved as you type, so backing out keeps everything), who can see
// it, and three doors: Post (the one writer, through PATCH /api/posts), Keep
// as draft (back — it stays in Drafts), Delete (the results delete rule; an
// official result refuses and says so). A round still being played shows
// Resume and Finish instead: Finish comes first.

type CardPost = ComponentProps<typeof PostCard>['post'];
type ReviewPost = CardPost & {
  status?: string;
  group_post_id?: string | null;
  group_scorecard?: { group_post: { id: string; status: string | null } } | null;
};

const SAVE_AFTER_MS = 800;
const field = 'w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-primary placeholder:text-muted';

export default function DraftReviewPage() {
  const router = useRouter();
  const params = useParams<{ postId: string }>();
  const postId = params?.postId;
  const { user, initialAuthCheckComplete } = useAuth();
  const { showSuccess, showError } = useToast();

  const [post, setPost] = useState<ReviewPost | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [busy, setBusy] = useState<'post' | 'delete' | 'finish' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const savedRef = useRef<{ caption: string; visibility: string }>({ caption: '', visibility: 'public' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The loader lives IN the effect as a cancellable IIFE (eslint.config.mjs on
  // set-state-in-effect); `reloadKey` re-runs it after Finish.
  useEffect(() => {
    if (!user || !postId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/posts?postId=${encodeURIComponent(postId)}`, { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 404) { setState('missing'); return; }
        if (!res.ok) { setState('error'); return; }
        const body = (await res.json()) as { post: ReviewPost };
        if (cancelled) return;
        setPost(body.post);
        const c = body.post.caption ?? '';
        const v = body.post.visibility === 'private' ? 'private' : 'public';
        setCaption(c);
        setVisibility(v);
        savedRef.current = { caption: c, visibility: v };
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, postId, reloadKey]);
  const load = useCallback(() => setReloadKey(k => k + 1), []);

  // Autosave: the draft keeps what you typed, whether you post, back out or
  // close the app. One PUT per pause in typing; the final one awaited by Post.
  const save = useCallback(async (next: { caption: string; visibility: string }): Promise<boolean> => {
    if (!postId) return false;
    if (next.caption === savedRef.current.caption && next.visibility === savedRef.current.visibility) return true;
    setSaved('saving');
    try {
      const res = await fetch('/api/posts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, caption: next.caption, visibility: next.visibility }),
      });
      if (!res.ok) { setSaved('failed'); return false; }
      savedRef.current = next;
      setSaved('saved');
      return true;
    } catch {
      setSaved('failed');
      return false;
    }
  }, [postId]);

  const scheduleSave = (next: { caption: string; visibility: string }) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void save(next), SAVE_AFTER_MS);
  };
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const isOwner = !!user && !!post && user.id === post.profile.id;
  const roundStatus = post?.group_scorecard?.group_post.status ?? null;
  const roundInProgress = !!post?.group_post_id && roundStatus !== 'completed' && roundStatus !== 'cancelled';
  const isDraft = post?.status === 'draft';

  const handlePost = async () => {
    if (!postId || busy) return;
    setBusy('post');
    try {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Posting writes it public: the account's privacy decides who sees it.
      if (!(await save({ caption, visibility: POST_VISIBILITY }))) { showError('Could not save your notes', 'Please try again.'); return; }
      const res = await fetch('/api/posts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId, action: 'post' }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showError('Could not post it', typeof body.error === 'string' ? body.error : 'Please try again.'); return; }
      showSuccess(COPY.FORMS.POSTED_TITLE, COPY.FORMS.POSTED_BODY);
      void refreshDrafts();
      router.replace(`/feed?post=${postId}`);
    } finally {
      setBusy(null);
    }
  };

  const handleKeep = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await save({ caption, visibility });
    backOr(router, '/athlete/drafts');
  };

  const handleDelete = async () => {
    if (!postId || busy) return;
    setConfirmDelete(false);
    setBusy('delete');
    try {
      const res = await fetch(`/api/posts?postId=${encodeURIComponent(postId)}&mode=delete`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showError('Could not delete it', typeof body.error === 'string' ? body.error : 'Please try again.'); return; }
      showSuccess(COPY.FORMS.DELETED_RESULT_TITLE, 'Nothing was posted.');
      void refreshDrafts();
      router.replace('/athlete/drafts');
    } finally {
      setBusy(null);
    }
  };

  const handleFinish = async () => {
    if (!post?.group_post_id || busy) return;
    setBusy('finish');
    try {
      const res = await fetch(`/api/group-posts/${post.group_post_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showError('Could not finish the round', typeof body.error === 'string' ? body.error : 'Please try again.'); return; }
      void refreshDrafts();
      setState('loading');
      load();
    } finally {
      setBusy(null);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-canvas" data-draft-review="">
      <AppHeader showSearch={false} />
      <div className="bg-surface border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center gap-4">
            <button onClick={() => void handleKeep()} className="text-tertiary hover:text-primary ea-icon-btn" aria-label="Back">
              <i className="fas fa-arrow-left text-xl"></i>
            </button>
            <h1 className="text-2xl font-bold text-primary">{roundInProgress ? 'Still being played' : 'Review and post'}</h1>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-6">{children}</div>
      </div>
    </div>
  );

  if (!initialAuthCheckComplete || (user && state === 'loading')) {
    return shell(<div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div></div>);
  }
  if (!user) {
    return shell(
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-primary mb-2">Sign in to review your draft</h2>
        <Link href="/" className="inline-block mt-4 px-6 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover">Sign In</Link>
      </div>,
    );
  }
  if (state === 'missing' || !post) {
    return shell(
      <div className="text-center py-12" data-draft-missing="">
        <h2 className="text-xl font-semibold text-primary mb-2">This draft is gone</h2>
        <p className="text-muted mb-4">It was posted, deleted, or it is not yours.</p>
        <Link href="/athlete/drafts" className="inline-block px-6 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover">Your drafts</Link>
      </div>,
    );
  }
  if (state === 'error') {
    return shell(<p role="alert" className="text-sm text-tertiary">Couldn&apos;t load this draft. <button type="button" className="underline" onClick={() => { setState('loading'); load(); }}>Try again</button></p>);
  }
  if (!isDraft) {
    return shell(
      <div className="text-center py-12" data-draft-already-posted="">
        <h2 className="text-xl font-semibold text-primary mb-2">Already posted</h2>
        <Link href={`/feed?post=${post.id}`} className="inline-block mt-2 px-6 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover">See the post</Link>
      </div>,
    );
  }

  return shell(
    <>
      <PostCard post={post} currentUserId={user.id} showActions={false} inReview />

      {roundInProgress ? (
        <section className="ea-surface rounded-lg p-4 sm:p-6 space-y-3" data-draft-in-progress="">
          <p className="text-sm text-secondary">{COPY.FORMS.DRAFT_IN_PROGRESS_BANNER}</p>
          <div className="flex flex-wrap gap-3">
            <Link href={liveRoundPath(post.group_post_id!)} className="px-4 py-2 min-h-[44px] inline-flex items-center rounded-lg bg-brand text-white font-semibold hover:bg-brand-hover" data-draft-resume="">Resume</Link>
            {isOwner && (
              <button type="button" onClick={() => void handleFinish()} disabled={busy !== null} className="px-4 py-2 min-h-[44px] rounded-lg border border-border bg-surface font-semibold text-primary ea-interactive disabled:opacity-50" data-draft-finish="">
                {busy === 'finish' ? 'Finishing…' : 'Finish round'}
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="ea-surface rounded-lg p-4 sm:p-6 space-y-4" aria-labelledby="draft-notes-title">
          <div>
            <label htmlFor="draft-notes" id="draft-notes-title" className="block text-sm font-semibold text-primary mb-1">Notes</label>
            <textarea
              id="draft-notes"
              value={caption}
              onChange={e => { setCaption(e.target.value); setSaved('idle'); scheduleSave({ caption: e.target.value, visibility }); }}
              rows={3}
              maxLength={2000}
              placeholder="How did it go?"
              className={field}
              data-draft-notes=""
            />
            <p className="text-xs text-tertiary mt-1" data-draft-saved={saved}>
              {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : saved === 'failed' ? 'Not saved — check your connection' : 'Saved as you type'}
            </p>
          </div>
          {/* Who sees it is the ACCOUNT's call (src/lib/posts/audience.ts) —
              said here, never a per-post choice. */}
          {isOwner && <AccountAudienceLine />}
          <div className="flex flex-wrap gap-3 pt-2">
            <button type="button" onClick={() => void handlePost()} disabled={busy !== null || !isOwner} className="px-5 py-2 min-h-[44px] rounded-lg bg-brand text-white font-semibold hover:bg-brand-hover disabled:opacity-50" data-draft-post="">
              {busy === 'post' ? 'Posting…' : 'Post'}
            </button>
            <button type="button" onClick={() => void handleKeep()} disabled={busy !== null} className="px-4 py-2 min-h-[44px] rounded-lg border border-border bg-surface font-semibold text-primary ea-interactive disabled:opacity-50" data-draft-keep="">
              Keep as draft
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy !== null || !isOwner} className="ml-auto px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50" data-draft-delete="">
              {busy === 'delete' ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </section>
      )}

      <ConfirmModal
        isOpen={confirmDelete}
        title={COPY.FORMS.DELETE_RESULT_TITLE}
        message={COPY.FORMS.DELETE_RESULT_CONFIRM}
        confirmText={COPY.FORMS.DELETE_RESULT_ACTION}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>,
  );
}
