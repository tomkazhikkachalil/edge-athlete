'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import BrandBar from '@/components/BrandBar';
import { useAuth } from '@/lib/auth';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { formatPlace } from '@/lib/geo/regions';
import { clearParkedOrgClaim, saveParkedOrgClaim } from '@/lib/org-claim-parked';

// ── /org-claim/[token] — take ownership of a stub org (phase 1 round 2) ─────
// The activate/[token] shape: BrandBar (reachable while accountless), a
// string-union state machine, 410 → invalid, every terminal state carries
// a non-dead-end CTA. Signed-out visitors park the token (localStorage)
// before the sign-in detour; ResumeOrgClaimBanner brings them back.

type State = 'loading' | 'invalid' | 'ready' | 'claiming' | 'claimed' | 'conflict';

interface PeekedOrg {
  side: 'league' | 'club';
  name: string;
  sport: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

export default function OrgClaimPage() {
  const params = useParams();
  const token = params.token as string;
  const { user, initialAuthCheckComplete } = useAuth();

  const [state, setState] = useState<State>('loading');
  const [org, setOrg] = useState<PeekedOrg | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/org-claim/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.valid) {
          setOrg(data.org);
          setState('ready');
        } else {
          setState('invalid');
        }
      } catch {
        if (!cancelled) setState('invalid');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const claim = async () => {
    setState('claiming');
    setError('');
    try {
      const res = await fetch(`/api/org-claim/${encodeURIComponent(token)}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        clearParkedOrgClaim();
        setOrgId(data.orgId ?? null);
        setOrg(o => (o ? { ...o, side: data.side ?? o.side } : o));
        setState('claimed');
        return;
      }
      if (res.status === 410) {
        setState('invalid');
        return;
      }
      if (res.status === 409) {
        setState('conflict');
        return;
      }
      setError(data.error || 'Could not complete the claim');
      setState('ready');
    } catch {
      setError('Could not complete the claim');
      setState('ready');
    }
  };

  const orgLine = org
    ? [
        org.sport
          ? SPORT_REGISTRY[org.sport as keyof typeof SPORT_REGISTRY]?.display_name ?? org.sport
          : null,
        formatPlace({ city: org.city, region: org.region, country: org.country }),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg bg-surface rounded-lg shadow-lg p-6 sm:p-8">
          {state === 'loading' && (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
            </div>
          )}

          {state === 'invalid' && (
            <div className="text-center">
              <h1 className="text-xl font-bold text-primary mb-2">
                This link has expired or was already used
              </h1>
              <p className="text-sm text-tertiary mb-4">
                Ask the organization that invited you to send a fresh link.
              </p>
              <Link href="/" className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium">
                Go to Edge Athlete →
              </Link>
            </div>
          )}

          {state === 'conflict' && (
            <div className="text-center">
              <h1 className="text-xl font-bold text-primary mb-2">
                {org?.name ?? 'This organization'} already has an owner
              </h1>
              <p className="text-sm text-tertiary mb-4">
                Someone claimed this page before you. If that&apos;s wrong, contact support.
              </p>
              <Link href="/" className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium">
                Go to Edge Athlete →
              </Link>
            </div>
          )}

          {(state === 'ready' || state === 'claiming') && org && (
            <div className="text-center">
              <div className="w-14 h-14 bg-brand-soft rounded-full flex items-center justify-center mx-auto mb-4">
                <i
                  className={`fas ${org.side === 'league' ? 'fa-trophy' : 'fa-building'} text-xl text-brand-fg`}
                  aria-hidden="true"
                ></i>
              </div>
              <h1 className="text-xl font-bold text-primary mb-1">{org.name}</h1>
              {orgLine && <p className="text-sm text-muted mb-2">{orgLine}</p>}
              <p className="text-sm text-secondary mb-4">
                You&apos;ve been invited to take ownership of this page — rosters, schedules,
                and its public presence.
              </p>
              {error && (
                <p role="alert" className="text-sm text-red-600 mb-3">
                  {error}
                </p>
              )}
              {!initialAuthCheckComplete ? null : user ? (
                <button
                  type="button"
                  disabled={state === 'claiming'}
                  onClick={() => void claim()}
                  className="w-full sm:w-auto px-5 py-2.5 min-h-[44px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-60"
                >
                  {state === 'claiming' ? 'Claiming…' : `Claim ${org.name}`}
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted">Sign in or create an account to claim.</p>
                  <Link
                    href="/"
                    onClick={() => saveParkedOrgClaim({ token, orgName: org.name })}
                    className="inline-block w-full sm:w-auto px-5 py-2.5 min-h-[44px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
                  >
                    Sign in to claim
                  </Link>
                </div>
              )}
            </div>
          )}

          {state === 'claimed' && (
            <div className="text-center">
              <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-950/40 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-circle-check text-xl text-emerald-600" aria-hidden="true"></i>
              </div>
              <h1 className="text-xl font-bold text-primary mb-2">
                {org?.name ?? 'Your organization'} is yours
              </h1>
              <p className="text-sm text-tertiary mb-4">
                You&apos;re the owner — set up seasons, divisions, and your roster from the console.
              </p>
              <Link
                href={orgId && org ? `/app/org/${org.side}/${orgId}` : '/feed'}
                className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium"
              >
                Open the console →
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
