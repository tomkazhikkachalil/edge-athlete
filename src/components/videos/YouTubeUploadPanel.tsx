'use client';

import { useEffect, useRef, useState } from 'react';
import {
  parseYouTubeResume, resumeMatches, UPLOAD_DESCRIPTION_MAX, UPLOAD_PRIVACIES, UPLOAD_TITLE_MAX, youtubeResumeKey,
  type UploadPrivacy, type YouTubeResumeEntry,
} from '@/lib/videos/youtube-connection';
import { useWakeLock } from '@/lib/device/wake-lock';
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
 * chunk in flight.
 *
 * The uploads round (Nov 10 2026): the upload outlives the hour (a 401
 * mid-upload fetches a fresh token from /upload-token and goes on), a lost
 * connection (it waits, says so, and continues from YouTube's own offset)
 * and a reload — the session is kept on the device for 23 hours (never a
 * token; removed at sign-out with the device store), and picking the same
 * file again resumes it. The screen stays awake while it runs, and leaving
 * the page mid-upload asks first.
 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'uploading'; fraction: number; waiting: null | 'retry' | 'offline' }
  | { kind: 'error'; message: string; reconnect?: boolean };

function readResume(userId: string, owner: string): YouTubeResumeEntry | null {
  try {
    const entry = parseYouTubeResume(window.localStorage.getItem(youtubeResumeKey(userId)), Date.now());
    return entry && entry.owner === owner ? entry : null;
  } catch {
    return null;
  }
}

function writeResume(userId: string, entry: YouTubeResumeEntry | null): void {
  try {
    if (entry) window.localStorage.setItem(youtubeResumeKey(userId), JSON.stringify(entry));
    else window.localStorage.removeItem(youtubeResumeKey(userId));
  } catch {
    /* without storage a reload starts the upload over — nothing else is lost */
  }
}

