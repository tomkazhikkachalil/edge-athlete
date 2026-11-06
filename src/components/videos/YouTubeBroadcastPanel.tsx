'use client';

import { useState } from 'react';
import { formatLiveWhen } from '@/lib/videos/live-rules';
import { defaultBroadcastStart, UPLOAD_PRIVACIES, UPLOAD_TITLE_MAX, type UploadPrivacy } from '@/lib/videos/youtube-connection';

const FIELD = 'w-full border border-border-strong rounded-lg px-3 min-h-[44px] text-base bg-surface text-primary';
const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

type Scheduled = { videoId: string; title: string; streamKey: string; rtmpsUrl: string | null; rtmpUrl: string | null; studioUrl: string; scheduledStartAt: string };

/**
 * "Schedule a live broadcast" (Videos program Phase 4b): the server creates
 * the broadcast, one stream and the bind on the connected channel under the
 * `live` scope; the STREAM KEY is shown here ONCE — the panel never stores
 * it, never logs it — with Copy buttons and two doors (YouTube Studio; an
 * encoder). Edge Athlete never captures a stream: the person points their
 * encoder or Studio at the key. Continue hands the parent the id; the row
 * is an ordinary link, and Phase 4a's first read makes it upcoming.
 */
export default function YouTubeBroadcastPanel({ owner, initialTitle = '', onScheduled, onNeedsScope }: { owner: string; initialTitle?: string; onScheduled: (videoId: string, title: string) => void; onNeedsScope: () => void }) {
  const [title, setTitle] = useState(initialTitle.slice(0, UPLOAD_TITLE_MAX));
  const [startLocal, setStartLocal] = useState(() => defaultBroadcastStart());
  const [minLocal] = useState(() => defaultBroadcastStart(new Date(Date.now() - 3_600_000)));
  const [privacy, setPrivacy] = useState<UploadPrivacy>('unlisted');
  const [phase, setPhase] = useState<{ kind: 'idle' } | { kind: 'scheduling' } | { kind: 'error'; message: string } | { kind: 'scheduled'; value: Scheduled }>({ kind: 'idle' });
  const [copied, setCopied] = useState<'key' | 'url' | null>(null);
  const [encoder, setEncoder] = useState(false);

  const schedule = async () => {
    const at = Date.parse(startLocal);
    if (!title.trim() || Number.isNaN(at)) return;
    setPhase({ kind: 'scheduling' });
    try {
      const res = await fetch('/api/videos/youtube/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, title: title.trim(), scheduledStartAt: new Date(at).toISOString(), privacy }),
      });
      const body = (await res.json().catch(() => ({}))) as { video_id?: string; stream_key?: string; rtmps_url?: string | null; rtmp_url?: string | null; studio_url?: string; scheduled_start_at?: string; error?: string; needs_scope?: string };
      if (res.status === 409 && body.needs_scope === 'live') { setPhase({ kind: 'idle' }); onNeedsScope(); return; }
      if (!res.ok || !body.video_id || !body.stream_key || !body.studio_url) { setPhase({ kind: 'error', message: body.error ?? 'YouTube did not create the broadcast.' }); return; }
      setPhase({ kind: 'scheduled', value: { videoId: body.video_id, title: title.trim(), streamKey: body.stream_key, rtmpsUrl: body.rtmps_url ?? null, rtmpUrl: body.rtmp_url ?? null, studioUrl: body.studio_url, scheduledStartAt: body.scheduled_start_at ?? new Date(at).toISOString() } });
    } catch {
      setPhase({ kind: 'error', message: 'The broadcast could not be scheduled. Check your connection and try again.' });
    }
  };

  const copy = async (what: 'key' | 'url', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  if (phase.kind === 'scheduled') {
    const v = phase.value;
    const ingest = v.rtmpsUrl ?? v.rtmpUrl;
    return (
      <div className="rounded-lg border border-border p-3 space-y-3" data-youtube-broadcast="scheduled" data-youtube-broadcast-id={v.videoId}>
        <p className="text-sm font-semibold text-primary"><i className="fas fa-tower-broadcast mr-1.5 text-brand-fg" aria-hidden="true"></i>Scheduled on YouTube {formatLiveWhen(v.scheduledStartAt)}</p>
        <p className="text-xs text-muted">This is your stream key. It is shown here once — Edge Athlete does not keep it; YouTube Studio does. Anyone with the key can stream to this broadcast, so treat it like a password.</p>
        <label className="block text-sm text-secondary">
          Stream key
          <div className="mt-1 flex gap-2">
            <input className={`${FIELD} font-mono text-sm`} readOnly value={v.streamKey} onFocus={e => e.currentTarget.select()} aria-label="Stream key" data-youtube-broadcast-key="" />
            <button type="button" onClick={() => void copy('key', v.streamKey)} className={`${BTN} shrink-0`} data-youtube-broadcast-copy-key="">{copied === 'key' ? 'Copied' : 'Copy'}</button>
          </div>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <a href={v.studioUrl} target="_blank" rel="noopener noreferrer" className="ea-interactive flex items-center gap-3 rounded-lg border border-border px-3 min-h-[48px] text-left" data-youtube-broadcast-studio="">
            <i className="fab fa-youtube text-brand-fg" aria-hidden="true"></i>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-primary">Open YouTube Studio</span>
              <span className="block text-xs text-muted">Go live from a computer, or from the YouTube app signed in to the same account.</span>
            </span>
          </a>
          <button type="button" onClick={() => setEncoder(e => !e)} className="ea-interactive flex items-center gap-3 rounded-lg border border-border px-3 min-h-[48px] text-left" aria-expanded={encoder} data-youtube-broadcast-encoder="">
            <i className="fas fa-sliders text-brand-fg" aria-hidden="true"></i>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-primary">I&apos;ll use OBS or another encoder</span>
              <span className="block text-xs text-muted">The server address and the key go into the encoder&apos;s settings.</span>
            </span>
          </button>
        </div>
        {encoder && ingest && (
          <label className="block text-sm text-secondary">
            Server address
            <div className="mt-1 flex gap-2">
              <input className={`${FIELD} font-mono text-sm`} readOnly value={ingest} onFocus={e => e.currentTarget.select()} aria-label="Server address" data-youtube-broadcast-url="" />
              <button type="button" onClick={() => void copy('url', ingest)} className={`${BTN} shrink-0`}>{copied === 'url' ? 'Copied' : 'Copy'}</button>
            </div>
          </label>
        )}
        <p className="text-xs text-muted">Live streaming must be turned on for the channel in YouTube Studio (it takes up to a day the first time). From the YouTube phone app a channel needs 50 subscribers to go live; a computer or an encoder needs none. The stream starts and ends on its own when the encoder connects and stops.</p>
        <button type="button" onClick={() => onScheduled(v.videoId, v.title)} className="ea-cta w-full min-h-[44px] rounded-lg text-sm font-semibold text-white" data-youtube-broadcast-continue="">
          Continue — add it to Edge Athlete
        </button>
      </div>
    );
  }

  const busy = phase.kind === 'scheduling';
  return (
    <div className="rounded-lg border border-border p-3 space-y-3" data-youtube-broadcast={phase.kind}>
      <p className="text-sm font-semibold text-primary"><i className="fas fa-tower-broadcast mr-1.5 text-brand-fg" aria-hidden="true"></i>Schedule a live broadcast on your channel</p>
      <p className="text-xs text-muted">Edge Athlete creates the broadcast on YouTube and hands you the stream key. You go live with YouTube Studio or an encoder; the game shows here as upcoming, then live, then the recording.</p>
      <label className="block text-sm text-secondary">
        Title on YouTube
        <input className={`${FIELD} mt-1`} maxLength={UPLOAD_TITLE_MAX} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} data-youtube-broadcast-title="" />
      </label>
      <label className="block text-sm text-secondary">
        Starts
        <input type="datetime-local" className={`${FIELD} mt-1`} value={startLocal} min={minLocal} disabled={busy} onChange={e => setStartLocal(e.target.value)} data-youtube-broadcast-start="" />
      </label>
      <fieldset className="space-y-1">
        <legend className="text-sm text-secondary">Who can find it on YouTube</legend>
        {UPLOAD_PRIVACIES.map(p => (
          <label key={p} className="flex items-center gap-2 text-sm text-primary min-h-[36px]">
            <input type="radio" name="yt-broadcast-privacy" value={p} checked={privacy === p} disabled={busy} onChange={() => setPrivacy(p)} className="h-4 w-4" />
            <span className="capitalize">{p}</span>
            <span className="text-xs text-muted">{p === 'public' ? '— anyone on YouTube' : p === 'unlisted' ? '— only with the link (Edge Athlete has it)' : '— only you on YouTube; it will not play here'}</span>
          </label>
        ))}
      </fieldset>
      {phase.kind === 'error' && <p className="text-sm text-red-600" role="alert" data-youtube-broadcast-error="">{phase.message}</p>}
      <button type="button" onClick={() => void schedule()} disabled={busy || !title.trim() || !startLocal} className="ea-cta w-full min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-60" data-youtube-broadcast-schedule="">
        {busy ? 'Scheduling…' : 'Schedule on YouTube'}
      </button>
    </div>
  );
}
