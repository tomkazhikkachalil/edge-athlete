'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';

// ── Connected apps — the owner's setup door (fix round part 3, PR 4) ────────
// Polar needs three things that only the owner can do, once: register the
// callback URL in Polar's client, set the client id and secret in Vercel,
// and create the webhook. This panel shows where each stands and does the
// third — Polar returns the webhook's signature key exactly once, and the
// panel hands it to the owner to put in Vercel (it is never stored).

interface Status {
  configured: boolean;
  signing: boolean;
  callbackUrl: string;
  webhookUrl: string;
}

const btn = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';

export default function ConnectedAppsSetupPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/connections/polar-webhook', { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setLoadError(true); return; }
        const body = (await res.json()) as Status;
        if (!cancelled) setStatus(body);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const create = async () => {
    setConfirm(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/connections/polar-webhook', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { signatureSecretKey?: string; error?: string };
      if (!res.ok || !body.signatureSecretKey) {
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setKey(body.signatureSecretKey);
    } catch {
      setError('The request did not go through.');
    } finally {
      setBusy(false);
    }
  };

  const mark = (ok: boolean) => (
    <span className={ok ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}>{ok ? 'Done' : 'To do'}</span>
  );

  return (
    <section aria-label="Connected apps setup" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-admin-connected-apps="">
      <h2 className="text-lg font-semibold text-primary mb-1">Connected apps — Polar setup</h2>
      <p className="text-xs text-muted mb-3">
        Three one-time steps before athletes can connect a Polar watch. Until all three are done the Polar card reads
        &quot;Coming soon&quot;.
      </p>
      {loadError && <p role="alert" className="text-sm text-muted">Couldn&apos;t load the setup status.</p>}
      {status && (
        <ol className="space-y-3 text-sm text-secondary list-decimal pl-5">
          <li>
            In Polar&apos;s AccessLink admin, create a client with this callback URL:
            <code className="mt-1 block break-all rounded bg-surface-sunken px-2 py-1 text-xs text-primary" data-polar-callback-url="">{status.callbackUrl}</code>
          </li>
          <li>
            Set <code className="text-xs">POLAR_CLIENT_ID</code> and <code className="text-xs">POLAR_CLIENT_SECRET</code> in Vercel, then
            redeploy. {mark(status.configured)}
          </li>
          <li>
            Create the webhook (Polar tells us when a workout is finished) and set the key it returns as{' '}
            <code className="text-xs">POLAR_WEBHOOK_SECRET</code> in Vercel, then redeploy. {mark(status.signing)}
            <div className="mt-2">
              <button type="button" className={btn} disabled={busy || !status.configured} onClick={() => setConfirm(true)} data-polar-create-webhook="">
                {busy ? 'Creating…' : 'Create the webhook'}
              </button>
            </div>
            {key && (
              <div className="mt-2 rounded-md border border-border bg-surface-sunken p-3" data-polar-webhook-key="">
                <p className="text-xs text-primary font-semibold">The signature key — shown once. Copy it into Vercel now:</p>
                <code className="mt-1 block break-all text-xs text-primary">{key}</code>
              </div>
            )}
            {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
          </li>
        </ol>
      )}
      <ConfirmModal
        isOpen={confirm}
        title="Create the Polar webhook?"
        message="Polar allows one webhook per client and shows its signature key once. Have Vercel's environment settings open to paste the key."
        confirmText="Create it"
        confirmButtonClass="bg-brand hover:bg-brand-hover"
        onConfirm={() => void create()}
        onCancel={() => setConfirm(false)}
      />
    </section>
  );
}
