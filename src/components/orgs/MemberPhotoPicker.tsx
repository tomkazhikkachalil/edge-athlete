'use client';

import { useCallback, useEffect, useState } from 'react';

// The manager's candidate browser (M2, program 10): "Round photos from
// members" — photos on PUBLIC golf round posts by members who opted in,
// with Add / Remove per photo. Thumbnails ride the signed proxy (the
// manager is signed in). The site gate re-decides each pick at read
// time, so a member revoking or hiding a post drops it without a click.

interface Candidate {
  mediaId: string;
  postId: string;
  authorName: string;
  url: string;
  date: string | null;
  courseName: string | null;
  picked: boolean;
}

export default function MemberPhotoPicker({
  clubId,
  onError,
}: {
  clubId: string;
  onError: (message: string) => void;
}) {
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/site/photo-candidates`);
      if (!res.ok) return;
      const body = (await res.json()) as { candidates: Candidate[] };
      setItems(body.candidates);
    } catch {
      /* stays hidden */
    }
  }, [clubId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/site/photo-candidates`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { candidates: Candidate[] };
        if (!cancelled) setItems(body.candidates);
      } catch {
        /* stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  const toggle = async (c: Candidate) => {
    setBusy(c.mediaId);
    try {
      const res = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/site`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: c.picked ? 'remove_gallery_pick' : 'set_gallery_pick', mediaId: c.mediaId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        onError(body.error || 'Failed to update the gallery');
        return;
      }
      setItems(list => (list ?? []).map(x => (x.mediaId === c.mediaId ? { ...x, picked: !c.picked } : x)));
      void load();
    } catch {
      onError('Failed to update the gallery');
    } finally {
      setBusy(null);
    }
  };

  const picked = (items ?? []).filter(c => c.picked).length;
  return (
    <div className="pt-2 space-y-1.5" data-photo-candidates={items?.length ?? -1} data-photo-picks={picked}>
      <p className="text-sm font-medium text-primary">Round photos from members</p>
      <p className="text-xs text-tertiary">
        Photos from members who switched on sharing, taken from their public round posts. Add the ones you want on the
        gallery; a member switching off, or hiding the post, removes it automatically.
      </p>
      {items === null ? null : items.length === 0 ? (
        <p className="text-sm text-tertiary">No member photos yet — members opt in from the club page.</p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map(c => (
            <li key={c.mediaId} className="min-w-0" data-candidate={c.mediaId} data-picked={c.picked ? '1' : '0'}>
              {/* eslint-disable-next-line @next/next/no-img-element -- signed-proxy bytes, manager-only; not an optimizable public asset */}
              <img src={c.url} alt="" loading="lazy" className="aspect-square w-full object-cover rounded-lg border border-border" />
              <p className="mt-1 text-xs text-secondary truncate">
                {[c.authorName, c.courseName, c.date].filter(Boolean).join(' · ')}
              </p>
              <button
                type="button"
                disabled={busy === c.mediaId}
                onClick={() => toggle(c)}
                aria-label={`${c.picked ? 'Remove from' : 'Add to'} gallery: ${c.authorName}${c.date ? ` ${c.date}` : ''}`}
                className={`mt-1 px-2 py-1 text-xs rounded-md transition-colors disabled:opacity-50 ${
                  c.picked
                    ? 'border border-border-strong text-secondary hover:bg-surface-sunken'
                    : 'bg-brand text-white hover:bg-brand-hover'
                }`}
              >
                {c.picked ? 'Remove from gallery' : 'Add to gallery'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
