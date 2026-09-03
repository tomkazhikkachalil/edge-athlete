'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { useToast } from '@/components/Toast';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /join/club/[id] — the join door (phase 9 V3) ────────────────────────────
// Where a club's PUBLIC site sends a golfer who taps "Join". Signed-out →
// the account first (the C1 door: park the intent in sessionStorage
// `ea:invite-return`, which `/` honours after sign-in; `?next=` for the
// plain login). Signed-in → the club's name and place, one button, the
// result: an open club joins on the spot; an approval club queues a
// request ("a manager will approve it"). A member sees "You're in".
// Check initialAuthCheckComplete before !user (the house rule).

interface ClubView {
  club: { id: string; name: string; city: string | null; region: string | null };
  memberCount: number;
  viewerRole: string | null;
  joinPolicy?: 'open' | 'approval';
  visibility?: 'public' | 'private';
  viewerRequestPending?: boolean;
}

export default function JoinClubPage() {
  const params = useParams();
  const clubId = String(params.id ?? '');
  const { user, initialAuthCheckComplete } = useAuth();
  const { showError } = useToast();
  const [view, setView] = useState<ClubView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'joined' | 'requested' | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!user?.id || !UUID_RE.test(clubId)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/clubs/${clubId}`);
        if (cancelled) return;
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        setView((await res.json()) as ClubView);
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, clubId, reloadKey]);

  const join = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/clubs/${clubId}/members`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { action?: string; error?: string };
      if (!res.ok) {
        showError('Join', body.error || 'Something went wrong');
        return;
      }
      if (body.action === 'joined' || body.action === 'requested') setOutcome(body.action);
      setReloadKey(k => k + 1);
    } catch {
      showError('Join', 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const returnPath = `/join/club/${clubId}`;
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <div className="max-w-md mx-auto px-4 py-10">{children}</div>
    </div>
  );

  if (!UUID_RE.test(clubId)) {
    return shell(
      <div className="text-center">
        <h1 className="text-2xl font-bold text-primary mb-2">Club not found</h1>
        <Link href="/explore" className="text-sm text-brand-fg font-medium">Explore Edge Athlete →</Link>
      </div>
    );
  }

  if (!initialAuthCheckComplete) {
    return shell(
      <div className="flex justify-center py-10">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    );
  }

  if (!user) {
    return shell(
      <div className="bg-surface rounded-xl shadow-sm border border-border p-6 text-center">
        <h1 className="text-2xl font-bold text-primary mb-2">Create an account to join this club</h1>
        <p className="text-tertiary mb-6">Your account is your golf record — rounds, handicap and league play in one place.</p>
        <Link
          href={`/?next=${encodeURIComponent(returnPath)}`}
          onClick={() => {
            try {
              window.sessionStorage.setItem('ea:invite-return', returnPath);
            } catch {
              /* ignore */
            }
          }}
          className="inline-flex items-center px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover transition-colors"
        >
          Create an account or sign in
        </Link>
      </div>
    );
  }

  if (notFound) {
    return shell(
      <div className="text-center">
        <h1 className="text-2xl font-bold text-primary mb-2">Club not found</h1>
        <Link href="/explore" className="text-sm text-brand-fg font-medium">Explore Edge Athlete →</Link>
      </div>
    );
  }

  if (!view) {
    return shell(
      <div className="flex justify-center py-10">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    );
  }

  const place = [view.club.city, view.club.region].filter(Boolean).join(', ');
  const isMember = !!view.viewerRole;
  const pending = view.viewerRequestPending === true;
  const approval = view.joinPolicy === 'approval';

  return shell(
    <div className="bg-surface rounded-xl shadow-sm border border-border p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-tertiary">Join</p>
      <h1 className="mt-1 text-2xl font-bold text-primary">{view.club.name}</h1>
      <p className="mt-1 text-sm text-tertiary">
        {[place || null, `${view.memberCount} member${view.memberCount === 1 ? '' : 's'}`, view.visibility === 'private' ? 'Private club' : null]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {isMember || outcome === 'joined' ? (
        <div className="mt-5" data-join-state="member">
          <p className="text-primary font-medium">You’re in.</p>
          <Link href={`/club/${clubId}`} className="mt-3 inline-flex items-center px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover transition-colors">
            Open the club →
          </Link>
        </div>
      ) : pending || outcome === 'requested' ? (
        <div className="mt-5" data-join-state="requested">
          <p className="text-primary font-medium">Request sent — a manager will approve it.</p>
          <p className="mt-1 text-sm text-tertiary">You’ll get a bell when they do.</p>
          <Link href={`/club/${clubId}`} className="mt-3 inline-block text-sm text-brand-fg font-medium">
            See the club page →
          </Link>
        </div>
      ) : (
        <div className="mt-5" data-join-state="open">
          <p className="text-sm text-secondary">
            {approval
              ? 'This club approves new members. Send a request and a manager will let you in.'
              : 'Join in one tap — you can leave any time.'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void join()}
            className="mt-3 w-full sm:w-auto px-4 py-2 min-h-[44px] bg-brand text-white rounded-lg font-medium hover:bg-brand-hover transition-colors disabled:opacity-60"
          >
            {busy ? 'One moment…' : approval ? 'Request to join' : `Join ${view.club.name}`}
          </button>
        </div>
      )}
    </div>
  );
}
