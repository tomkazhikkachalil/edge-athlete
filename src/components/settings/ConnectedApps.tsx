'use client';

import { useEffect, useState } from 'react';
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
                  {linked && (
                    <div className="mt-3 flex justify-end">
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
    </div>
  );
}
