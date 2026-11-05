'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import HighlightList from '@/components/videos/HighlightList';
import YouTubePlayer from '@/components/videos/YouTubePlayer';
import { useAuth } from '@/lib/auth';
import { backOr } from '@/lib/nav-back';
import { VIDEO_DESCRIPTION_MAX, VIDEO_TITLE_MAX, type HighlightInput } from '@/lib/videos/rules';
import type { HighlightRow, VideoView } from '@/lib/videos/types';
import { SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';

type Load =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'error' }
  | { state: 'ready'; video: VideoView; highlights: HighlightRow[]; canManage: boolean };

const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';
const FIELD = 'w-full border border-border-strong rounded-lg px-3 min-h-[44px] text-base bg-surface text-primary';

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

function ownerHref(v: VideoView): string {
  return v.owner.kind === 'org' ? `/${v.owner.side}/${v.owner.id}` : `/athlete/${v.owner.id}`;
}

const PLACE_PATH: Record<NonNullable<VideoView['place']>['kind'], string> = {
  sport_event: '/events/',
  contest: '/event/',
  round: '/live/',
  activity: '/activities/',
  workout: '/app/workout/',
};

function placeHref(v: VideoView): string | null {
  if (!v.place) return null;
  return `${PLACE_PATH[v.place.kind]}${v.place.id}`;
}

/**
 * A video as a place (Videos program, 296): the player, who it belongs to
 * and where it was played, the highlights in time order, and — for whoever
 * manages it — the edits (title, description, Only me / Managers only,
 * delete) and the markers. Viewer-dependent, so the page is a shell and
 * this fetches with the session; a signed-out visitor of a public owner is
 * welcome. A refusal is the same "not available" as not-found.
 */
