'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import RegistrationWizard from '@/components/orgs/RegistrationWizard';
import { FEATURE_FLAGS } from '@/lib/features';

// ── /register/[side]/[id] — the family registration wizard (phase 5 R3) ─────
// Flag-gated SURFACE (the POST route 404s independently when off). A
// signed-in page: check initialAuthCheckComplete before !user (the house
// rule), and the wizard itself hides "Myself" for supervised viewers.

export default function RegisterPage() {
  const params = useParams();
  const side = params.side as string;
  const orgId = params.id as string;
  const validSide = side === 'league' || side === 'club';
  const plural = side === 'league' ? 'leagues' : 'clubs';

  const { user, initialAuthCheckComplete } = useAuth();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!validSide || !FEATURE_FLAGS.FEATURE_ORG_REGISTRATION) return;
    let cancelled = false;
    fetch(`/api/${plural}/${orgId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (cancelled) return;
        const org = body?.league ?? body?.club;
        if (org?.name) setOrgName(org.name as string);
        else setMissing(true);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [validSide, plural, orgId]);

  if (!validSide || !FEATURE_FLAGS.FEATURE_ORG_REGISTRATION || missing) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-tertiary">Not found.</p>
        </div>
      </div>
    );
  }

  if (!initialAuthCheckComplete || (user && orgName === null)) {
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
            <h1 className="text-2xl font-bold text-primary mb-2">Sign in to register</h1>
            <p className="text-sm text-tertiary mb-4">
              Registration is tied to your Edge Athlete account (and your athletes&apos;).
            </p>
            <Link href="/" className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium">
              Go to sign in →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div>
          <Link
            href={`/${side}/${orgId}`}
            className="text-sm text-brand-fg hover:text-brand-fg-strong"
          >
            ← {orgName}
          </Link>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-primary">
            Register with {orgName}
          </h1>
        </div>
        <RegistrationWizard side={side as 'league' | 'club'} orgId={orgId} orgName={orgName!} />
      </main>
    </div>
  );
}
