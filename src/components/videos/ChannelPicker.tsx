'use client';

import { useEffect, useState } from 'react';
import type { ChannelUpload } from '@/lib/videos/google-youtube-server';
import FaIcon from '@/components/FaIcon';
import { faYoutubeBrands } from '@/lib/icons/fa/youtube-brands';
import { faChevronDown } from '@/lib/icons/fa/chevron-down';
import { faChevronUp } from '@/lib/icons/fa/chevron-up';
import YouTubeReconnectLink from '@/components/videos/YouTubeReconnectLink';

/**
 * "Pick from your channel" (Videos program Phase 3): the connected channel's
 * own uploads, newest first — one tap fills the link. The list is fetched
 * once the person opens it (a Link step must not pay for a Data API read
 * nobody asked for). Props only; the parent owns the chosen id.
 */
type PickerState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; uploads: ChannelUpload[] } | { status: 'error'; message: string; reconnect: boolean };

export default function ChannelPicker({ owner, onPick, returnTo, onLeave }: { owner: string; onPick: (videoId: string, title: string) => void; returnTo?: string; onLeave?: () => void }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PickerState>({ status: 'idle' });

  useEffect(() => {
    if (!open || state.status !== 'idle') return;
    let live = true;
    const fetchUploads = async (): Promise<PickerState> => {
      try {
        const res = await fetch(`/api/videos/youtube/channel-uploads?owner=${encodeURIComponent(owner)}`, { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as { uploads?: ChannelUpload[]; error?: string; reconnect?: boolean };
        if (!res.ok) return { status: 'error', message: body.error ?? 'Could not read the channel.', reconnect: body.reconnect === true };
        return { status: 'ready', uploads: body.uploads ?? [] };
      } catch {
        return { status: 'error', message: 'Could not reach YouTube.', reconnect: false };
      }
    };
    void fetchUploads().then(next => { if (live) setState(next); });
    return () => { live = false; };
  }, [open, owner, state.status]);

  return (
    <div className="rounded-lg border border-border" data-channel-picker={open ? 'open' : 'closed'}>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); if (state.status === 'idle') setState({ status: 'loading' }); }}
        className="ea-interactive flex w-full items-center gap-3 px-3 min-h-[48px] text-left"
        aria-expanded={open}
        data-channel-picker-toggle=""
      >
        <FaIcon icon={faYoutubeBrands} className="text-red-600" />
        <span className="text-sm font-semibold text-primary flex-1">Pick from your channel</span>
        <FaIcon icon={open ? faChevronUp : faChevronDown} className="text-muted" />
      </button>
      {open && (
        <div className="border-t border-border-subtle px-3 py-2">
          {(state.status === 'loading' || state.status === 'idle') && <p className="text-xs text-muted" role="status">Reading your uploads…</p>}
          {state.status === 'error' && (
            <p className="text-xs text-red-600" role="alert" data-channel-picker-error="">
              {state.message}{' '}
              {state.reconnect
                ? <YouTubeReconnectLink owner={owner} scope="readonly" returnTo={returnTo} onNavigate={onLeave} />
                : <button type="button" onClick={() => setState({ status: 'idle' })} className="underline font-semibold" data-channel-picker-retry="">Try again</button>}
            </p>
          )}
          {state.status === 'ready' && state.uploads.length === 0 && <p className="text-xs text-muted">No uploads on this channel yet.</p>}
          {state.status === 'ready' && state.uploads.length > 0 && (
            <ul className="divide-y divide-border-subtle">
              {state.uploads.map(u => (
                <li key={u.videoId}>
                  <button type="button" onClick={() => onPick(u.videoId, u.title)} className="ea-interactive flex w-full items-center gap-3 py-2 text-left min-h-[48px]" data-channel-upload={u.videoId}>
                    {u.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a third-party thumbnail; not an optimizer candidate
                      <img src={u.thumbnail} alt="" className="w-16 h-9 rounded object-cover bg-surface-muted shrink-0" />
                    ) : (
                      <span className="w-16 h-9 rounded bg-surface-muted shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm text-primary truncate">{u.title || 'Untitled'}</span>
                      {u.publishedAt && <span className="block text-xs text-muted">{new Date(u.publishedAt).toLocaleDateString()}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
