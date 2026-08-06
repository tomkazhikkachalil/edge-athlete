'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import BrandBar from '@/components/BrandBar';

// Guardian-invite landing page. Validates (peeks — does not consume) the
// token and explains what's being asked. The invite is consumed later inside
// the consent flow; for now the CTA routes the guardian to create their own
// account or log in. Cross-device by design (app-owned token, not PKCE).
export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const token = params.token as string;

  const [state, setState] = useState<'loading' | 'valid' | 'invalid'>('loading');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [athleteFirstName, setAthleteFirstName] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState('');
  const [hasAccount, setHasAccount] = useState(false);
  const [inviteType, setInviteType] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/invites/${encodeURIComponent(token)}`);
        if (cancelled) return;
        if (!res.ok) {
          setState('invalid');
          return;
        }
        const data = await res.json();
        setAthleteFirstName(data.athleteFirstName ?? null);
        setInvitedEmail(data.invitedEmail ?? '');
        setHasAccount(!!data.guardianHasAccount);
        setInviteType(data.inviteType ?? '');
        setState('valid');
      } catch {
        if (!cancelled) setState('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // Co-guardian invite (support takeover / second guardian): the athlete
  // profile already exists — claiming grants guardian access directly.
  const isCoGuardian = inviteType === 'guardian_additional';

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-surface rounded-lg shadow-lg p-6 sm:p-8">
          {state === 'loading' && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto"></div>
            </div>
          )}

          {state === 'invalid' && (
            <div className="text-center py-4">
              <i className="fas fa-link-slash text-faint text-3xl mb-4"></i>
              <h2 className="text-xl font-bold text-primary mb-2">This link isn&apos;t valid anymore</h2>
              <p className="text-sm text-tertiary mb-6">
                Guardian invite links are single-use and expire after 7 days.
                If you were expecting this, ask your athlete to send a new
                request from the signup page.
              </p>
              <button
                type="button"
                onClick={() => router.push('/')}
                className="text-sm text-brand-fg hover:underline"
              >
                Go to Edge Athlete
              </button>
            </div>
          )}

          {state === 'valid' && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">
                {isCoGuardian
                  ? `You're invited to become ${athleteFirstName ?? 'a young athlete'}'s guardian`
                  : athleteFirstName
                    ? `${athleteFirstName} wants to join Edge Athlete`
                    : 'A young athlete wants to join Edge Athlete'}
              </h2>
              <p className="text-sm text-tertiary mb-4">
                {isCoGuardian
                  ? `${athleteFirstName ?? 'This athlete'} already has a profile on Edge Athlete that needs a guardian. As their guardian you control the profile's privacy, approve what gets posted, and decide who can contact them.`
                  : 'Edge Athlete requires a parent or guardian to set up and manage accounts for young athletes. As their guardian you control the profile’s privacy, approve what gets posted, and decide who can contact them.'}
              </p>
              <div className="bg-brand-soft border border-violet-100 dark:border-violet-900 rounded-md p-4 mb-6">
                <p className="text-sm text-secondary">
                  <i className="fas fa-shield-halved text-brand-fg mr-2"></i>
                  {isCoGuardian
                    ? 'Accepting adds the athlete to your account — you can review their profile, approve posts, and manage their settings right away.'
                    : "Setting this up takes a few minutes: create your own account (or log in), review your athlete's details, and give your consent. Nothing about your athlete is published until you approve it."}
                </p>
              </div>
              <p className="text-xs text-muted mb-4">
                This invite was sent to {invitedEmail}.
              </p>
              {claimError && (
                <p className="text-sm text-red-600 dark:text-red-400 mb-3" role="alert">{claimError}</p>
              )}
              <button
                type="button"
                disabled={claiming}
                onClick={async () => {
                  if (!user) {
                    // Not signed in: to login/signup; the invite link in their
                    // email brings them back here afterward.
                    router.push('/');
                    return;
                  }
                  // Signed-in guardian: claim (consumes the single-use token)
                  // and hand the athlete's basics to Add-your-athlete.
                  setClaiming(true);
                  setClaimError('');
                  try {
                    const res = await fetch(`/api/invites/${encodeURIComponent(token)}/claim`, { method: 'POST' });
                    const data = await res.json();
                    if (!res.ok) {
                      setClaimError(data.error || 'Could not claim this invite.');
                      return;
                    }
                    if (data.granted) {
                      // Co-guardian grant: access exists now — hard reload so
                      // managedProfiles refreshes from the new access row.
                      window.location.href = '/athlete';
                      return;
                    }
                    try {
                      window.sessionStorage.setItem('ea:athlete-dob', data.athlete?.dob ?? '');
                      window.sessionStorage.setItem('ea:athlete-name', JSON.stringify({
                        first: data.athlete?.first_name ?? '',
                        last: data.athlete?.last_name ?? '',
                      }));
                      window.sessionStorage.setItem('ea:pending-profile-id', data.pendingProfileId ?? '');
                    } catch {}
                    router.push('/app/guardian/add-athlete');
                  } catch {
                    setClaimError('Could not claim this invite. Please try again.');
                  } finally {
                    setClaiming(false);
                  }
                }}
                className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition duration-300 text-sm font-medium disabled:opacity-50"
              >
                {claiming
                  ? 'One moment…'
                  : user
                    ? (isCoGuardian ? 'Accept and manage their profile' : 'Review and set up their profile')
                    : hasAccount
                      ? 'Log in to continue'
                      : 'Create your account'}
              </button>
              <p className="text-xs text-muted mt-3 text-center">
                {isCoGuardian
                  ? 'Keep this email — accept the invite from your account.'
                  : 'Keep this email — you’ll finish your athlete’s setup from your account.'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
