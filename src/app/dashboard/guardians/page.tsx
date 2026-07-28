'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';

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
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden'>('loading');
  const [acting, setActing] = useState('');
  const [error, setError] = useState('');
  // per-row invite email inputs and results
  const [inviteEmail, setInviteEmail] = useState<Record<string, string>>({});
  const [inviteResult, setInviteResult] = useState<Record<string, { inviteUrl: string; emailSent: boolean }>>({});
  const [confirmingDelete, setConfirmingDelete] = useState('');
  const [deleteText, setDeleteText] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/guardian-support');
    if (res.status === 403 || res.status === 401) { setState('forbidden'); return; }
    const data = await res.json();
    setItems(data.orphans ?? []);
    setState('ready');
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace('/');
    if (user) load();
  }, [user, loading, router, load]);

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

  const remove = async (item: OrphanItem) => {
    const data = await act(item.id, { action: 'delete_profile' });
    if (data) {
      setConfirmingDelete('');
      setDeleteText('');
      await load();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Guardian support</h1>
        <p className="text-sm text-gray-600 mb-6">
          Supervised athlete profiles with no guardian. Invite a new guardian
          (they accept by email link) or permanently delete the profile.
        </p>

        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm mb-4">
            {error}
          </div>
        )}

        {state === 'forbidden' ? (
          <p className="text-sm text-gray-600">You&apos;re not authorized to view this page.</p>
        ) : state === 'loading' ? (
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-violet-600 mx-auto my-12"></div>
        ) : items.length === 0 ? (
          <div className="text-sm text-gray-500 bg-white border border-gray-200 rounded-lg p-6 text-center">
            No orphaned supervised profiles.
          </div>
        ) : (
          items.map(item => (
            <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{item.name}</p>
                  <p className="text-xs text-gray-500">
                    {item.handle ? `@${item.handle} · ` : ''}created {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${item.hasCredentials ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-600'}`}>
                    {item.hasCredentials ? 'has login' : 'no login'}
                  </span>
                  <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                    consent: {item.consentState}
                  </span>
                </div>
              </div>

              {inviteResult[item.id] ? (
                <div className="bg-violet-50 border border-violet-200 rounded-md p-3 mb-3 text-sm">
                  <p className="text-violet-800 mb-1">
                    Invite created{inviteResult[item.id].emailSent ? ' and emailed' : ' — email NOT sent (SMTP off); share this link manually'}:
                  </p>
                  <code className="block text-xs text-gray-800 break-all select-all">{inviteResult[item.id].inviteUrl}</code>
                </div>
              ) : (
                <div className="flex gap-2 mb-3">
                  <input
                    type="email"
                    placeholder="new-guardian@email.com"
                    value={inviteEmail[item.id] ?? ''}
                    onChange={e => setInviteEmail(prev => ({ ...prev, [item.id]: e.target.value }))}
                    className="flex-grow border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                  <button
                    type="button"
                    onClick={() => invite(item)}
                    disabled={acting === item.id || !(inviteEmail[item.id] ?? '').includes('@')}
                    className="bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                  >
                    {acting === item.id ? <i className="fas fa-spinner fa-spin"></i> : 'Invite guardian'}
                  </button>
                </div>
              )}

              {confirmingDelete === item.id ? (
                <div className="border-t border-gray-100 pt-3">
                  <p className="text-sm text-gray-700 mb-2">
                    Type <span className="font-mono text-red-700">{item.handle ?? item.name}</span> to permanently delete this profile.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={deleteText}
                      onChange={e => setDeleteText(e.target.value)}
                      autoComplete="off"
                      className="flex-grow border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-red-500"
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
                      className="border border-gray-300 text-gray-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setConfirmingDelete(item.id); setDeleteText(''); }}
                  className="text-xs text-red-600 hover:underline"
                >
                  Delete profile…
                </button>
              )}
            </div>
          ))
        )}
      </main>
    </div>
  );
}
