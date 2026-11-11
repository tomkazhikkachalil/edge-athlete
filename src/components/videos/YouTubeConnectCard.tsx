'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import ConfirmModal from '@/components/ConfirmModal';
import { CONNECT_ERRORS, CONNECT_RESULT_PARAMS, healthCheckDue, reconnectScope, UNVERIFIED_NOTE, type ScopeKey, type YouTubeConnectionView } from '@/lib/videos/youtube-connection';
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
 * The flow round (Nov 10 2026): a read that failed says so with Retry (the
 * card never just vanishes); the space is held while it loads; a connected
 * card shows what the channel is allowed here — link, upload, live — with
 * the door for what is missing; the result of a connect is read from the
 * address once and then removed from it.
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
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<YouTubeConnectionView | null | 'gone' | 'failed'>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The connect's result: read ONCE from the address, then the words leave it (a reload or a shared link never repeats the banner).
  const [landed] = useState(() => ({ result: params.get('youtube'), errorWord: params.get('youtube_error') }));
  const { result, errorWord } = landed;
  useEffect(() => {
    if (!landed.result && !landed.errorWord) return;
    const rest = new URLSearchParams(window.location.search);
    for (const k of CONNECT_RESULT_PARAMS) rest.delete(k);
    const q = rest.toString();
    router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false });
  }, [landed, pathname, router]);

  // The fetch returns the view; the effect (and the disconnect) set it — never a set inside the effect's own frame.
  // 'gone' = not this viewer's to see (a 404) → the card is absent; 'failed' = the read itself broke → the card says so.
  const fetchView = useCallback(async (check = false): Promise<YouTubeConnectionView | 'gone' | 'failed'> => {
    try {
      const res = await fetch(`/api/videos/youtube/connection?owner=${encodeURIComponent(owner)}${check ? '&check=1' : ''}`, { cache: 'no-store' });
      if (res.status === 401 || res.status === 404) return 'gone';
      if (!res.ok) return 'failed';
      const body = (await res.json()) as { connection?: YouTubeConnectionView };
      return body.connection ?? 'failed';
    } catch {
      return 'failed';
    }
  }, [owner]);

  useEffect(() => {
    let live = true;
    void fetchView().then(next => {
      if (!live) return;
      setView(next);
      // The health check: only a connection that still claims to stand, only when the last check is old.
      if (next === 'gone' || next === 'failed' || !next.connected || !next.canManage || next.status === 'revoked' || !checkDue(owner)) return;
      checkedNow(owner);
      void fetchView(true).then(checked => { if (live && checked !== 'gone' && checked !== 'failed') setView(checked); });
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

  const retry = () => {
    setView(null);
    void fetchView().then(setView);
  };

  const shell = `rounded-lg border border-border bg-surface ${compact ? 'p-3' : 'p-4'} min-h-[120px]`;
  if (view === 'gone') return null;
  if (view === null) return <div className={shell} aria-hidden="true" data-youtube-card="loading" />;
  if (view === 'failed') {
    return (
      <div className={`${shell} space-y-2`} data-youtube-card="failed">
        <p className="text-sm font-semibold text-primary"><FaIcon icon={faYoutubeBrands} className="text-red-600 mr-1.5" />YouTube channel</p>
        <p className="text-sm text-secondary" role="alert">Could not read the YouTube connection.</p>
        <button type="button" onClick={retry} className="inline-flex items-center min-h-[44px] px-4 rounded-full border border-border-strong text-sm font-semibold text-primary" data-youtube-retry="">Retry</button>
      </div>
    );
  }
  if (!view.available || !view.canManage) return null;
  const start = (scope: ScopeKey) => `/api/videos/youtube/start?owner=${encodeURIComponent(owner)}&scope=${scope}`;
  const banner = errorWord ? (CONNECT_ERRORS[errorWord] ?? CONNECT_ERRORS.failed) : result === 'connected' ? 'YouTube channel connected.' : null;

  return (
    <div className={`${shell} space-y-2`} data-youtube-card={view.connected ? 'connected' : 'none'}>
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
          {view.unverified && <p className="text-xs text-muted" data-youtube-unverified="">{UNVERIFIED_NOTE}</p>}
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-primary"><FaIcon icon={faYoutubeBrands} className="text-red-600 mr-1.5" />{view.channelTitle || 'YouTube channel'} <span className="font-normal text-muted">connected</span></p>
          {view.problem && <p className="text-xs text-red-600" data-youtube-problem="">{view.problem}</p>}
          {!view.connectedByMe && <p className="text-xs text-muted" data-youtube-not-mine="">Connected through someone else&apos;s Google account — only they can upload to it; anyone who manages videos can link its uploads.</p>}
          {/* What this channel is allowed here; force-ssl (live) covers uploads too. The doors for what is missing are the connector's. */}
          {view.status !== 'revoked' && (() => {
            const canUploadScope = view.scopes.includes('upload') || view.scopes.includes('live');
            const chips: Array<{ key: string; label: string; on: boolean }> = [
              { key: 'link', label: 'Link uploads', on: view.scopes.includes('readonly') || canUploadScope },
              { key: 'upload', label: 'Upload from here', on: canUploadScope },
              { key: 'live', label: 'Go live', on: view.scopes.includes('live') },
            ];
            return (
              <>
                <ul className="flex flex-wrap gap-1.5" data-youtube-allowed="">
                  {chips.map(c => (
                    <li key={c.key} className={`text-xs px-2 py-1 rounded-full border ${c.on ? 'border-border text-secondary' : 'border-border-subtle text-muted'}`} data-youtube-chip={c.key} data-on={c.on ? 'true' : 'false'}>
                      {c.label}{c.on ? ' · on' : ' · not yet'}
                    </li>
                  ))}
                </ul>
                {view.connectedByMe && (!canUploadScope || !view.scopes.includes('live')) && (
                  <div className="flex flex-wrap gap-2">
                    {!canUploadScope && <a href={start('upload')} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full border border-border-strong text-sm font-semibold text-primary" data-youtube-allow-upload="">Allow uploads</a>}
                    {!view.scopes.includes('live') && <a href={start('live')} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full border border-border-strong text-sm font-semibold text-primary" data-youtube-allow-live="">Allow live broadcasts</a>}
                  </div>
                )}
                {view.connectedByMe && view.unverified && (!canUploadScope || !view.scopes.includes('live')) && <p className="text-xs text-muted" data-youtube-unverified="">{UNVERIFIED_NOTE}</p>}
              </>
            );
          })()}
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
