'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';

interface PendingItem {
  recordId: string;
  profileId: string;
  athleteName: string;
  athleteHandle: string | null;
  guardianEmail: string;
  method: string;
  policyVersion: string;
  jurisdiction: string;
  thresholdAge: number;
  submittedAt: string;
  evidenceUrl: string | null;
}

// Admin consent-review queue (Phase 3b). Authorization lives in the API
// (requireAdmin / ADMIN_EMAILS) — this page just renders it.
export default function ConsentReviewPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden'>('loading');
  const [acting, setActing] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/consent-reviews');
    if (res.status === 403 || res.status === 401) { setState('forbidden'); return; }
    const data = await res.json();
    setItems(data.pending ?? []);
    setState('ready');
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace('/');
    if (user) load();
  }, [user, loading, router, load]);

  const decide = async (profileId: string, decision: 'approve' | 'reject') => {
    setActing(profileId);
    try {
      await fetch('/api/admin/consent-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, decision }),
      });
      await load();
    } finally {
      setActing('');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Consent reviews</h1>
        <p className="text-sm text-gray-600 mb-6">
          Signed parental-consent forms awaiting verification. Decisions are
          permanent audit records.
        </p>

        {state === 'loading' && (
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-violet-600 mx-auto my-12"></div>
        )}
        {state === 'forbidden' && (
          <p className="text-sm text-gray-600">Admin access required.</p>
        )}
        {state === 'ready' && items.length === 0 && (
          <p className="text-sm text-gray-500 bg-white border border-gray-200 rounded-lg p-6 text-center">
            No consent submissions waiting for review.
          </p>
        )}
        {items.map(item => (
          <div key={item.recordId} className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="font-bold text-black">
                  {item.athleteName}
                  {item.athleteHandle && <span className="text-gray-500 font-normal ml-2">@{item.athleteHandle}</span>}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  Guardian: {item.guardianEmail} · {item.jurisdiction} (under {item.thresholdAge}) · {item.policyVersion}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Submitted {new Date(item.submittedAt).toLocaleString()}
                </p>
                {item.evidenceUrl ? (
                  <a
                    href={item.evidenceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-sm text-violet-600 hover:underline"
                  >
                    <i className="fas fa-file-signature mr-1"></i> View signed form
                  </a>
                ) : (
                  <p className="mt-2 text-sm text-red-600">No evidence file attached</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={acting === item.profileId}
                  onClick={() => decide(item.profileId, 'approve')}
                  className="bg-violet-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={acting === item.profileId}
                  onClick={() => decide(item.profileId, 'reject')}
                  className="border border-red-300 text-red-600 px-4 py-2 rounded-md text-sm font-medium hover:bg-red-50 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
