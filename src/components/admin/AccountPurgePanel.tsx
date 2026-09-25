'use client';

import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';

// ── Purge a parked account now — the dashboard's door (departed accounts,
// Sep 24 2026). `POST /api/admin/account-purge` is dry-run by default: the
// dry run says what the engine WOULD do (erase, or keep a name-only
// tombstone because other people's results depend on the account — and
// why); "Purge now" sits behind the house confirm. Only a PARKED account
// (its owner asked to delete it) can be purged here; the daily cron does the
// same after the 30-day window.

interface Plan {
  mode: 'erase' | 'tombstone' | 'masked';
  tied: Record<string, number>;
  consentVersion?: string | null;
  warnings?: string[];
  dryRun: boolean;
}

const MODE_LABEL: Record<Plan['mode'], string> = {
  erase: 'Erase — nothing of theirs is tied to anyone else',
  tombstone: 'Keep a name-only record — their results stay with the clubs, leagues, events and players they played with',
  masked: 'Keep results as "Athlete" — a supervised athlete whose guardian signed consent v3',
};

const btn = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';

export default function AccountPurgePanel() {
  const [profileId, setProfileId] = useState('');
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const call = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/account-purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: profileId.trim(), dryRun }),
      });
      const body = (await res.json().catch(() => ({}))) as Plan & { error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setPlan(body);
    } catch (e) {
      setPlan(null);
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  const tiedLine = plan
    ? Object.entries(plan.tied).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replace(/([A-Z])/g, ' $1').toLowerCase()}`).join(' · ')
    : '';

  return (
    <section aria-label="Purge a parked account" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-admin-account-purge="">
      <h2 className="text-lg font-semibold text-primary mb-1">Purge a parked account now</h2>
      <p className="text-xs text-muted mb-3">
        For an account its owner already asked to delete (the daily job does this after 30 days). An account whose results other people
        depend on leaves a name-only record behind; everything personal goes. Dry run first.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={profileId}
          onChange={e => { setProfileId(e.target.value); setPlan(null); }}
          placeholder="Profile id"
          aria-label="Profile id"
          className="min-w-0 flex-1 basis-64 rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-primary"
          data-account-purge-id=""
        />
        <button type="button" disabled={busy || !profileId.trim()} onClick={() => call(true)} className={btn} data-account-purge-dry="">
          {busy ? 'Working…' : 'Dry run'}
        </button>
        <button
          type="button"
          disabled={busy || !plan?.dryRun}
          onClick={() => setConfirm(true)}
          className={`${btn} ${plan?.dryRun ? 'border-red-400 text-red-600 dark:text-red-400' : ''}`}
          data-account-purge-live=""
        >
          Purge now
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {plan && (
        <div className="mt-3 text-sm" data-account-purge-mode={plan.mode} data-account-purge-result={plan.dryRun ? 'dry' : 'done'}>
          <p className="font-medium text-primary">{plan.dryRun ? 'Would: ' : 'Done: '}{MODE_LABEL[plan.mode]}</p>
          {tiedLine && <p className="text-xs text-muted mt-1">Tied: {tiedLine}</p>}
          {plan.warnings && plan.warnings.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">Warnings: {plan.warnings.join('; ')}</p>}
        </div>
      )}
      <ConfirmModal
        isOpen={confirm}
        title="Purge this account now?"
        message="The login, profile details and everything personal are deleted now instead of at the end of the 30 days. This cannot be undone."
        confirmText="Purge now"
        onConfirm={() => { setConfirm(false); void call(false); }}
        onCancel={() => setConfirm(false)}
      />
    </section>
  );
}
