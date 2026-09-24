'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import OrgStartWizard from '@/components/orgs/OrgStartWizard';
import { Building2, Clock, Trophy } from 'lucide-react';
import { type OrgKind, ORG_ROUTE_FAMILY } from '@/lib/orgs/org-ref';

// ── "Start a league" / "Start a club" — ONE page for both kinds (Round 5
// step E-3) ──────────────────────────────────────────────────────────────────
// The self-service half of org signup (116 / 117): the wizard files a request,
// the org is live the moment it exists (179), the directory listing is what
// an admin reviews. One pending request per user; every state shown here is
// a server-truth refetch, never optimistic. What the kind decides: the icon,
// the word, the URL family (`/api/leagues/requests`, `/league/[id]`,
// `/app/org/league/[id]`) and the request row's `created_<kind>_id` field.
// `/league/start` and `/club/start` are twelve-line pages over this.

interface MyRequest {
  id: string;
  name: string;
  /** A league's one sport; absent on a club's request. */
  sport_key?: string | null;
  description: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  status: 'pending' | 'approved' | 'declined' | string;
  decline_reason: string | null;
  decided_at: string | null;
  created_league_id?: string | null;
  created_club_id?: string | null;
  created_at: string;
}

const ICON: Record<OrgKind, typeof Trophy> = { league: Trophy, club: Building2 };

export default function OrgStartPage({ kind }: { kind: OrgKind }) {
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const family = ORG_ROUTE_FAMILY[kind];
  const Icon = ICON[kind];
  const createdId = (r: MyRequest) => (kind === 'league' ? r.created_league_id : r.created_club_id) ?? null;

  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  // Phase 7 C2: `?sport=golf` (the login-page door) — read once, lazily.
  // Round 4: absent, the wizard starts on the CREATOR's sport (the profile's),
  // never on golf by default — a hockey coach opens a hockey club.
  // The wizard only mounts after auth + the requests fetch, so this never
  // reaches the server-rendered tree (no hydration mismatch).
  const [initialSport] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('sport')
  );

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/${family}/requests`);
        if (cancelled || !response.ok) return;
        const data = await response.json();
        if (!cancelled) setRequests(data.requests ?? []);
      } catch {
        /* the form still renders; submit will surface real errors */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, reloadKey, family]);

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
    const returnTo = `/${kind}/start?sport=golf`;
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-4">
              <Icon className="w-8 h-8 text-faint" />
            </div>
            <h1 className="text-2xl font-bold text-primary mb-2">{`Create an account to start your ${kind}`}</h1>
            <p className="text-tertiary mb-6">
              Your {kind} is live the moment you create it; directory listing is reviewed by an Edge Athlete admin.
            </p>
            {/* Phase 7 C1: park the intent both ways — ?next= for the plain
                sign-in, sessionStorage for the registration hard-reload. */}
            <Link
              href={`/?next=${encodeURIComponent(returnTo)}`}
              onClick={() => {
                try { window.sessionStorage.setItem('ea:invite-return', returnTo); } catch { /* ignore */ }
              }}
              className="inline-flex items-center px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover transition-colors"
            >
              Create an account or sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const pending = requests.find(r => r.status === 'pending');
  const latestDeclined = requests[0]?.status === 'declined' ? requests[0] : null;
  const approved = requests.filter(r => r.status === 'approved' && createdId(r));

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-primary">{`Start a ${kind}`}</h1>
          <p className="mt-1 text-sm text-tertiary">
            Your {kind} is live the moment you create it — share the link, add members,
            post rounds. Listing in the directory is reviewed by an Edge Athlete admin.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
          </div>
        ) : (
          <>
            {pending && (
            <div className="bg-surface rounded-xl border border-violet-300 shadow-sm p-5 flex items-start gap-3">
              <Clock className="w-5 h-5 text-brand-fg mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-primary">{pending.name} — listing under review</p>
                <p className="text-sm text-tertiary mt-1">
                  Your {kind} is live now; it joins the directory once an Edge Athlete admin approves the listing. One listing request can be open at a time.
                </p>
                {/* R1 (179): the org is live by link; approval lists it. */}
                {createdId(pending) && (
                  <Link
                    href={`/app/org/${kind}/${createdId(pending)}`}
                    className="mt-3 inline-flex items-center px-3 py-2 text-sm rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
                  >
                    Open your console
                  </Link>
                )}
              </div>
            </div>
            )}
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

            <OrgStartWizard side={kind} initialSport={initialSport ?? profile?.sport ?? null} onSubmitted={orgId => {
                if (orgId) router.push(`/app/org/${kind}/${orgId}?welcome=1`);
                else setReloadKey(k => k + 1);
              }} />
          </>
        )}

        {approved.length > 0 && (
          <div className="bg-surface rounded-xl shadow-sm border border-border p-5">
            <h2 className="text-sm font-semibold text-secondary mb-2">{`Your ${family} from past requests`}</h2>
            <ul className="space-y-1">
              {approved.map(r => (
                <li key={r.id}>
                  <Link
                    href={`/${kind}/${createdId(r)}`}
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
