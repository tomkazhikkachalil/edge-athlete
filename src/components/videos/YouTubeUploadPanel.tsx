'use client';

import { useEffect, useRef, useState } from 'react';
import { UPLOAD_DESCRIPTION_MAX, UPLOAD_PRIVACIES, UPLOAD_TITLE_MAX, type UploadPrivacy } from '@/lib/videos/youtube-connection';
import FaIcon from '@/components/FaIcon';
import { faCloudArrowUp } from '@/lib/icons/fa/cloud-arrow-up';
import YouTubeReconnectLink from '@/components/videos/YouTubeReconnectLink';

const FIELD = 'w-full border border-border-strong rounded-lg px-3 min-h-[44px] text-base bg-surface text-primary';

/**
 * "Upload a file" (Videos program Phase 3): the full game goes from THIS
 * device straight to YouTube — the server opens the session, the device PUTs
 * the chunks (youtube-upload.ts, resumable), the id comes back and the
 * parent makes the row. Title, description and the privacy word are
 * YouTube's own; the eligibility (the upload scope, the connector's grant)
 * is checked when the session opens, before a byte leaves. Cancel aborts the
 * chunk in flight. The upload runs inside the page's life: a navigation
 * away loses it (YouTube keeps nothing of a half upload), and the panel
 * says so.
 */
export default function YouTubeUploadPanel({ owner, onUploaded, onNeedsScope, returnTo, onLeave }: { owner: string; onUploaded: (videoId: string, title: string) => void; onNeedsScope: () => void; returnTo?: string; onLeave?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<UploadPrivacy>('unlisted');
  const [phase, setPhase] = useState<{ kind: 'idle' } | { kind: 'opening' } | { kind: 'uploading'; fraction: number } | { kind: 'error'; message: string; reconnect?: boolean }>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async () => {
    if (!file || !title.trim()) return;
    setPhase({ kind: 'opening' });
    try {
      const res = await fetch('/api/videos/youtube/upload-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, title: title.trim(), description: description.trim(), privacy, sizeBytes: file.size, contentType: file.type || 'video/mp4' }),
      });
      const body = (await res.json().catch(() => ({}))) as { session_uri?: string; access_token?: string; error?: string; needs_scope?: string; reconnect?: boolean };
      if (res.status === 409 && body.needs_scope === 'upload') { setPhase({ kind: 'idle' }); onNeedsScope(); return; }
      if (!res.ok || !body.session_uri || !body.access_token) { setPhase({ kind: 'error', message: body.error ?? 'YouTube did not open the upload.', reconnect: body.reconnect === true }); return; }
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase({ kind: 'uploading', fraction: 0 });
      const { uploadToYouTube } = await import('@/lib/videos/youtube-upload');
      const result = await uploadToYouTube({ sessionUri: body.session_uri, accessToken: body.access_token, file, signal: controller.signal, onProgress: fraction => setPhase(p => (p.kind === 'uploading' ? { kind: 'uploading', fraction } : p)) });
      abortRef.current = null;
      if (!result.ok) { setPhase(result.kind === 'cancelled' ? { kind: 'idle' } : { kind: 'error', message: result.message }); return; }
      onUploaded(result.videoId, title.trim());
    } catch {
      setPhase({ kind: 'error', message: 'The upload could not start. Check your connection and try again.' });
    }
  };

  const busy = phase.kind === 'opening' || phase.kind === 'uploading';
  return (
    <div className="rounded-lg border border-border p-3 space-y-3" data-youtube-upload={phase.kind}>
      <p className="text-sm font-semibold text-primary"><FaIcon icon={faCloudArrowUp} className="mr-1.5 text-brand-fg" />Upload a file to your channel</p>
      <p className="text-xs text-muted">The video goes from this device straight to YouTube, resumable — never through Edge Athlete. Keep this page open until it finishes.</p>
      <input type="file" accept="video/*" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-sm text-secondary" aria-label="Video file" data-youtube-upload-file="" />
      <label className="block text-sm text-secondary">
        Title on YouTube
        <input className={`${FIELD} mt-1`} maxLength={UPLOAD_TITLE_MAX} value={title} disabled={busy} onChange={e => setTitle(e.target.value)} data-youtube-upload-title="" />
      </label>
      <label className="block text-sm text-secondary">
        Description (optional)
        <textarea className={`${FIELD} mt-1 py-2 min-h-[72px]`} maxLength={UPLOAD_DESCRIPTION_MAX} value={description} disabled={busy} onChange={e => setDescription(e.target.value)} />
      </label>
      <fieldset className="space-y-1">
        <legend className="text-sm text-secondary">Who can find it on YouTube</legend>
        {UPLOAD_PRIVACIES.map(p => (
          <label key={p} className="flex items-center gap-2 text-sm text-primary min-h-[36px]">
            <input type="radio" name="yt-privacy" value={p} checked={privacy === p} disabled={busy} onChange={() => setPrivacy(p)} className="h-4 w-4" />
            <span className="capitalize">{p}</span>
            <span className="text-xs text-muted">{p === 'public' ? '— anyone on YouTube' : p === 'unlisted' ? '— only with the link (Edge Athlete has it)' : '— only you on YouTube; it will not play here'}</span>
          </label>
        ))}
      </fieldset>
      {phase.kind === 'uploading' && (
        <div className="space-y-1" role="status" aria-live="polite">
          <div className="h-2 rounded-full bg-surface-muted overflow-hidden"><div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round(phase.fraction * 100)}%` }} /></div>
          <p className="text-xs text-secondary" data-youtube-upload-progress={Math.round(phase.fraction * 100)}>Uploading to YouTube · {Math.round(phase.fraction * 100)}%</p>
        </div>
      )}
      {phase.kind === 'error' && <p className="text-sm text-red-600" role="alert" data-youtube-upload-error="">{phase.message}{phase.reconnect && <> <YouTubeReconnectLink owner={owner} scope="upload" returnTo={returnTo} onNavigate={onLeave} /></>}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void start()} disabled={busy || !file || !title.trim()} className="min-h-[44px] px-4 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-hover disabled:opacity-50" data-youtube-upload-start="">
          {phase.kind === 'opening' ? 'Opening…' : phase.kind === 'uploading' ? 'Uploading…' : 'Upload to YouTube'}
        </button>
        {phase.kind === 'uploading' && (
          <button type="button" onClick={() => abortRef.current?.abort()} className="min-h-[44px] px-4 rounded-full border border-border-strong text-sm font-semibold text-secondary" data-youtube-upload-cancel="">Cancel</button>
        )}
      </div>
    </div>
  );
}
