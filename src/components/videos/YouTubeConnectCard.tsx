'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ConfirmModal from '@/components/ConfirmModal';
import { CONNECT_ERRORS, healthCheckDue, reconnectScope, type YouTubeConnectionView } from '@/lib/videos/youtube-connection';
import FaIcon from '@/components/FaIcon';
import { faYoutubeBrands } from '@/lib/icons/fa/youtube-brands';

/**
 * The YouTube channel card (Videos program Phase 3, Nov 5 2026): one per
 * owner — the profile's Videos tab (the owner or a guardian) and the org
 * console's website section (manage_video). Connect is a NAVIGATION to the
 * start route (Google's consent, then back here with `?youtube=connected`
 * or `?youtube_error=<word>`); Disconnect confirms, names what is lost, and
 * calls the one DELETE. The card says whose Google account the connection
 * is — only that person uploads; everyone who manages may link. Absent
 * when the deployment does not offer the feature (no credentials, no key).
 * Self-healing (Nov 10 2026): a connected card asks YouTube once whether
 * the connection still stands (`&check=1`, at most every ten minutes per
 * owner on this device) — a grant that ended shows "Reconnect" here, now,
 * not at the next upload.
 */
const CHECK_KEY = (owner: string) => `ea-yt-check:${owner}`;

function checkDue(owner: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(CHECK_KEY(owner));
    return healthCheckDue(raw === null ? null : Number(raw), Date.now());
  } catch {
    return true;
  }
}

function checkedNow(owner: string): void {
  try {
    window.sessionStorage.setItem(CHECK_KEY(owner), String(Date.now()));
  } catch {
    /* the card works without the note — it just asks again next time */
  }
}

export default function YouTubeConnectCard({ owner, compact = false }: { owner: string; compact?: boolean }) {
  const params = useSearchParams();
  const [view, setView] = useState<YouTubeConnectionView | null | 'gone'>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const result = params.get('youtube');
  const errorWord = params.get('youtube_error');

  // The fetch returns the view; the effect (and the disconnect) set it — never a set inside the effect's own frame.
  const fetchView = useCallback(async (check = false): Promise<YouTubeConnectionView | 'gone'> => {
    try {
      const res = await fetch(`/api/videos/youtube/connection?owner=${encodeURIComponent(owner)}${check ? '&check=1' : ''}`, { cache: 'no-store' });
      if (!res.ok) return 'gone';
      const body = (await res.json()) as { connection?: YouTubeConnectionView };
      return body.connection ?? 'gone';
    } catch {
      return 'gone';
    }
  }, [owner]);

  useEffect(() => {
    let live = true;
    void fetchView().then(next => {
      if (!live) return;
      setView(next);
      // The health check: only a connection that still claims to stand, only when the last check is old.
      if (next === 'gone' || !next.connected || !next.canManage || next.status === 'revoked' || !checkDue(owner)) return;
      checkedNow(owner);
      void fetchView(true).then(checked => { if (live && checked !== 'gone') setView(checked); });
    });
    return () => { live = false; };
  }, [fetchView, owner]);

  const disconnect = async () => {
    setConfirm(false);
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/videos/youtube/connection?owner=${encodeURIComponent(owner)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setNote(body.error ?? 'Could not disconnect.');
      } else {
        setView(await fetchView());
      }
    } catch {
      setNote('Could not disconnect. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (view === null || view === 'gone' || !view.available || !view.canManage) return null;
  const start = (scope: 'readonly' | 'upload' | 'live') => `/api/videos/youtube/start?owner=${encodeURIComponent(owner)}&scope=${scope}`;
  const banner = errorWord ? (CONNECT_ERRORS[errorWord] ?? CONNECT_ERRORS.failed) : result === 'connected' ? 'YouTube channel connected.' : null;

  return (
    <div className={`rounded-lg border border-border bg-surface ${compact ? 'p-3' : 'p-4'} space-y-2`} data-youtube-card={view.connected ? 'connected' : 'none'}>
      {banner && (
        <p className={`text-sm ${errorWord ? 'text-red-600' : 'text-secondary'}`} role="status" data-youtube-result={errorWord ? 'error' : 'connected'}>{banner}</p>
      )}
      {!view.connected ? (
        <>
          <p className="text-sm font-semibold text-primary"><FaIcon icon={faYoutubeBrands} className="text-red-600 mr-1.5" />Connect a YouTube channel</p>
          <p className="text-xs text-muted">Link your channel&apos;s uploads in one tap, or upload a full game from here straight to YouTube. You&apos;ll sign in with Google; Edge Athlete never downloads or edits your videos.</p>
          <a href={start('readonly')} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-hover" data-youtube-connect="">
            Connect YouTube
          </a>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-primary"><FaIcon icon={faYoutubeBrands} className="text-red-600 mr-1.5" />{view.channelTitle || 'YouTube channel'} <span className="font-normal text-muted">connected</span></p>
          {view.problem && <p className="text-xs text-red-600" data-youtube-problem="">{view.problem}</p>}
          {!view.connectedByMe && <p className="text-xs text-muted" data-youtube-not-mine="">Connected through someone else&apos;s Google account — only they can upload to it; anyone who manages videos can link its uploads.</p>}
          {view.connectedByMe && !view.scopes.includes('upload') && (
            <a href={start('upload')} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full border border-border-strong text-sm font-semibold text-primary" data-youtube-allow-upload="">Allow uploads</a>
          )}
          <div className="flex flex-wrap gap-2">
            {view.problem && (
              <a href={start(view.connectedByMe ? reconnectScope(view.scopes) : 'readonly')} className="inline-flex items-center min-h-[44px] px-4 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-hover" data-youtube-reconnect="">Reconnect</a>
            )}
            <button type="button" onClick={() => setConfirm(true)} disabled={busy} className="inline-flex items-center min-h-[44px] px-4 rounded-full border border-border-strong text-sm font-semibold text-secondary disabled:opacity-50" data-youtube-disconnect="">
              Disconnect
            </button>
          </div>
        </>
      )}
      {note && <p className="text-sm text-red-600" role="alert">{note}</p>}
      <ConfirmModal
        isOpen={confirm}
        title="Disconnect YouTube?"
        message="Uploading from here and the one-tap channel list stop. Every video already linked stays."
        confirmText="Disconnect"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={disconnect}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