export default function VideoScreen({ videoId }: { videoId: string }) {
  const router = useRouter();
  const { user, initialAuthCheckComplete } = useAuth();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [startMs, setStartMs] = useState<number | null>(null);
  const [playKey, setPlayKey] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', description: '', sport_key: '' });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fetchVideo = useCallback(async (): Promise<Load> => {
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}`, { cache: 'no-store' });
      if (res.status === 404) return { state: 'missing' };
      if (!res.ok) return { state: 'error' };
      const body = (await res.json()) as { video: VideoView; highlights: HighlightRow[]; can_manage: boolean };
      return { state: 'ready', video: body.video, highlights: body.highlights, canManage: body.can_manage };
    } catch {
      return { state: 'error' };
    }
  }, [videoId]);

  // The session decides what the API answers: fetch once the auth check has
  // settled, and again when the user changes (a login on this page).
  const viewerId = user?.id ?? null;
  useEffect(() => {
    if (!initialAuthCheckComplete) return;
    let live = true;
    void fetchVideo().then(next => {
      if (live) setLoad(next);
    });
    return () => {
      live = false;
    };
  }, [initialAuthCheckComplete, viewerId, fetchVideo]);

  const play = (h: HighlightRow) => {
    setStartMs(h.start_ms);
    setActiveId(h.id);
    setPlayKey(k => k + 1);
  };

  const patchVideo = async (patch: Record<string, unknown>): Promise<string | null> => {
    const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (!res.ok) return readError(res);
    const body = (await res.json()) as { video: VideoView; highlights: HighlightRow[] };
    setLoad(prev => (prev.state === 'ready' ? { ...prev, video: body.video, highlights: body.highlights } : prev));
    return null;
  };

  const withHighlights = (res: Response) => async (): Promise<string | null> => {
    if (!res.ok) return readError(res);
    const body = (await res.json()) as { highlights: HighlightRow[] };
    setLoad(prev => (prev.state === 'ready' ? { ...prev, highlights: body.highlights, video: { ...prev.video, highlight_count: body.highlights.length } } : prev));
    return null;
  };

  const addHighlight = async (input: HighlightInput) => {
    const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/highlights`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    return withHighlights(res)();
  };
  const editHighlight = async (id: string, input: HighlightInput) => {
    const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/highlights/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    return withHighlights(res)();
  };
  const deleteHighlight = async (id: string) => {
    const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/highlights/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (activeId === id) setActiveId(null);
    return withHighlights(res)();
  };

  const startEdit = (v: VideoView) => {
    setDraft({ title: v.title, description: v.description ?? '', sport_key: v.sport_key ?? '' });
    setNote(null);
    setEditing(true);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) {
      setNote('Give the video a title.');
      return;
    }
    setSaving(true);
    const err = await patchVideo({ title: draft.title.trim(), description: draft.description.trim() || null, sport_key: draft.sport_key || null });
    setSaving(false);
    if (err) {
      setNote(err);
      return;
    }
    setEditing(false);
    setNote(null);
  };

  const toggleHidden = async (v: VideoView) => {
    setSaving(true);
    const err = await patchVideo({ status: v.status === 'hidden' ? 'published' : 'hidden' });
    setSaving(false);
    setNote(err);
  };

  // Phase 3: the duration (and whatever else the Data API knows) through the owner's YouTube connection.
  const refreshFromYouTube = async () => {
    setSaving(true);
    setNote(null);
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/refresh`, { method: 'POST' });
      if (!res.ok) {
        setNote(res.status === 404 ? 'Connect a YouTube channel on the Videos tab to read the details.' : await readError(res));
        return;
      }
      const body = (await res.json()) as { video: VideoView | null };
      if (body.video) setLoad(prev => (prev.state === 'ready' ? { ...prev, video: body.video! } : prev));
      setNote('Details refreshed from YouTube.');
    } catch {
      setNote('Could not reach YouTube. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    if (load.state !== 'ready') return;
    const home = ownerHref(load.video);
    setSaving(true);
    const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE' });
    setSaving(false);
    if (!res.ok) {
      setNote(await readError(res));
      return;
    }
    router.replace(home);
  };

  if (load.state === 'loading') {
    return (
      <div className="py-16 text-center text-sm text-muted" role="status" aria-live="polite" data-video-loading="">
        Loading video…
      </div>
    );
  }

  if (load.state === 'missing' || load.state === 'error') {
    return (
      <div className="bg-surface rounded-lg border border-border p-6 text-center" data-video-unavailable="">
        <h1 className="text-xl font-bold text-primary mb-2">{load.state === 'missing' ? 'Video not available' : 'Could not load this video'}</h1>
        <p className="text-sm text-secondary mb-4">{load.state === 'missing' ? 'It may have been removed, or it is private.' : 'Check your connection and try again.'}</p>
        <button type="button" onClick={() => backOr(router, '/feed')} className={BTN}>Back</button>
      </div>
    );
  }

  const { video, highlights, canManage } = load;
  const sport = video.sport_key ? SPORT_REGISTRY[video.sport_key as SportKey]?.display_name ?? null : null;
  const place = placeHref(video);

  return (
    <div className="space-y-4" data-video-screen={video.id}>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => backOr(router, ownerHref(video))} className="ea-icon-btn text-secondary" aria-label="Back" data-video-back="">
          <i className="fas fa-arrow-left" aria-hidden="true"></i>
        </button>
        <h1 className="text-xl sm:text-2xl font-bold text-primary min-w-0 flex-1 truncate" data-video-title="">{video.title}</h1>
        {video.status === 'hidden' && (
          <span className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full bg-surface-muted text-secondary" data-video-hidden="">
            {video.owner.kind === 'org' ? 'Managers only' : 'Only me'}
          </span>
        )}
      </div>

      <YouTubePlayer videoId={video.provider_video_id} title={video.title} startMs={startMs} playKey={playKey} />

      <div className="bg-surface rounded-lg border border-border p-4 sm:p-6 space-y-3" data-video-owner={video.owner.id}>
        <p className="text-sm text-secondary">
          {video.owner.kind === 'org' ? 'From ' : 'By '}
          <Link href={ownerHref(video)} className="font-semibold text-primary underline-offset-2 hover:underline">{video.owner.name}</Link>
          {video.place && place && (
            <>
              {' · '}
              <Link href={place} className="underline-offset-2 hover:underline" data-video-place={video.place.id}>{video.place.name}</Link>
            </>
          )}
          {sport && <> · {sport}</>}
        </p>
        {!editing && video.description && <p className="text-sm text-primary whitespace-pre-wrap">{video.description}</p>}
        <p className="text-xs text-muted">Hosted on YouTube. Edge Athlete links it and keeps the highlights; it never downloads or edits the video.</p>

        {canManage && !editing && (
          <div className="flex flex-wrap gap-2 pt-1" data-video-manage="">
            <button type="button" onClick={() => startEdit(video)} className={BTN} data-video-edit="">Edit</button>
            <button type="button" onClick={() => toggleHidden(video)} disabled={saving} className={BTN} data-video-toggle-hidden="">
              {video.status === 'hidden' ? 'Show' : video.owner.kind === 'org' ? 'Managers only' : 'Only me'}
            </button>
            <button type="button" onClick={() => void refreshFromYouTube()} disabled={saving} className={BTN} data-video-refresh="">Refresh from YouTube</button>
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving} className={`${BTN} text-red-600`} data-video-delete="">Delete</button>
          </div>
        )}

        {canManage && editing && (
          <form onSubmit={saveEdit} className="space-y-3" data-video-edit-form="">
            <label className="block text-sm text-secondary">
              Title
              <input className={`${FIELD} mt-1`} maxLength={VIDEO_TITLE_MAX} value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
            </label>
            <label className="block text-sm text-secondary">
              Description
              <textarea className={`${FIELD} mt-1 py-2 min-h-[88px]`} maxLength={VIDEO_DESCRIPTION_MAX} value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
            </label>
            <label className="block text-sm text-secondary">
              Sport
              <select className={`${FIELD} mt-1`} value={draft.sport_key} onChange={e => setDraft(d => ({ ...d, sport_key: e.target.value }))}>
                <option value="">No sport</option>
                {Object.values(SPORT_REGISTRY).filter(s => s.enabled).map(s => (
                  <option key={s.sport_key} value={s.sport_key}>{s.display_name}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setEditing(false); setNote(null); }} className={BTN}>Cancel</button>
              <button type="submit" disabled={saving} className="ea-cta px-4 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}
        {note && <p className="text-sm text-red-600" role="alert">{note}</p>}
      </div>

      <HighlightList
        highlights={highlights}
        canManage={canManage}
        activeId={activeId}
        onPlay={play}
        onAdd={addHighlight}
        onEdit={editHighlight}
        onDelete={deleteHighlight}
      />

      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete this video?"
        message={`"${video.title}" and its ${video.highlight_count} ${video.highlight_count === 1 ? 'highlight' : 'highlights'} will be removed from Edge Athlete. The video stays on YouTube.`}
        confirmText="Delete"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    </div>
  );
}
