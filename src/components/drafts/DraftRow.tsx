'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import { COPY } from '@/lib/copy';
import { draftReviewHref, type DraftItem } from '@/lib/drafts/list';

// ── One row of the Drafts list (Drafts round, Oct 2026) ──────────────────────
// In progress: Resume (the live page / the workout / the recorder); a round's
// creator also gets Finish (→ the review screen) and Discard (nothing was
// posted; a scored round's scores go with it — the same confirm the live page
// uses). A draft: Review (the screen) and Post (the one writer, through the
// same PATCH the review screen uses).

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const KIND_ICON: Record<DraftItem['kind'], string> = { round: 'fa-golf-ball-tee', workout: 'fa-dumbbell', recording: 'fa-person-walking' };
const btn = 'px-3 py-2 min-h-[44px] rounded-lg border border-border bg-surface text-sm font-semibold text-primary ea-interactive disabled:opacity-50';
const cta = 'px-3 py-2 min-h-[44px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover disabled:opacity-50';

export default function DraftRow({ item, onChanged }: { item: DraftItem; onChanged: () => void }) {
  const router = useRouter();
  const { showSuccess, showError } = useToast();
  const [busy, setBusy] = useState<'finish' | 'discard' | 'post' | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const finishRound = async () => {
    setBusy('finish');
    try {
      const res = await fetch(`/api/group-posts/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showError('Could not finish the round', typeof body.error === 'string' ? body.error : 'Please try again.'); return; }
      onChanged();
      if (item.postId) router.push(draftReviewHref(item.postId));
    } finally {
      setBusy(null);
    }
  };

  const discardRound = async () => {
    setConfirmDiscard(false);
    setBusy('discard');
    try {
      const res = await fetch(`/api/group-posts/${item.id}?mode=delete`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showError('Could not discard the round', typeof body.error === 'string' ? body.error : 'Please try again.'); return; }
      showSuccess('Discarded', 'Nothing was posted.');
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const keepPrivate = async () => {
    setBusy('post');
    try {
      const res = await fetch(`/api/workouts/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepPrivate: true }) });
      if (!res.ok) { showError('Could not save that', 'Please try again.'); return; }
      showSuccess('Kept private', 'It stays in your history, off the feed.');
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const postDraft = async () => {
    if (!item.postId) return;
    setBusy('post');
    try {
      const res = await fetch('/api/posts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: item.postId, action: 'post' }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { showError('Could not post it', typeof body.error === 'string' ? body.error : 'Please try again.'); return; }
      showSuccess(COPY.FORMS.POSTED_TITLE, COPY.FORMS.POSTED_BODY);
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const date = when(item.lastActivityAt) || when(item.startedAt);
  const stateLine = item.state === 'in_progress'
    ? (item.kind === 'recording' ? 'Waiting on this phone' : item.kind === 'workout' ? 'Workout in progress' : item.isCreator ? 'Being played' : 'Being played · you are a player')
    : (item.kind === 'workout' ? 'Finished · not shared' : 'Finished · not posted');

  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-3 p-4" data-draft-row={`${item.kind}:${item.id}`} data-draft-state={item.state}>
      <i className={`fas ${KIND_ICON[item.kind]} text-tertiary w-5 text-center hidden sm:block`} aria-hidden="true"></i>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-primary truncate">{item.title}</p>
        <p className="text-sm text-tertiary">{stateLine}{date ? ` · ${date}` : ''}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {item.state === 'in_progress' ? (
          <>
            <Link href={item.href} className={cta} data-draft-resume="">Resume</Link>
            {item.kind === 'round' && item.isCreator && (
              <>
                {item.scored && (
                  <button type="button" className={btn} disabled={busy !== null} onClick={() => void finishRound()} data-draft-finish="">
                    {busy === 'finish' ? 'Finishing…' : 'Finish'}
                  </button>
                )}
                <button type="button" className={btn} disabled={busy !== null} onClick={() => setConfirmDiscard(true)} data-draft-discard="">
                  {busy === 'discard' ? 'Discarding…' : 'Discard'}
                </button>
              </>
            )}
          </>
        ) : item.kind === 'workout' ? (
          <>
            <button type="button" className={btn} disabled={busy !== null} onClick={() => void keepPrivate()} data-draft-keep-private="">
              {busy === 'post' ? 'Saving…' : 'Keep private'}
            </button>
            <Link href={item.href} className={cta} data-draft-share="">Share</Link>
          </>
        ) : (
          <>
            <Link href={item.href} className={btn} data-draft-review="">Review</Link>
            <button type="button" className={cta} disabled={busy !== null} onClick={() => void postDraft()} data-draft-post="">
              {busy === 'post' ? 'Posting…' : 'Post'}
            </button>
          </>
        )}
      </div>
      <ConfirmModal
        isOpen={confirmDiscard}
        title={COPY.FORMS.DELETE_ROUND_TITLE}
        message={COPY.FORMS.DISCARD_ROUND_CONFIRM}
        confirmText={COPY.FORMS.DELETE_ROUND_ACTION}
        onConfirm={() => void discardRound()}
        onCancel={() => setConfirmDiscard(false)}
      />
    </li>
  );
}
