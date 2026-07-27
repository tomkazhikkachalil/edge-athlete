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
  const [athleteFirstName, setAthleteFirstName] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState('');

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
        setState('valid');
      } catch {
        if (!cancelled) setState('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col bg-violet-50">
      <BrandBar />
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-lg shadow-lg p-6 sm:p-8">
          {state === 'loading' && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-violet-600 mx-auto"></div>
            </div>
          )}

          {state === 'invalid' && (
            <div className="text-center py-4">
              <i className="fas fa-link-slash text-gray-400 text-3xl mb-4"></i>
              <h2 className="text-xl font-bold text-gray-900 mb-2">This link isn&apos;t valid anymore</h2>
              <p className="text-sm text-gray-600 mb-6">
                Guardian invite links are single-use and expire after 7 days.
                If you were expecting this, ask your athlete to send a new
                request from the signup page.
              </p>
              <button
                type="button"
                onClick={() => router.push('/')}
                className="text-sm text-violet-600 hover:underline"
              >
                Go to Edge Athlete
              </button>
            </div>
          )}

          {state === 'valid' && (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 mb-2">
                {athleteFirstName
                  ? `${athleteFirstName} wants to join Edge Athlete`
                  : 'A young athlete wants to join Edge Athlete'}
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Edge Athlete requires a parent or guardian to set up and manage
                accounts for young athletes. As their guardian you control the
                profile&apos;s privacy, approve what gets posted, and decide who
                can contact them.
              </p>
              <div className="bg-violet-50 border border-violet-100 rounded-md p-4 mb-6">
                <p className="text-sm text-gray-700">
                  <i className="fas fa-shield-halved text-violet-600 mr-2"></i>
                  Setting this up takes a few minutes: create your own account
                  (or log in), review your athlete&apos;s details, and give your
                  consent. Nothing about your athlete is published until you
                  approve it.
                </p>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                This invite was sent to {invitedEmail}.
              </p>
              <button
                type="button"
                onClick={() => router.push(user ? '/athlete' : '/')}
                className="w-full bg-violet-600 text-white py-3 px-4 rounded-md hover:bg-violet-700 transition duration-300 text-sm font-medium"
              >
                {user ? 'Continue' : 'Create your account or log in'}
              </button>
              <p className="text-xs text-gray-500 mt-3 text-center">
                Keep this email — you&apos;ll finish your athlete&apos;s setup from
                your account.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
