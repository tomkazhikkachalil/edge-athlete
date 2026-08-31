'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';

interface ParkedItem {
  id: string;
  name: string;
  childEmail: string | null;
  dob: string;
  createdAt: string;
  expiresAt: string;
  invitedEmail: string | null;
  inviteExpired: boolean;
}

interface OrphanItem {
  id: string;
  name: string;
  handle: string | null;
  createdAt: string;
  hasCredentials: boolean;
  consentState: string;
}

// Admin guardian-support queue: supervised profiles with ZERO guardians
// (orphans). Fix = invite a new guardian (co-guardian token; claiming
// grants access) or hard-delete the profile. Authorization lives in the
// API (requireAdmin / ADMIN_EMAILS) — this page just renders it.
export default function GuardianSupportPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<OrphanItem[]>([]);
  const [parked, setParked] = useState<ParkedItem[]>([]);
  const [remintResult, setRemintResult] = useState<Record<string, { inviteUrl: string; invitedEmail: string }>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden'>('loading');
  const [acting, setActing] = useState('');
  const [error, setError] = useState('');
  // per-row invite email inputs and results
  const [inviteEmail, setInviteEmail] = useState<Record<string, string>>({});
  const [inviteResult, setInviteResult] = useState<Record<string, { inviteUrl: string; emailSent: boolean }>>({});
  const [confirmingDelete, setConfirmingDelete] = useState('');
  const [deleteText, setDeleteText] = useState('');

  // Loader defined inside the effect and published on a ref so handlers keep
  // their `await load()` semantics — see the consent page for the rationale.
  const loadRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!loading && !user) router.replace('/');
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      const res = await fetch('/api/admin/guardian-support');
      if (cancelled) return;
      if (res.status === 403 || res.status === 401) { setState('forbidden'); return; }
      const data = await res.json();
      if (cancelled) return;
      setItems(data.orphans ?? []);
      setParked(data.parked ?? []);
      setState('ready');
    };
    loadRef.current = run;
    run();
    return () => {
      cancelled = true;
    };
  }, [user, loading, router]);

  const act = async (profileId: string, body: object): Promise<Record<string, unknown> | null> => {
    setActing(profileId);
    setError('');
    try {
      const res = await fetch('/api/admin/guardian-support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Action failed.'); return null; }
      return data;
    } catch {
      setError('Action failed. Please try again.');
      return null;
    } finally {
      setActing('');
    }
  };

  const invite = async (item: OrphanItem) => {
    const data = await act(item.id, { action: 'invite_guardian', email: inviteEmail[item.id] ?? '' });
    if (data) {
      setInviteResult(prev => ({
        ...prev,
        [item.id]: { inviteUrl: String(data.inviteUrl), emailSent: !!data.emailSent },
      }));
    }
  };

  const remint = async (item: ParkedItem) => {
    // act() keys the spinner by id; profileId is unused server-side here.
    const data = await act(item.id, { action: 'remint_invite', pendingProfileId: item.id });
    if (data) {
      setRemintResult(prev => ({
        ...prev,
        [item.id]: { inviteUrl: String(data.inviteUrl), invitedEmail: String(data.invitedEmail) },
      }));
    }
  };

  const remove = async (item: OrphanItem) => {
    const data = await act(item.id, { action: 'delete_profile' });
    if (data) {
      setConfirmingDelete('');
      setDeleteText('');
      await loadRef.current();
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-primary mb-1">Guardian support</h1>
        <p className="text-sm text-tertiary mb-6">
          Supervised athlete profiles with no guardian, and parked minor
          sign-ups whose guardian invite never arrived. Invite or re-mint —
          when email fails, share the link directly.
        </p>

        {error && (
          <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4">
            {error}
          </div>
        )}

        {state === 'forbidden' ? (
          <p className="text-sm text-tertiary">You&apos;re not authorized to view this page.</p>
        ) : state === 'loading' ? (
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted bg-surface border border-border rounded-lg p-6 text-center">
            No orphaned supervised profiles.
          </div>
        ) : (
          items.map(item => (
            <div key={item.id} className="bg-surface border border-border rounded-lg p-5 mb-4">
              <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-primary truncate">{item.name}</p>
                  <p className="text-xs text-muted truncate">
                    {item.handle ? `@${item.handle} · ` : ''}created {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${item.hasCredentials ? 'bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong' : 'bg-surface-sunken text-tertiary'}`}>
                    {item.hasCredentials ? 'has login' : 'no login'}
                  </span>
                  <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-surface-sunken text-tertiary">
                    consent: {item.consentState}
                  </span>
                </div>
              </div>

              {inviteResult[item.id] ? (
                <div className="bg-brand-soft border border-violet-200 dark:border-violet-800 rounded-md p-3 mb-3 text-sm">
                  <p className="text-violet-800 dark:text-violet-200 mb-1">
                    Invite created{inviteResult[item.id].emailSent ? ' and emailed' : " — we couldn't email it; share this link directly"}:
                  </p>
                  <code className="block text-xs text-primary break-all select-all">{inviteResult[item.id].inviteUrl}</code>
                </div>
              ) : (
                // Stacks below sm — the input shared one row with the button
                // and shrank to ~110px at 320px
                <div className="flex flex-col sm:flex-row gap-2 mb-3">
                  <input
                    type="email"
                    placeholder="new-guardian@email.com"
                    value={inviteEmail[item.id] ?? ''}
                    onChange={e => setInviteEmail(prev => ({ ...prev, [item.id]: e.target.value }))}
                    className="w-full sm:flex-grow min-w-0 border border-border-strong rounded-md px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                  <button
                    type="button"
                    onClick={() => invite(item)}
                    disabled={acting === item.id || !(inviteEmail[item.id] ?? '').includes('@')}
                    className="bg-brand text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-brand-hover disabled:opacity-50"
                  >
                    {acting === item.id ? <i className="fas fa-spinner fa-spin"></i> : 'Invite guardian'}
                  </button>
                </div>
              )}

              {confirmingDelete === item.id ? (
                <div className="border-t border-border-subtle pt-3">
                  <p className="text-sm text-secondary mb-2">
                    Type <span className="font-mono text-red-700 dark:text-red-300">{item.handle ?? item.name}</span> to permanently delete this profile.
                  </p>
                  {/* Stacks below sm — typing an exact handle into a ~76px
                      input to confirm a destructive action was unusable */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={deleteText}
                      onChange={e => setDeleteText(e.target.value)}
                      autoComplete="off"
                      className="w-full sm:flex-grow min-w-0 border border-border-strong rounded-md px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-red-500"
                    />
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      disabled={acting === item.id || deleteText.trim().toLowerCase() !== (item.handle ?? item.name).toLowerCase()}
                      className="bg-red-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => { setConfirmingDelete(''); setDeleteText(''); }}
                      className="border border-border-strong text-secondary px-4 py-2 rounded-md text-sm font-medium hover:bg-surface-muted"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setConfirmingDelete(item.id); setDeleteText(''); }}
                  className="text-xs text-red-600 dark:text-red-400 hover:underline min-h-[44px] inline-flex items-center -my-2"
                >
                  Delete profile…
                </button>
              )}
            </div>
          ))
        )}

        {state === 'ready' && (
          <>
            <h2 className="text-lg font-bold text-primary mt-8 mb-1">Parked minor sign-ups</h2>
            <p className="text-sm text-tertiary mb-4">
              Athletes under the age threshold who signed up and are waiting on
              a parent. The invite link exists only in email — if the send
              failed, re-mint a fresh link and share it with the guardian.
            </p>
            {parked.length === 0 ? (
              <div className="text-sm text-muted bg-surface border border-border rounded-lg p-6 text-center">
                No parked sign-ups waiting on a guardian.
              </div>
            ) : (
              parked.map(item => (
                <div key={item.id} className="bg-surface border border-border rounded-lg p-5 mb-4">
                  <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-primary truncate">{item.name}</p>
                      <p className="text-xs text-muted truncate">
                        signed up {new Date(item.createdAt).toLocaleDateString()} · expires {new Date(item.expiresAt).toLocaleDateString()}
                      </p>
                      {item.invitedEmail && (
                        <p className="text-xs text-muted truncate">guardian: {item.invitedEmail}</p>
                      )}
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${item.inviteExpired ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300' : 'bg-surface-sunken text-tertiary'}`}>
                      {item.inviteExpired ? 'invite dead' : 'invite live'}
                    </span>
                  </div>
                  {remintResult[item.id] ? (
                    <div className="bg-brand-soft border border-violet-200 dark:border-violet-800 rounded-md p-3 text-sm">
                      <p className="text-violet-800 dark:text-violet-200 mb-1">
                        Fresh invite for {remintResult[item.id].invitedEmail} — share this link directly:
                      </p>
                      <code className="block text-xs text-primary break-all select-all">{remintResult[item.id].inviteUrl}</code>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => remint(item)}
                      disabled={acting === item.id}
                      className="bg-brand text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-brand-hover disabled:opacity-50"
                    >
                      {acting === item.id ? <i className="fas fa-spinner fa-spin"></i> : 'Re-mint invite link'}
                    </button>
                  )}
                </div>
              ))
            )}
          </>
        )}
      </main>
    </div>
  );
}
