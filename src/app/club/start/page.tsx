'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import OrgStartWizard from '@/components/orgs/OrgStartWizard';
import { Building2, Clock } from 'lucide-react';

// "Start a club" (117) — mirror of /league/start, minus the sport select
// (clubs are multi-sport by decision). Requests land in the admin queue on
// /dashboard/clubs; every state is a server-truth refetch.

interface MyRequest {
  id: string;
  name: string;
  description: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  status: 'pending' | 'approved' | 'declined' | string;
  decline_reason: string | null;
  decided_at: string | null;
  created_club_id: string | null;
  created_at: string;
}

export default function StartClubPage() {
  const { user, loading: authLoading } = useAuth();

  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);


  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/clubs/requests');
        if (cancelled || !response.ok) return;
        const data = await response.json();
        if (!cancelled) setRequests(data.requests ?? []);
      } catch {
        /* the form still renders; submit surfaces real errors */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, reloadKey]);


  if (authLoading) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-8 h-8 text-faint" />
            </div>
            <h1 className="text-2xl font-bold text-primary mb-2">Sign in to start a club</h1>
            <p className="text-tertiary mb-6">
              Club requests are reviewed by an Edge Athlete admin; approved clubs are yours to run.
            </p>
            <Link
              href="/"
              className="inline-flex items-center px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const pending = requests.find(r => r.status === 'pending');
  const latestDeclined = requests[0]?.status === 'declined' ? requests[0] : null;
  const approved = requests.filter(r => r.status === 'approved' && r.created_club_id);

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-primary">Start a club</h1>
          <p className="mt-1 text-sm text-tertiary">
            Tell us about your club — an Edge Athlete admin reviews every request, and
            approval makes you its owner.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
          </div>
        ) : pending ? (
          <div className="bg-surface rounded-xl border border-violet-300 shadow-sm p-5 flex items-start gap-3">
            <Clock className="w-5 h-5 text-brand-fg mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-primary">{pending.name} is waiting for review</p>
              <p className="text-sm text-tertiary mt-1">
                We&apos;ll notify you here as soon as it&apos;s decided. One request can be open at a time.
              </p>
            </div>
          </div>
        ) : (
          <>
            {latestDeclined && (
              <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-300 p-5">
                <p className="font-medium text-primary">
                  Your request for {latestDeclined.name} was declined
                </p>
                {latestDeclined.decline_reason && (
                  <p className="text-sm text-secondary mt-1 whitespace-pre-wrap">
                    {latestDeclined.decline_reason}
                  </p>
                )}
                <p className="text-xs text-muted mt-2">You can submit a new request below.</p>
              </div>
            )}

            <OrgStartWizard side="club" onSubmitted={() => setReloadKey(k => k + 1)} />
          </>
        )}

        {approved.length > 0 && (
          <div className="bg-surface rounded-xl shadow-sm border border-border p-5">
            <h2 className="text-sm font-semibold text-secondary mb-2">Your clubs from past requests</h2>
            <ul className="space-y-1">
              {approved.map(r => (
                <li key={r.id}>
                  <Link
                    href={`/club/${r.created_club_id}`}
                    className="text-sm text-brand-fg hover:text-brand-fg-strong"
                  >
                    {r.name} →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