export default function YouTubeUploadPanel({ owner, userId, onUploaded, onNeedsScope, returnTo, onLeave }: { owner: string; userId: string; onUploaded: (videoId: string, title: string) => void; onNeedsScope: () => void; returnTo?: string; onLeave?: () => void }) {
  // An upload this device began for this owner and did not finish (this panel mounts on the client only).
  const [kept, setKept] = useState<YouTubeResumeEntry | null>(() => readResume(userId, owner));
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(() => kept?.title ?? '');
  const [description, setDescription] = useState('');
  const [privacy, setPrivacy] = useState<UploadPrivacy>('unlisted');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const uploading = phase.kind === 'uploading';
  useWakeLock(uploading);
  // Leaving mid-upload asks first: the bytes sent so far stay at YouTube, but the page that sends the rest would be gone.
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);

  const resumable = resumeMatches(kept, file, owner);
  const forget = () => { writeResume(userId, null); setKept(null); };

  /** A fresh hour-long token for an upload in flight; null = the connection has to be made again (or the server did not answer). */
  const freshToken = async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/videos/youtube/upload-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner }) });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => ({}))) as { access_token?: string };
      return body.access_token ?? null;
    } catch {
      return null;
    }
  };

  const send = async (sessionUri: string, accessToken: string, theFile: File, sentTitle: string, resume: boolean) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: 'uploading', fraction: 0, waiting: null });
    const { uploadToYouTube } = await import('@/lib/videos/youtube-upload');
    const result = await uploadToYouTube({
      sessionUri, accessToken, file: theFile, signal: controller.signal, resume, refreshToken: freshToken,
      onProgress: fraction => setPhase(p => (p.kind === 'uploading' ? { kind: 'uploading', fraction, waiting: null } : p)),
      onRetry: info => setPhase(p => (p.kind === 'uploading' ? { ...p, waiting: info.offline ? 'offline' : 'retry' } : p)),
    });
    abortRef.current = null;
    if (result.ok) {
      forget();
      onUploaded(result.videoId, sentTitle);
      return;
    }
    // Cancelled or a session YouTube ended: nothing to come back to. An interruption keeps the session — "Resume upload" goes on from YouTube's offset.
    if (result.kind === 'cancelled' || result.kind === 'expired') forget();
    setPhase(result.kind === 'cancelled' ? { kind: 'idle' } : { kind: 'error', message: result.message, reconnect: result.reconnect });
  };

  const start = async () => {
    if (!file || !title.trim()) return;
    setPhase({ kind: 'opening' });
    try {
      if (resumable && kept) {
        // The session is still YouTube's: a fresh token, then its own offset.
        const token = await freshToken();
        if (!token) { setPhase({ kind: 'error', message: 'The upload could not be resumed — check your connection, or reconnect the channel.', reconnect: true }); return; }
        await send(kept.sessionUri, token, file, kept.title || title.trim(), true);
        return;
      }
      if (kept) forget(); // a different file: the kept session is left behind
      const res = await fetch('/api/videos/youtube/upload-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, title: title.trim(), description: description.trim(), privacy, sizeBytes: file.size, contentType: file.type || 'video/mp4' }),
      });
      const body = (await res.json().catch(() => ({}))) as { session_uri?: string; access_token?: string; error?: string; needs_scope?: string; reconnect?: boolean };
      if (res.status === 409 && body.needs_scope === 'upload') { setPhase({ kind: 'idle' }); onNeedsScope(); return; }
      if (!res.ok || !body.session_uri || !body.access_token) { setPhase({ kind: 'error', message: body.error ?? 'YouTube did not open the upload.', reconnect: body.reconnect === true }); return; }
      const entry: YouTubeResumeEntry = { sessionUri: body.session_uri, owner, title: title.trim(), name: file.name, size: file.size, lastModified: file.lastModified, type: file.type || 'video/mp4', at: Date.now() };
      writeResume(userId, entry);
      setKept(entry);
      await send(body.session_uri, body.access_token, file, title.trim(), false);
    } catch {
      setPhase({ kind: 'error', message: 'The upload could not start. Check your connection and try again.' });
    }
  };

  const busy = phase.kind === 'opening' || uploading;
  const percent = uploading ? Math.round(phase.fraction * 100) : 0;
  return (
    <div className="rounded-lg border border-border p-3 space-y-3" data-youtube-upload={phase.kind}>
      <p className="text-sm font-semibold text-primary"><FaIcon icon={faCloudArrowUp} className="mr-1.5 text-brand-fg" />Upload a file to your channel</p>
      <p className="text-xs text-muted">The video goes from this device straight to YouTube — never through Edge Athlete. Keep this page open while it uploads; if the connection drops or the page reloads, it picks up where YouTube left off.</p>
      {kept && !busy && (
        <div className="rounded-lg border border-border-subtle bg-surface-muted p-3 space-y-2" data-youtube-upload-kept="">
          <p className="text-sm text-secondary">
            An upload of <span className="font-semibold text-primary break-all">{kept.name}</span> did not finish.{' '}
            {resumable ? 'This is the same file — it will continue from where YouTube has it.' : file ? 'The file chosen is a different one — a new upload will start.' : 'Choose the same file again to continue it.'}
          </p>
          <button type="button" onClick={forget} className="text-sm font-semibold text-secondary underline min-h-[44px]" data-youtube-upload-forget="">Start over instead</button>
        </div>
      )}
      <input type="file" accept="video/*" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-sm text-secondary max-w-full" aria-label="Video file" data-youtube-upload-file="" />
      <label className="block text-sm text-secondary">
        Title on YouTube
        <input className={`${FIELD} mt-1`} maxLength={UPLOAD_TITLE_MAX} value={title} disabled={busy || resumable} onChange={e => setTitle(e.target.value)} data-youtube-upload-title="" />
      </label>
      {!resumable && (
        <>
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
        </>
      )}
      {uploading && (
        <div className="space-y-1" role="status" aria-live="polite">
          <div className="h-2 rounded-full bg-surface-muted overflow-hidden"><div className="h-full bg-brand transition-[width]" style={{ width: `${percent}%` }} /></div>
          <p className="text-xs text-secondary" data-youtube-upload-progress={percent} data-youtube-upload-waiting={phase.waiting ?? ''}>
            {phase.waiting === 'offline' ? `No connection — the upload continues when it is back · ${percent}%` : phase.waiting === 'retry' ? `The connection dropped — trying again · ${percent}%` : `Uploading to YouTube · ${percent}%`}
          </p>
        </div>
      )}
      {phase.kind === 'error' && <p className="text-sm text-red-600" role="alert" data-youtube-upload-error="">{phase.message}{phase.reconnect && <> <YouTubeReconnectLink owner={owner} scope="upload" returnTo={returnTo} onNavigate={onLeave} /></>}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void start()} disabled={busy || !file || !title.trim()} className="min-h-[44px] px-4 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-hover disabled:opacity-50" data-youtube-upload-start={resumable ? 'resume' : 'new'}>
          {phase.kind === 'opening' ? 'Opening…' : uploading ? 'Uploading…' : resumable ? 'Resume upload' : 'Upload to YouTube'}
        </button>
        {uploading && (
          <button type="button" onClick={() => abortRef.current?.abort()} className="min-h-[44px] px-4 rounded-full border border-border-strong text-sm font-semibold text-secondary" data-youtube-upload-cancel="">Cancel</button>
        )}
      </div>
    </div>
  );
}
