'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';

// ── Contest media entry for ONE contest (phase 4 R3) ────────────────────────
// The PlayerStatsPanel pattern: mounted inside a contest row's expander on
// the competition console, owner AND participant views (the server
// resolves authority; participants see only their club's roster in the
// tag picker, and only the owner sees the gallery-publish toggle). Bytes
// render through the signed proxy URLs the API returns. A degraded read
// (pre-158 database) renders a quiet unavailable note.

interface MediaTag {
  profileId: string;
  displayName: string;
}

interface MediaItem {
  id: string;
  mediaType: 'image' | 'video';
  caption: string | null;
  published: boolean;
  url: string | null;
  tags: MediaTag[];
}

interface MediaResponse {
  mediaAvailable: boolean;
  access: 'owner' | 'participant';
  media: MediaItem[];
  rosterByTeam: Record<
    string,
    { teamName: string; athletes: { profileId: string; displayName: string }[] }
  >;
}

export default function ContestMediaPanel({
  base,
  contestId,
}: {
  /** `/api/{plural}/{orgId}/competitions/{competitionId}` */
  base: string;
  contestId: string;
}) {
  const { showSuccess, showError } = useToast();
  const [data, setData] = useState<MediaResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${base}/media?contestId=${encodeURIComponent(contestId)}`);
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const body = (await res.json()) as MediaResponse;
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, contestId, reloadKey]);

  const refresh = () => setReloadKey(k => k + 1);

  const act = async (doIt: () => Promise<Response>, okMsg: string, failMsg: string) => {
    setBusy(true);
    try {
      const res = await doIt();
      const body = await res.json();
      if (!res.ok) {
        showError('Game media', body.error || failMsg);
        return;
      }
      showSuccess('Game media', okMsg);
      refresh();
    } catch {
      showError('Game media', failMsg);
    } finally {
      setBusy(false);
    }
  };

  if (failed) {
    return <p className="mt-2 text-xs text-tertiary">Game media isn’t available.</p>;
  }
  if (!data) {
    return <p className="mt-2 text-xs text-tertiary">Loading game media…</p>;
  }
  if (!data.mediaAvailable) {
    return (
      <p className="mt-2 text-xs text-tertiary">Game media isn’t set up yet (migration 158).</p>
    );
  }

  const upload = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('contestId', contestId);
    await act(
      () => fetch(`${base}/media`, { method: 'POST', body: form }),
      'Media uploaded',
      'Failed to upload'
    );
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="mt-2 space-y-3 border-t border-border-subtle pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
          aria-label="Upload game media"
          disabled={busy}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          className="text-xs text-secondary"
        />
      </div>

      {data.media.length === 0 ? (
        <p className="text-xs text-tertiary">No media on this game yet.</p>
      ) : (
        <ul className="space-y-3">
          {data.media.map(item => (
            <li key={item.id} className="flex flex-wrap items-start gap-3">
              {item.url ? (
                item.mediaType === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element -- proxy bytes, viewer-authorized per request; not an optimizable public asset
                  <img
                    src={item.url}
                    alt={item.caption ?? 'Game media'}
                    className="w-24 h-24 object-cover rounded-lg border border-border"
                  />
                ) : (
                  <video src={item.url} className="w-24 h-24 object-cover rounded-lg border border-border" />
                )
              ) : (
                <div className="w-24 h-24 rounded-lg border border-border bg-surface-sunken" />
              )}
              <div className="flex-1 min-w-0 space-y-1.5">
                {item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {item.tags.map(tag => (
                      <span
                        key={tag.profileId}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-secondary"
                      >
                        <span className="truncate">{tag.displayName}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () =>
                                fetch(
                                  `${base}/media/tags?mediaId=${encodeURIComponent(item.id)}&profileId=${encodeURIComponent(tag.profileId)}`,
                                  { method: 'DELETE' }
                                ),
                              'Tag removed',
                              'Failed to remove the tag'
                            )
                          }
                          aria-label={`Remove tag ${tag.displayName}`}
                          className="text-muted hover:text-red-600"
                        >
                          <i className="fas fa-xmark" aria-hidden="true"></i>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <select
                  value=""
                  disabled={busy}
                  onChange={e => {
                    const profileId = e.target.value;
                    if (!profileId) return;
                    void act(
                      () =>
                        fetch(`${base}/media/tags`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ mediaId: item.id, profileIds: [profileId] }),
                        }),
                      'Athlete tagged',
                      'Failed to tag'
                    );
                  }}
                  aria-label="Tag an athlete"
                  className="max-w-full px-2 py-1 text-xs border border-border-strong rounded-md outline-none"
                >
                  <option value="">+ Tag athlete…</option>
                  {Object.entries(data.rosterByTeam).map(([teamId, team]) => (
                    <optgroup key={teamId} label={team.teamName}>
                      {team.athletes
                        .filter(a => !item.tags.some(t => t.profileId === a.profileId))
                        .map(a => (
                          <option key={a.profileId} value={a.profileId}>
                            {a.displayName}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <div className="flex flex-wrap gap-2">
                  {data.access === 'owner' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () =>
                            fetch(`${base}/media`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ mediaId: item.id, published: !item.published }),
                            }),
                          item.published ? 'Removed from the gallery pool' : 'Marked for the gallery',
                          'Failed to update'
                        )
                      }
                      className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                    >
                      {item.published ? 'Unpublish' : 'Publish to gallery'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () =>
                          fetch(`${base}/media?mediaId=${encodeURIComponent(item.id)}`, {
                            method: 'DELETE',
                          }),
                        'Media deleted',
                        'Failed to delete'
                      )
                    }
                    aria-label="Delete media"
                    className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-red-600"
                  >
                    <i className="fas fa-trash" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
