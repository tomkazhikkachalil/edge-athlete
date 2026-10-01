'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ConfirmModal from '@/components/ConfirmModal';
import { ago } from '@/components/tickets/ticket-ui';
import { SUPERVISED_CONNECTIONS_MESSAGE, type ConnectionView } from '@/lib/activities/connections';

/**
 * Settings → Connected apps (fix round part 3, mig 247).
 *
 * Tom: "You're supposed to connect permanently so anything you do with your
 * smart watch will then populate on the app … you connect to the
 * applications in settings." One card per source, in the order of
 * activities/connections.ts. A card only ever offers what is true today: a
 * connected source shows when it last delivered and a Disconnect; a source
 * whose programme has not admitted Edge Athlete yet says so and points at
 * the file import, which works for every watch.
 *
 * Nothing here posts to the feed: a delivered workout appears in Vitals and
 * the athlete shares it (the Vitals rule).
 */

interface ConnectionsResponse {
  supported: boolean;
  ready: boolean;
  supervised: boolean;
  connections: ConnectionView[];
}

type LoadState = 'loading' | 'ready' | 'unsupported' | 'error';

const STATE_CHIP: Record<ConnectionView['state'], { label: string; className: string } | null> = {
  connected: { label: 'Connected', className: 'bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300' },
  needs_attention: { label: 'Needs attention', className: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  available: null,
  coming: { label: 'Coming', className: 'bg-surface-muted text-tertiary' },
};

export default function ConnectedApps() {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirming, setConfirming] = useState<ConnectionView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The upload link, right after it was made: shown ONCE (the server keeps
  // only its hash), so it lives here and nowhere else.
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [confirmingNewLink, setConfirmingNewLink] = useState(false);

  const makeLink = async () => {
    setConfirmingNewLink(false);
    setBusy('upload_link');
    setError(null);
    try {
      let tz: string | undefined;
      try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        tz = undefined;
      }
      const res = await fetch('/api/connections/upload-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tz ? { tz } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.url !== 'string') {
        setError(typeof body.error === 'string' ? body.error : 'Could not create your link. Try again.');
        return;
      }
      setFreshLink(body.url);
      setReloadKey(k => k + 1);
    } catch {
      setError('Could not create your link. Try again.');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/connections', { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setState('error'); return; }
        const body = (await res.json()) as ConnectionsResponse;
        if (cancelled) return;
        setData(body);
        setState(body.supported ? 'ready' : 'unsupported');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const disconnect = async (c: ConnectionView) => {
    setConfirming(null);
    setBusy(c.provider);
    setError(null);
    try {
      const res = await fetch(`/api/connections/${c.provider}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === 'string' ? body.error : 'Could not disconnect. Try again.');
        return;
      }
      if (c.kind === 'link') setFreshLink(null);
      setReloadKey(k => k + 1);
    } catch {
      setError('Could not disconnect. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6" data-connected-apps="">
      <div>
        <h3 className="text-lg font-semibold text-primary mb-2">Connected apps</h3>
        <p className="text-tertiary text-sm">
          Connect a watch or an app once and every workout it records shows up in your Vitals by
          itself. Nothing is posted to your feed unless you share it.
        </p>
      </div>

      {state === 'loading' && <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand my-6"></div>}
      {state === 'error' && (
        <p role="alert" className="text-sm text-muted">
          Couldn&apos;t load your connected apps.{' '}
          <button type="button" onClick={() => { setState('loading'); setReloadKey(k => k + 1); }} className="underline text-brand-fg">
            Try again
          </button>
        </p>
      )}
      {state === 'unsupported' && (
        <p className="text-sm text-muted" data-connections-unsupported="">
          Connected apps are not available yet.
        </p>
      )}

      {state === 'ready' && data && (
        <>
          {data.supervised && (
            <p className="rounded-lg border border-border bg-brand-soft px-4 py-3 text-sm text-secondary" data-connections-supervised="">
              {SUPERVISED_CONNECTIONS_MESSAGE}
            </p>
          )}
          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
          <ul className="space-y-3">
            {data.connections.map(c => {
              const chip = STATE_CHIP[c.state];
              const linked = c.state === 'connected' || c.state === 'needs_attention';
              return (
                <li
                  key={c.provider}
                  className="rounded-lg border border-border p-4"
                  data-connection={c.provider}
                  data-connection-state={c.state}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-fg" aria-hidden="true">
                      <i className={`fas fa-${c.icon}`}></i>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold text-primary">{c.label}</h4>
                        {chip && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip.className}`}>{chip.label}</span>
                        )}
                      </div>
                      <p className="text-sm text-tertiary">{c.devices}</p>
                      {c.state === 'connected' && (
                        <p className="mt-1 text-sm text-secondary">
                          {c.lastSyncAt ? `Last workout received ${ago(c.lastSyncAt)}.` : 'Waiting for your first workout.'}
                        </p>
                      )}
                      {c.problem && <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">{c.problem}</p>}
                      {c.note && <p className="mt-1 text-sm text-muted">{c.note}</p>}
                    </div>
                  </div>
                  {c.kind === 'link' && (c.state !== 'coming') && (
                    <UploadLink
                      linked={linked || !!freshLink}
                      freshLink={freshLink}
                      busy={busy === c.provider}
                      disabled={data.supervised}
                      onCreate={() => void makeLink()}
                    />
                  )}
                  {linked && (
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      {c.kind === 'link' && (
                        <button
                          type="button"
                          onClick={() => setConfirmingNewLink(true)}
                          disabled={busy === c.provider || data.supervised}
                          className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-medium text-primary ea-interactive disabled:opacity-50"
                          data-upload-link-replace=""
                        >
                          Make a new link
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirming(c)}
                        disabled={busy === c.provider}
                        className="min-h-[44px] rounded-lg border border-border px-4 text-sm font-medium text-primary ea-interactive disabled:opacity-50"
                        data-connection-disconnect=""
                      >
                        {busy === c.provider ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="bg-brand-soft border border-border rounded-lg p-4">
        <div className="flex gap-3">
          <i className="fas fa-file-arrow-up text-brand-fg mt-0.5 shrink-0" aria-hidden="true"></i>
          <p className="text-sm text-secondary">
            Every watch and app can export a workout as a file.{' '}
            <Link href="/activities/import" className="font-medium text-brand-fg underline">
              Import a file
            </Link>{' '}
            and it joins your Vitals the same way.
          </p>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!confirming}
        title={confirming ? `Disconnect ${confirming.label}?` : ''}
        message="New workouts will stop arriving. The activities already in your Vitals stay."
        confirmText="Disconnect"
        onConfirm={() => { if (confirming) void disconnect(confirming); }}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmModal
        isOpen={confirmingNewLink}
        title="Make a new link?"
        message="Your current link stops working at once. You will need to paste the new one into the app on your iPhone."
        confirmText="Make a new link"
        onConfirm={() => void makeLink()}
        onCancel={() => setConfirmingNewLink(false)}
      />
    </div>
  );
}

// ── The Apple Watch card's body: the personal upload link ───────────────────
// Apple has no web API, so a bridge app on the iPhone sends each workout to a
// link that belongs to this athlete alone. The link is shown once, right
// after it is made; afterwards the card can only replace it.

const BRIDGE_STEPS: readonly string[] = [
  'On your iPhone, install Health Auto Export and let it read your workouts.',
  'In its sidebar open Automations, tap New Automation and choose REST API.',
  'Paste your link into URL.',
  'For the data type choose Workouts, and turn on Include Route Data and Include Workout Metrics.',
  'Set the export format to JSON, version 2.',
  'Under Manual Sync, export once to send your recent workouts.',
];

function UploadLink({
  linked,
  freshLink,
  busy,
  disabled,
  onCreate,
}: {
  /** A link exists (or was just made) — creating is no longer offered. */
  linked: boolean;
  freshLink: string | null;
  busy: boolean;
  disabled: boolean;
  onCreate: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!freshLink) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(freshLink);
      } else {
        inputRef.current?.select();
        document.execCommand('copy');
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Selecting it is the fallback the athlete can finish by hand.
      inputRef.current?.select();
    }
  };

  return (
    <div className="mt-3 space-y-3" data-upload-link="">
      {freshLink && (
        <div className="rounded-lg border border-border bg-surface-muted p-3" data-upload-link-fresh="">
          <label htmlFor="upload-link-url" className="block text-sm font-medium text-primary">
            Your link
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="upload-link-url"
              ref={inputRef}
              readOnly
              value={freshLink}
              onFocus={e => e.currentTarget.select()}
              className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-primary"
            />
            <button
              type="button"
              onClick={() => void copy()}
              className="min-h-[44px] shrink-0 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover transition"
              data-upload-link-copy=""
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-2 text-xs text-tertiary">
            This is the only time the link is shown. Keep it to yourself: anyone who has it can add workouts to your
            Vitals. If you lose it, make a new one.
          </p>
        </div>
      )}

      <details className="rounded-lg border border-border px-3 py-2" open={!!freshLink || !linked}>
        <summary className="cursor-pointer text-sm font-medium text-primary min-h-[28px]">How to set it up</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-secondary">
          {BRIDGE_STEPS.map(step => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-tertiary">
          Health Auto Export is a separate app from another company and may charge for automations. It can only read
          your workouts while your iPhone is unlocked, so a workout arrives the next time you use your phone.
        </p>
      </details>

      {!linked && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCreate}
            disabled={busy || disabled}
            className="min-h-[44px] rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover transition disabled:opacity-50"
            data-upload-link-create=""
          >
            {busy ? 'Creating…' : 'Create my link'}
          </button>
        </div>
      )}
    </div>
  );
}
