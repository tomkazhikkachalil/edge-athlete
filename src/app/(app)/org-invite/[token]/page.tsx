'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import BrandBar from '@/components/BrandBar';
import { useAuth } from '@/lib/auth';
import { clearParkedOrgInvite, saveParkedOrgInvite } from '@/lib/org-invite-parked';

// ── /org-invite/[token] — accept a staff invite (org staff program, 178) ────
// The org-claim page's shape: BrandBar (reachable while accountless), a
// string-union state machine, 410 → invalid, every terminal state carries
// a non-dead-end CTA. Signed-out visitors park the token (localStorage)
// before the sign-in detour; ResumeOrgInviteBanner brings them back. A
// wrong-account 403 keeps the token intact and says so.

type State = 'loading' | 'invalid' | 'ready' | 'accepting' | 'accepted' | 'wrong-account';

interface Peeked {
  org: { side: 'league' | 'club'; id: string; name: string };
  grant: { role: 'admin' | 'staff'; scopeType: 'org' | 'division' | 'team'; scopeName: string | null; seasonLabel: string | null };
  summary: string;
}

export default function OrgInvitePage() {
  const params = useParams();
  const token = params.token as string;
  const { user, initialAuthCheckComplete } = useAuth();

  const [state, setState] = useState<State>('loading');
  const [peeked, setPeeked] = useState<Peeked | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/org-invite/${encodeURIComponent(token)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.valid) {
          setPeeked({ org: data.org, grant: data.grant, summary: data.summary });
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

  const accept = async () => {
    setState('accepting');
    setError('');
    try {
      const res = await fetch(`/api/org-invite/${encodeURIComponent(token)}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        clearParkedOrgInvite();
        setState('accepted');
        return;
      }
      if (res.status === 410) {
        setState('invalid');
        return;
      }
      if (res.status === 403 && data.wrongAccount) {
        setState('wrong-account');
        return;
      }
      setError(data.error || 'Could not accept the invite');
      setState('ready');
    } catch {
      setError('Could not accept the invite');
      setState('ready');
    }
  };

  const scopeLine = peeked
    ? [
        peeked.grant.scopeType === 'org' ? 'Whole organization' : `${peeked.grant.scopeType === 'division' ? 'Division' : 'Team'}: ${peeked.grant.scopeName ?? '—'}`,
        peeked.grant.seasonLabel ? `Season: ${peeked.grant.seasonLabel}` : null,
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
              <h1 className="text-xl font-bold text-primary mb-2">This invite has expired or was already used</h1>
              <p className="text-sm text-tertiary mb-4">Ask the organization&apos;s owner to send a fresh invite.</p>
              <Link href="/" className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium">
                Go to Edge Athlete →
              </Link>
            </div>
          )}

          {state === 'wrong-account' && (
            <div className="text-center">
              <h1 className="text-xl font-bold text-primary mb-2">This invite was sent to a different email</h1>
              <p className="text-sm text-tertiary mb-4">
                Sign in with the account that uses the invited email address — the invite is still valid.
              </p>
              <Link
                href="/"
                onClick={() => saveParkedOrgInvite({ token, orgName: peeked?.org.name ?? 'the organization' })}
                className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium"
              >
                Switch account →
              </Link>
            </div>
          )}

          {(state === 'ready' || state === 'accepting') && peeked && (
            <div className="text-center">
              <div className="w-14 h-14 bg-brand-soft rounded-full flex items-center justify-center mx-auto mb-4">
                <i className={`fas ${peeked.org.side === 'league' ? 'fa-trophy' : 'fa-building'} text-xl text-brand-fg`} aria-hidden="true"></i>
              </div>
              <h1 className="text-xl font-bold text-primary mb-1">Help run {peeked.org.name}</h1>
              <p className="text-sm font-semibold text-secondary mb-1">{peeked.summary}</p>
              {scopeLine && <p className="text-sm text-muted mb-4">{scopeLine}</p>}
              <p className="text-sm text-secondary mb-4">
                You&apos;ll get the console sections above — and nothing else. The organization&apos;s owners keep its settings and identity.
              </p>
              {error && (
                <p role="alert" className="text-sm text-red-600 mb-3">
                  {error}
                </p>
              )}
              {!initialAuthCheckComplete ? null : user ? (
                <button
                  type="button"
                  disabled={state === 'accepting'}
                  onClick={() => void accept()}
                  className="w-full sm:w-auto px-5 py-2.5 min-h-[44px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-60"
                >
                  {state === 'accepting' ? 'Accepting…' : 'Accept the invite'}
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted">Sign in or create an account with the invited email to accept.</p>
                  <Link
                    href="/"
                    onClick={() => saveParkedOrgInvite({ token, orgName: peeked.org.name })}
                    className="inline-block w-full sm:w-auto px-5 py-2.5 min-h-[44px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
                  >
                    Sign in to accept
                  </Link>
                </div>
              )}
            </div>
          )}

          {state === 'accepted' && peeked && (
            <div className="text-center">
              <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-950/40 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-circle-check text-xl text-emerald-600" aria-hidden="true"></i>
              </div>
              <h1 className="text-xl font-bold text-primary mb-2">You&apos;re on {peeked.org.name}&apos;s staff</h1>
              <p className="text-sm text-tertiary mb-4">{peeked.summary}. The console shows your sections.</p>
              <Link href={`/app/org/${peeked.org.side}/${peeked.org.id}`} className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium">
                Open the console →
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
