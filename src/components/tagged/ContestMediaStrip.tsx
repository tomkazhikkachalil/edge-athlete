'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '../ConfirmModal';
import { useToast } from '../Toast';

// ── Team media on the Tagged tab (phase 4 R3) ───────────────────────────────
// Org-uploaded contest media this athlete is actively tagged in — a
// distinct labeled section ABOVE the post grid, never fake post tiles
// (contest media is not a post; forcing it into the post-tile contract
// would break the ?post= modal). Bytes ride the signed proxy. Untag
// (owner or guardian, per the API) tombstones — the org can't re-add.
// Renders nothing when the athlete has no team media (or pre-158).

interface StripItem {
  id: string;
  mediaType: 'image' | 'video';
  caption: string | null;
  url: string | null;
  date: string | null;
  competitionName: string | null;
  canUntag: boolean;
}

export default function ContestMediaStrip({ profileId }: { profileId: string }) {
  const { showSuccess, showError } = useToast();
  const [items, setItems] = useState<StripItem[]>([]);
  const [untagging, setUntagging] = useState<StripItem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/profile/${profileId}/contest-media`, { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (!cancelled && body?.items) setItems(body.items);
      })
      .catch(() => {
        // A section that can't load renders nothing (the house convention).
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, reloadKey]);

  if (items.length === 0) return null;

  const untag = async (item: StripItem) => {
    try {
      const res = await fetch(
        `/api/profile/${profileId}/contest-media?mediaId=${encodeURIComponent(item.id)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      const body = await res.json();
      if (!res.ok) {
        showError('Team media', body.error || 'Failed to remove the tag');
        return;
      }
      showSuccess('Team media', 'Tag removed');
      setReloadKey(k => k + 1);
    } catch {
      showError('Team media', 'Failed to remove the tag');
    }
  };

  return (
    <section aria-label="Team media">
      <h3 className="text-sm font-semibold text-secondary mb-2">
        <i className="fas fa-shield-halved mr-1.5 text-brand-fg" aria-hidden="true"></i>
        Team media
      </h3>
      <ul className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
        {items.map(item => (
          <li key={item.id} className="relative group">
            {item.url ? (
              item.mediaType === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element -- proxy bytes, viewer-authorized per request; not an optimizable public asset
                <img
                  src={item.url}
                  alt={item.caption ?? item.competitionName ?? 'Team media'}
                  className="aspect-square w-full object-cover rounded-lg border border-border"
                />
              ) : (
                <video
                  src={item.url}
                  className="aspect-square w-full object-cover rounded-lg border border-border"
                />
              )
            ) : (
              <div className="aspect-square w-full rounded-lg border border-border bg-surface-sunken" />
            )}
            <p className="mt-1 text-[11px] text-muted truncate">
              {item.competitionName ?? 'Team media'}
              {item.date ? ` · ${item.date.slice(0, 10)}` : ''}
            </p>
            {item.canUntag && (
              <button
                type="button"
                onClick={() => setUntagging(item)}
                aria-label="Remove yourself from this media"
                className="absolute top-1 right-1 ea-icon-btn inline-flex items-center justify-center bg-surface/90 text-secondary hover:text-red-600"
              >
                <i className="fas fa-user-xmark text-xs" aria-hidden="true"></i>
              </button>
            )}
          </li>
        ))}
      </ul>

      <ConfirmModal
        isOpen={!!untagging}
        title="Remove this tag?"
        message="The photo stays in the team's library, but it leaves this profile and can't be re-tagged."
        confirmText="Remove tag"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => {
          const target = untagging;
          setUntagging(null);
          if (target) void untag(target);
        }}
        onCancel={() => setUntagging(null)}
      />
    </section>
  );
}
