'use client';

import { useCallback, useEffect, useState } from 'react';
import LazyImage from '@/components/LazyImage';
import CaptureInputs from '@/components/media/CaptureInputs';
import MediaLightbox from '@/components/media/MediaLightbox';
import type { CollageItem } from '@/components/media/MediaCollage';
import { useAuth } from '@/lib/auth';
import { planCaptureAttach } from '@/lib/media/capture-attach';
import { capturePoster } from '@/lib/media/poster';
import { uploadPostMedia } from '@/lib/media/upload';
import { validateFiles } from '@/lib/media/validation';
import type { EventApi } from '@/lib/sport-events/client';
import type { EventMediaView } from '@/lib/sport-events/media';
import type { SportEventViewPayload } from '@/lib/sport-events/view';

interface Props {
  view: SportEventViewPayload;
  api: EventApi;
  version: number;
}

const LIVE_POLL_MS = 10_000;
const MAX_BYTES = 50 * 1024 * 1024;
const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

/**
 * The Gallery tab (Events program, phase 4, 216): every photo / video on
 * the event, newest first, polled 10 s while live; "Add" for anyone who
 * joined (playing or following) or an organizer — Capture v2: the capture
 * ATTACHES first (`planCaptureAttach`), uploads through `uploadPostMedia`
 * (a video gets a poster), then one POST per file; tap a tile → the
 * lightbox; remove = the uploader's or an organizer's.
 */
export default function EventGalleryTab({ view, api, version }: Props) {
  const { user } = useAuth();
  const [media, setMedia] = useState<EventMediaView[]>([]);
  const [canAdd, setCanAdd] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const live = view.event.status === 'live';
  const liveRound = view.rounds.find(r => r.status === 'live') ?? null;

  const load = useCallback(async () => {
    const res = await api.media();
    if (res.ok && res.data) { setMedia(res.data.media); setCanAdd(res.data.can_add); setState('ready'); } else setState('error');
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    const run = () => { if (!cancelled) void load(); };
    run();
    if (!live) return () => { cancelled = true; };
    const t = window.setInterval(run, LIVE_POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [load, live, version, user?.id]);

  const onFiles = async (list: FileList) => {
    setNote(null);
    const { accepted, rejected } = validateFiles(Array.from(list), { maxBytes: MAX_BYTES, allowVideo: true, maxCount: 10 });
    const plan = planCaptureAttach(accepted);
    const notes: string[] = [];
    if (rejected.length > 0) notes.push(`${rejected.length} file${rejected.length === 1 ? ' was' : 's were'} skipped (type or size).`);
    if (plan.editor.length > 0) notes.push('HEIC photos need converting first — add them from the post composer.');
    setBusy(b => b + plan.attach.length);
    try {
      for (const file of plan.attach) {
        try {
          const up = await uploadPostMedia(file);
          let thumbnail: string | null = null;
          if (up.type === 'video') {
            try {
              const poster = await capturePoster(file, 0.5);
              thumbnail = (await uploadPostMedia(new File([poster], 'poster.jpg', { type: 'image/jpeg' }))).url;
            } catch { /* a clip without a poster is still the clip */ }
          }
          const res = await api.addMedia({ media_url: up.url, media_type: up.type, thumbnail_url: thumbnail, round_id: liveRound?.id ?? null });
          if (!res.ok) notes.push(res.error ?? 'Could not add a file.');
        } catch {
          notes.push('An upload failed.');
        } finally {
          setBusy(b => Math.max(0, b - 1));
        }
      }
    } finally {
      if (notes.length > 0) setNote(notes.join(' '));
      await load();
    }
  };

  const remove = async (id: string) => {
    setConfirmRemove(null);
    const res = await api.removeMedia(id);
    if (!res.ok) setNote(res.error ?? 'Could not remove it.');
    await load();
  };

  const items: CollageItem[] = media.map(m => ({ id: m.id, url: m.media_url, kind: m.media_type, thumbnailUrl: m.thumbnail_url, durationSeconds: m.duration_seconds, alt: m.caption ?? `Photo by ${m.uploader.name}` }));

  return (
    <div className="space-y-4" data-event-gallery="">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-secondary">{media.length === 0 ? (state === 'ready' ? 'No photos yet.' : '') : `${media.length} ${media.length === 1 ? 'item' : 'items'}`}{live ? ' · live' : ''}</p>
        {canAdd && user && (
          <CaptureInputs onFiles={f => { void onFiles(f); }} allowVideo>
            {controls => (
              <div className="flex gap-2">
                <button type="button" onClick={controls.openPhoto} disabled={busy > 0} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center" data-event-media-add="">
                  <i className="fas fa-camera mr-2" aria-hidden="true"></i>{busy > 0 ? `Adding ${busy}…` : 'Add'}
                </button>
                <button type="button" onClick={controls.openVideo} disabled={busy > 0} className={BTN} aria-label="Add a video" data-event-media-add-video="">
                  <i className="fas fa-video" aria-hidden="true"></i>
                </button>
              </div>
            )}
          </CaptureInputs>
        )}
        {!user && <p className="text-xs text-muted">Log in to add photos.</p>}
      </div>
      {note && <p role="status" className="text-sm text-amber-800 dark:text-amber-200" data-event-media-note="">{note}</p>}
      {state === 'error' && <p className="text-sm text-red-700 dark:text-red-300">Could not load the gallery.</p>}
      {media.length > 0 && (
        <ul className="grid grid-cols-3 gap-1 sm:gap-2" data-event-media-grid="">
          {media.map((m, i) => (
            <li key={m.id} className="relative aspect-square">
              <button type="button" onClick={() => setOpen(i)} className="block w-full h-full overflow-hidden rounded-md bg-surface-muted" data-event-media-tile={m.id} aria-label={m.caption ?? `Open photo by ${m.uploader.name}`}>
                {m.media_type === 'image' || m.thumbnail_url ? (
                  <LazyImage src={m.media_type === 'image' ? m.media_url : (m.thumbnail_url as string)} alt="" className="w-full h-full object-cover" width={300} height={300} />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-secondary"><i className="fas fa-play text-2xl" aria-hidden="true"></i></span>
                )}
                {m.media_type === 'video' && <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-bold"><i className="fas fa-play mr-1" aria-hidden="true"></i>Video</span>}
              </button>
              {m.can_remove && (
                confirmRemove === m.id ? (
                  <span className="absolute top-1 right-1 flex gap-1">
                    <button type="button" onClick={() => { void remove(m.id); }} className="px-2 min-h-[32px] rounded-md bg-red-600 text-white text-xs font-semibold" data-event-media-remove-confirm={m.id}>Remove</button>
                    <button type="button" onClick={() => setConfirmRemove(null)} className="px-2 min-h-[32px] rounded-md bg-black/60 text-white text-xs font-semibold">Keep</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmRemove(m.id)} className="absolute top-1 right-1 w-8 h-8 rounded-full bg-black/60 text-white text-xs flex items-center justify-center" aria-label="Remove" data-event-media-remove={m.id}>
                    <i className="fas fa-times" aria-hidden="true"></i>
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {open !== null && items[open] && (
        <MediaLightbox items={items} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} footerFor={item => { const m = media.find(x => x.id === item.id); return m ? <span>{m.caption ? `${m.caption} · ` : ''}{m.uploader.name}</span> : null; }} />
      )}
    </div>
  );
}
